import { useCallback, useEffect, useRef, useState } from 'react';
import { analizarFotosCon } from '@compartido/core/analizador';
import type { Posicion } from '@compartido/core/tipos';
import { evaluarCaptura, galeriaPermitida } from '@compartido/lib/politicas';
import { caracteristicasVacias, LuminariaBorrador } from '@compartido/types';
import { Camara } from '../componentes/Camara';
import { Icono } from '../componentes/Icono';
import { useEmpezarJornada } from '../componentes/TarjetaJornada';
import { avisar } from '../componentes/dialogos';
import { Boton, Cabecera, Cargando } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { useJornada } from '../contexto/Jornada';
import { ir, volver } from '../router';
import { cargarAjustes } from '../servicios/ajustes';
import { guardarFoto, guardarKv, nuevoUuid } from '../servicios/almacen';
import { blobABase64 } from '../servicios/fotos';
import { obtenerPosicion } from '../servicios/gps';
import { hayConexion } from '../servicios/red';

const RANURAS = [
  { titulo: 'General', ayuda: 'La luminaria completa, con el poste y el brazo', icono: 'camara' },
  { titulo: 'Placa / etiqueta', ayuda: 'Acércate a la placa con marca, modelo y potencia', icono: 'lista' },
  { titulo: 'Fotocelda', ayuda: 'El receptáculo de la fotocelda, para contar sus pines', icono: 'chispa' },
];

interface FotoTomada { blob: Blob; url: string; origen: 'camara' | 'galeria' }

