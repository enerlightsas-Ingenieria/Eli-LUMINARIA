import { useEffect, useRef, useState } from 'react';
import { analizarFotosCon } from '@compartido/core/analizador';
import { coordenadaValida, enlaceMapa, masCercano } from '@compartido/lib/geo';
import { galeriaPermitida } from '@compartido/lib/politicas';
import { CAMPOS, LuminariaBorrador } from '@compartido/types';
import { Camara } from '../componentes/Camara';
import { avisar, confirmar, dialogo } from '../componentes/dialogos';
import { Foto } from '../componentes/Foto';
import { Icono } from '../componentes/Icono';
import { Boton, Campo, Cabecera, Ficha, Seccion } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir, volver } from '../router';
import { cargarAjustes } from '../servicios/ajustes';
import { borrarFotos, borrarLuminaria, guardarFoto, guardarKv, guardarLuminaria, leerKv } from '../servicios/almacen';
import { base64DeFoto } from '../servicios/fotos';
import { hayConexion } from '../servicios/red';

const num = (t: string): number | null => { const n = parseFloat(t.replace(',', '.')); return Number.isFinite(n) ? n : null; };

export function Editar({ id }: { id: string }) {
  const { items, listo, refrescar, ajustes } = useApp();
  const esNuevo = id === 'nuevo';
  const existente = !esNuevo ? items.find((x) => x.id === Number(id)) : undefined;

  const [l, setL] = useState<LuminariaBorrador | null>(null);
  const [aviso, setAviso] = useState<string>();
  // Texto de las coordenadas tal cual lo escribe el técnico ("-", "4."…); se interpreta al guardar
  const [coordTxt, setCoordTxt] = useState({ lat: '', lng: '' });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [camara, setCamara] = useState(false);
  const guardado = useRef(false);
  const cargado = useRef(false);
  const originales = useRef<string[]>([]);
  const lRef = useRef<LuminariaBorrador | null>(null);
  lRef.current = l;
  const terceros = ajustes.modoTerceros;
  const iaDisponible = ajustes.iaActiva !== false && !!ajustes.apiKey;

  const iniciar = (b: LuminariaBorrador, a?: string) => {
    cargado.current = true;
    setL(b); setAviso(a);
    setCoordTxt({ lat: b.latitud?.toString() ?? '', lng: b.longitud?.toString() ?? '' });
    originales.current = existente?.fotos ?? [];
  };

  useEffect(() => {
    if (cargado.current) return;
    (async () => {
      if (esNuevo) {
        const raw = await leerKv('borrador');
        if (!raw) { ir('/', true); return; }
        const d = JSON.parse(raw);
        iniciar(d.borrador, d.aviso);
      } else if (listo) {
        if (existente) iniciar(existente); else ir('/', true);
      }
    })();
  }, [id, listo, existente]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si se sale sin guardar una luminaria nueva, se descartan las fotos (un refresco de la página conserva el borrador)
  useEffect(() => () => {
    if (esNuevo && !guardado.current && lRef.current) { borrarFotos(lRef.current.fotos); guardarKv('borrador', ''); }
  }, [esNuevo]);

  if (!l) return <Cabecera titulo="Luminaria" atras={volver} />;
  const set = <K extends keyof LuminariaBorrador>(k: K, v: LuminariaBorrador[K]) => setL((p) => (p ? { ...p, [k]: v } : p));

  const agregarFoto = async (blob: Blob) => {
    setCamara(false);
    const fid = await guardarFoto(blob);
    setL((p) => (p ? { ...p, fotos: [...p.fotos, fid] } : p));
  };
  const quitarFoto = (fid: string) => {
    set('fotos', l.fotos.filter((x) => x !== fid));
    if (!originales.current.includes(fid)) borrarFotos([fid]); // las originales se borran al guardar
  };

  const reanalizar = async () => {
    if (!hayConexion()) { await avisar('Sin conexión', 'Necesitas internet para el análisis con IA. Las fotos quedan guardadas; inténtalo cuando tengas señal.'); return; }
    setOcupado('Analizando con IA…');
    try {
      const r = await analizarFotosCon(cargarAjustes, await Promise.all(l.fotos.slice(0, 3).map(base64DeFoto)));
      if (!Object.values(r.caracteristicas).some(Boolean)) { await avisar('IA', 'La IA no pudo identificar datos en estas fotos.'); return; }
      setL((p) => (p ? { ...p, ...r.caracteristicas, confianza: r.confianza } : p));
      setAviso(undefined);
    } catch (e: any) { await avisar('No se pudo analizar', e.message ?? String(e)); }
    finally { setOcupado(null); }
  };

  const persistir = async (siguiente: boolean) => {
    setOcupado('Guardando…');
    try {
      if (l.latitud != null && !coordenadaValida(l.latitud, l.longitud)) { await avisar('Coordenada inválida', 'Revisa la latitud (−90 a 90) y la longitud (−180 a 180).'); return; }
      await guardarLuminaria(l);
      await borrarFotos(originales.current.filter((u) => !l.fotos.includes(u)));
      guardado.current = true;
      if (esNuevo) await guardarKv('borrador', '');
      await refrescar();
      if (siguiente) ir('/capturar', true); else if (esNuevo) ir('/', true); else volver();
    } finally { setOcupado(null); }
  };

  const guardar = async (siguiente: boolean) => {
    // Texto que no es un número (p. ej. "-" o "4." a medias) no se guarda en silencio como "sin coordenada"
    if ((coordTxt.lat.trim() && num(coordTxt.lat) === null) || (coordTxt.lng.trim() && num(coordTxt.lng) === null)) {
      await avisar('Coordenada inválida', 'Escribe la latitud y la longitud como números, por ejemplo 4.711 y -74.0721.');
      return;
    }
    if (coordenadaValida(l.latitud, l.longitud)) {
      const cerca = masCercano({ latitud: l.latitud!, longitud: l.longitud! }, items.filter((x) => x.id !== l.id), 8);
      if (cerca) {
        const r = await dialogo({
          titulo: 'Posible duplicado',
          mensaje: `Ya hay una luminaria (#${cerca.item.id}${cerca.item.codigo ? ' · ' + cerca.item.codigo : ''}) a ${Math.round(cerca.metros)} m de esta coordenada.`,
          botones: [{ texto: 'Cancelar', estilo: 'cancelar' }, { texto: 'Ver la otra' }, { texto: 'Guardar igual' }],
        });
        if (r === 1) { ir(`/editar/${cerca.item.id}`); return; }
        if (r !== 2) return;
      }
    }
    await persistir(siguiente);
  };

  const eliminar = async () => {
    if (!existente || !(await confirmar('Eliminar luminaria', '¿Seguro que quieres eliminar este registro?', 'Eliminar', true))) return;
    await borrarLuminaria(existente);
    await borrarFotos(existente.fotos);
    guardado.current = true;
    await refrescar();
    ir('/', true);
  };

  const anterior = esNuevo ? items[0] : undefined;
  const copiarDelAnterior = () => {
    if (!anterior) return;
    const copia = Object.fromEntries(CAMPOS.filter((f) => f.key !== 'observaciones' && f.key !== 'estado').map((f) => [f.key, anterior[f.key]]));
    setL((p) => (p ? { ...p, ...copia } : p));
  };

  return (
    <>
      <Cabecera titulo={esNuevo ? 'Nueva luminaria' : `Luminaria #${id}`} atras={() => (esNuevo ? ir('/', true) : volver())} />
      <div className="fotos-h" aria-label="Fotos">
        {l.fotos.map((fid) => (
          <div key={fid} className="foto">
            <Foto id={fid} alt="Foto de la luminaria" />
            <button type="button" className="quitar" aria-label="Quitar foto" onClick={() => quitarFoto(fid)}><Icono nombre="cerrar" tam={16} /></button>
          </div>
        ))}
        {l.fotos.length < 3 && <button type="button" className="anadir" aria-label="Añadir foto" onClick={() => setCamara(true)}><Icono nombre="mas" tam={32} /></button>}
      </div>

      {!!l.tecnico && <p className="muted" style={{ marginBottom: 6 }}>Registrada por {l.tecnico}</p>}
      {!!aviso && <p className="aviso" role="status">{aviso}</p>}
      {!!l.confianza && <div style={{ marginBottom: 8 }}><Ficha texto={`Confianza IA: ${l.confianza} — verifica los datos`} color={l.confianza === 'alta' ? 'ok' : l.confianza === 'media' ? 'aviso' : 'peligro'} /></div>}
      <div className="pila">
        {iaDisponible && <Boton texto="Re-analizar con IA" variante="secundario" icono="chispa" cargando={ocupado === 'Analizando con IA…'} deshabilitado={!l.fotos.length} onClick={reanalizar} />}
        {!!anterior && <Boton texto="Copiar datos del último registro" variante="secundario" icono="copiar" onClick={copiarDelAnterior} />}
      </div>

      <Seccion>Identificación y ubicación</Seccion>
      <Campo etiqueta="Código del activo / n.º de poste" valor={l.codigo} alCambiar={(t) => set('codigo', t)} pista="Opcional, el que use tu empresa" />
      <div className="fila">
        <Campo etiqueta="Latitud" numerico conSigno soloLectura={terceros} valor={coordTxt.lat} alCambiar={(t) => { setCoordTxt((p) => ({ ...p, lat: t })); set('latitud', num(t)); }} />
        <Campo etiqueta="Longitud" numerico conSigno soloLectura={terceros} valor={coordTxt.lng} alCambiar={(t) => { setCoordTxt((p) => ({ ...p, lng: t })); set('longitud', num(t)); }} />
      </div>
      {terceros && <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 8 }}>Modo terceros: la coordenada la registra el GPS y no se edita a mano.</p>}
      {l.precisionM != null && <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>Precisión GPS ≈ {Math.round(l.precisionM)} m</p>}
      <Campo etiqueta="Dirección / referencia" valor={l.direccion} alCambiar={(t) => set('direccion', t)} />
      {coordenadaValida(l.latitud, l.longitud) && (
        <a className="boton secundario bloque" style={{ textDecoration: 'none' }} href={enlaceMapa(l.latitud!, l.longitud!)} target="_blank" rel="noopener noreferrer"><Icono nombre="mapa" tam={18} />Abrir en mapa</a>
      )}

      <Seccion>Características</Seccion>
      {CAMPOS.map((f) => (
        <Campo key={f.key} etiqueta={f.label} pista={f.hint} multilinea={f.multiline} numerico={f.numeric} opciones={f.opciones} valor={l[f.key]} alCambiar={(t) => set(f.key, t)} />
      ))}

      <div className="pila" style={{ marginTop: 8 }}>
        <Boton texto="Guardar" cargando={ocupado === 'Guardando…'} onClick={() => guardar(false)} />
        {esNuevo && <Boton texto="Guardar y capturar otra" variante="secundario" onClick={() => guardar(true)} />}
        {!esNuevo && <Boton texto="Eliminar" variante="peligro" onClick={eliminar} />}
      </div>

      {camara && <Camara titulo="Foto adicional" permitirArchivo={galeriaPermitida(terceros)} alCapturar={(b) => agregarFoto(b)} alCerrar={() => setCamara(false)} />}
    </>
  );
}