export function Capturar() {
  const { proyecto, ajustes } = useApp();
  const { estado, reanudar } = useJornada();
  const { empezar, ocupado: iniciando } = useEmpezarJornada();
  const [fotos, setFotos] = useState<(FotoTomada | null)[]>([null, null, null]);
  const [pos, setPos] = useState<Posicion | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(true);
  const [fase, setFase] = useState<string | null>(null);
  const [camaraEn, setCamaraEn] = useState<number | null>(null);
  const cancelar = useRef<AbortController | null>(null);

  const terceros = ajustes.modoTerceros;
  const jornadaActiva = estado?.fase === 'activa';

  const refrescarGps = useCallback(async () => {
    setBuscandoGps(true);
    setPos(await obtenerPosicion('alta'));
    setBuscandoGps(false);
  }, []);
  useEffect(() => { refrescarGps(); }, [refrescarGps]);

  const evaluacion = evaluarCaptura({ modoTerceros: terceros, jornadaActiva, posicion: buscandoGps ? null : pos, precisionMaxM: ajustes.precisionMaxM });
  const motivo = evaluacion.ok ? null : evaluacion.motivo;

  // Si falta precisión, reintenta el GPS solo cada 4 s hasta lograrla (dependencias primitivas: no se reinicia en cada render)
  useEffect(() => {
    if (!terceros || !jornadaActiva || buscandoGps) return;
    if (motivo !== 'SIN_GPS' && motivo !== 'GPS_IMPRECISO') return;
    const t = setTimeout(refrescarGps, 4000);
    return () => clearTimeout(t);
  }, [terceros, jornadaActiva, buscandoGps, motivo, refrescarGps]);

  useEffect(() => () => { fotos.forEach((f) => f && URL.revokeObjectURL(f.url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tomadas = fotos.filter((f): f is FotoTomada => !!f);

  const alCapturar = (i: number, blob: Blob, origen: 'camara' | 'galeria') => {
    setFotos((p) => p.map((x, j) => { if (j === i) { if (x) URL.revokeObjectURL(x.url); return { blob, url: URL.createObjectURL(blob), origen }; } return x; }));
    setCamaraEn(null);
  };
  const quitar = (i: number) => setFotos((p) => p.map((x, j) => { if (j === i && x) { URL.revokeObjectURL(x.url); return null; } return x; }));

  const continuar = async (conIA: boolean) => {
    if (!tomadas.length || !proyecto) return;
    // En modo terceros se vuelve a medir el GPS justo ahora: no basta con la lectura de hace un rato.
    let posFinal = pos;
    if (terceros) {
      setFase('Verificando ubicación…');
      posFinal = await obtenerPosicion('alta');
      setFase(null);
      const v = evaluarCaptura({ modoTerceros: true, jornadaActiva, posicion: posFinal, precisionMaxM: ajustes.precisionMaxM });
      if (!v.ok) { setPos(posFinal); await avisar('No se puede capturar', v.mensaje); return; }
    }
    let aviso = '';
    let car = caracteristicasVacias();
    let confianza: LuminariaBorrador['confianza'] = '';
    try {
      if (conIA && !hayConexion()) {
        aviso += 'Sin conexión: llena los datos a mano (puedes usar las opciones rápidas). Con señal, toca "Re-analizar con IA". ';
      } else if (conIA) {
        setFase('Analizando la luminaria con IA…');
        cancelar.current = new AbortController();
        try {
          const r = await analizarFotosCon(cargarAjustes, await Promise.all(tomadas.map((f) => blobABase64(f.blob))), cancelar.current.signal);
          car = r.caracteristicas; confianza = r.confianza;
        } catch (e: any) { aviso += `${e.message ?? 'No se pudo analizar la foto.'} `; }
        cancelar.current = null;
      }
      setFase('Guardando fotos…');
      const ids = await Promise.all(tomadas.map((f) => guardarFoto(f.blob)));
      if (!posFinal) aviso += 'No se obtuvo la coordenada: ingrésala manualmente. ';
      const ahora = new Date().toISOString();
      const borrador: LuminariaBorrador = {
        ...car, uuid: nuevoUuid(), proyectoId: proyecto.id, creadoEn: ahora, actualizadoEn: ahora, fotos: ids, confianza,
        latitud: posFinal?.latitud ?? null, longitud: posFinal?.longitud ?? null, precisionM: posFinal?.precisionM ?? null,
        direccion: '', codigo: '', tecnico: ajustes.tecnico,
        // las fotos elegidas con el selector del sistema no se pueden verificar: se marcan como "galería" y el servidor las audita
        origen: tomadas.some((f) => f.origen === 'galeria') ? 'galeria' : 'camara',
        ubicacionSimulada: !!posFinal?.simulada,
        jornadaId: jornadaActiva ? estado!.id : '',
      };
      await guardarKv('borrador', JSON.stringify({ borrador, aviso: aviso.trim() || undefined }));
      ir('/editar/nuevo', true);
    } finally { setFase(null); }
  };

  // Puerta del modo terceros: sin jornada activa no se puede capturar
  if (terceros && !jornadaActiva) {
    return (
      <>
        <Cabecera titulo="Nueva luminaria" atras={volver} />
        <div className="pila" style={{ textAlign: 'center', marginTop: 40 }}>
          <div style={{ color: 'var(--primario)' }}><Icono nombre="reloj" tam={56} /></div>
          <h2>Inicia tu jornada para capturar</h2>
          <p className="muted">Las luminarias se registran durante la jornada de trabajo. Al iniciarla, tu empresa recibe tu ubicación solo mientras esté activa y la página abierta.</p>
          {estado?.fase === 'pausada' ? <Boton texto="Reanudar jornada" onClick={() => reanudar()} /> : <Boton texto="Iniciar jornada" cargando={iniciando} onClick={empezar} />}
        </div>
      </>
    );
  }

  const calidad = pos?.precisionM == null ? '' : pos.precisionM <= 10 ? 'var(--ok)' : pos.precisionM <= 30 ? 'var(--aviso)' : 'var(--peligro)';

  return (
    <>
      <Cabecera titulo="Nueva luminaria" atras={volver} />
      <p className="muted" style={{ marginBottom: 14 }}>
        Con una foto general basta. Si añades la <b style={{ color: 'var(--texto)' }}>placa</b> y la <b style={{ color: 'var(--texto)' }}>fotocelda</b>, la IA identifica mucho mejor marca, potencia y pines.
      </p>

      {terceros && !evaluacion.ok && <p className="aviso" role="status">{evaluacion.mensaje}</p>}
      <div className="tarjeta gps" data-testid="gps">
        <span style={{ color: calidad || 'var(--muted)' }}>{buscandoGps ? <span className="girar" /> : <Icono nombre="gps" />}</span>
        <div>
          <b>{buscandoGps ? 'Buscando señal GPS…' : pos ? `${pos.latitud.toFixed(6)}, ${pos.longitud.toFixed(6)}` : 'Sin coordenada'}</b>
          <span className="muted" style={{ fontSize: 12 }}>{pos?.precisionM != null ? `Precisión ≈ ${Math.round(pos.precisionM)} m` : 'Permite la ubicación en el navegador'}</span>
        </div>
        <button type="button" className="icono-btn" aria-label="Actualizar GPS" onClick={refrescarGps}><Icono nombre="actualizar" /></button>
      </div>

      <div className="ranuras">
        {RANURAS.map((r, i) => (
          <div key={r.titulo}>
            <button type="button" className="ranura" aria-label={`Foto ${r.titulo}`} data-testid={`ranura-${i}`} onClick={() => setCamaraEn(i)}>
              {fotos[i] ? <img src={fotos[i]!.url} alt={`Foto ${r.titulo}`} /> : <Icono nombre={r.icono} tam={30} />}
            </button>
            {fotos[i] && <button type="button" className="icono-btn" style={{ width: '100%', height: 30, fontSize: 12 }} onClick={() => quitar(i)}>Quitar</button>}
            <div className="ranura-nombre">{r.titulo}</div>
          </div>
        ))}
      </div>

      <div className="pila" style={{ marginTop: 24 }}>
        <Boton texto="Analizar con IA" icono="chispa" deshabilitado={!tomadas.length || !evaluacion.ok} onClick={() => continuar(true)} />
        <Boton texto="Llenar manualmente" variante="secundario" deshabilitado={!tomadas.length || !evaluacion.ok} onClick={() => continuar(false)} />
      </div>

      {camaraEn !== null && (
        <Camara titulo={RANURAS[camaraEn].titulo} ayuda={RANURAS[camaraEn].ayuda} permitirArchivo={galeriaPermitida(terceros)}
          alCapturar={(b, o) => alCapturar(camaraEn, b, o)} alCerrar={() => setCamaraEn(null)} />
      )}
      {fase && (
        <div className="cubierta" role="status">
          <Cargando texto={fase} />
          {fase.startsWith('Analizando') && <Boton texto="Omitir y llenar manualmente" variante="secundario" bloque={false} onClick={() => cancelar.current?.abort()} />}
        </div>
      )}
    </>
  );
}
