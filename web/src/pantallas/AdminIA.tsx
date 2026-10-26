import { useEffect, useState } from 'react';
import { rolDe } from '@compartido/core/ajustes';
import { avisar, confirmar } from '../componentes/dialogos';
import { Boton, Cabecera, Campo, Cargando, Ficha, Hoja } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import {
  elegirIA, elegirModeloIA, estadoIA, guardarBaseIA, guardarClaveIA, modelosIA, probarIA,
  type EstadoIA, type InfoIA, type ModelosIA, type ResultadoPrueba,
} from '../servicios/identidad';

const corto = (p: InfoIA) => p.nombre.split(' ')[0];

/** Administración de la IA: una tarjeta por proveedor (clave, modelo, prueba) y cuál va primero. Solo administradores. */
export function AdminIA() {
  const { ajustes } = useApp();
  const [estado, setEstado] = useState<EstadoIA | null>(null);
  const [error, setError] = useState('');
  const [pruebas, setPruebas] = useState<Record<string, ResultadoPrueba>>({});
  const [ocupado, setOcupado] = useState('');
  const [claveDe, setClaveDe] = useState<InfoIA | null>(null);
  const [clave, setClave] = useState('');
  const [base, setBase] = useState('');
  const [modelosDe, setModelosDe] = useState<{ p: InfoIA; datos: ModelosIA } | null>(null);

  useEffect(() => { estadoIA().then(setEstado).catch((e) => setError(e.message ?? String(e))); }, []);

  const hacer = async (clave_: string, f: () => Promise<void>) => {
    setOcupado(clave_);
    try { await f(); } catch (e: any) { await avisar('No se pudo completar', e.message ?? String(e)); } finally { setOcupado(''); }
  };

  const hacerPrincipal = (p: InfoIA) => hacer(`principal-${p.id}`, async () => { setEstado(await elegirIA(p.id)); setPruebas({}); });
  const probar = (p?: InfoIA) => hacer(p ? `probar-${p.id}` : 'probar-todas', async () => {
    setPruebas((a) => (p ? { ...a, [p.id]: undefined as any } : {}));
    const r = await probarIA(p?.id);
    setPruebas((a) => ({ ...a, ...r }));
  });
  const verModelos = (p: InfoIA) => hacer(`modelos-${p.id}`, async () => setModelosDe({ p, datos: await modelosIA(p.id) }));
  const usarModelo = async (m: string) => {
    if (!modelosDe) return;
    const p = modelosDe.p;
    await hacer(`modelo-${p.id}`, async () => {
      setEstado(await elegirModeloIA(p.id, m)); setModelosDe(null); setPruebas({});
      await avisar('Modelo guardado', m === 'auto' ? `${corto(p)} elegirá solo un modelo disponible.` : `${corto(p)} usará ${m}. Pulsa Probar para comprobarlo.`);
    });
  };
  const abrirClave = (p: InfoIA) => { setClaveDe(p); setClave(''); setBase(p.base ?? ''); };
  const guardarClave = async () => {
    const p = claveDe;
    if (!p) return;
    if (p.id === 'otra' && !/^https:\/\//i.test(base.trim())) { await avisar('Falta la dirección', 'Escribe la dirección del servicio, empezando por https:// (por ejemplo https://api.tuproveedor.com/v1).'); return; }
    if (clave.trim().length < 8 || /\s/.test(clave.trim())) { await avisar('Clave no válida', 'La clave debe tener al menos 8 caracteres y no puede llevar espacios.'); return; }
    await hacer(`clave-${p.id}`, async () => {
      if (p.id === 'otra') await guardarBaseIA(base.trim());
      const r = await guardarClaveIA(p.id, clave.trim());
      setEstado(r); setClaveDe(null); setClave('');
      if (r.prueba) setPruebas((a) => ({ ...a, [p.id]: r.prueba! }));
      await avisar('Clave guardada', r.prueba?.ok ? `${corto(p)} funciona. Ya puedes elegirla como principal.` : `Se guardó, pero la prueba dijo: ${r.prueba?.mensaje ?? 'sin respuesta'}\n\nRevisa el modelo con "Elegir modelo".`);
    });
  };
  const quitarClave = async (p: InfoIA) => {
    if (!(await confirmar('Quitar la clave', `Se quitará la clave de ${corto(p)} y dejará de usarse.`, 'Quitar', true))) return;
    await hacer(`quitar-${p.id}`, async () => { setEstado(await guardarClaveIA(p.id, '')); setPruebas((a) => ({ ...a, [p.id]: undefined as any })); });
  };

  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Inteligencia artificial" atras={() => ir('/ajustes')} /><p className="muted">Solo los administradores pueden gestionar la IA.</p></>;

  return (
    <>
      <Cabecera titulo="Inteligencia artificial" subtitulo="Qué IA analiza las fotos" atras={() => ir('/admin')}
        acciones={[{ icono: 'chispa', etiqueta: 'Probar todas las IAs', onClick: () => probar() }]} />
      <p className="muted" style={{ marginBottom: 10 }}>
        Agrega la clave de las IAs que quieras usar y elige cuál analiza primero. Si la principal falla (sin créditos, límite de uso o caída), el sistema prueba las demás que tengan clave. Solo sirven modelos que <b>acepten imágenes</b>.
      </p>
      {!!error && <p className="aviso" role="alert">{error}</p>}
      {!estado && !error && <Cargando texto="Cargando…" />}
      <div className="pila">
        {estado?.proveedores.map((p) => {
          const esPrincipal = estado.principal === p.id;
          const prueba = pruebas[p.id];
          return (
            <section key={p.id} className="tarjeta" aria-label={p.nombre} style={{ borderWidth: esPrincipal ? 2 : 1, borderColor: esPrincipal ? 'var(--primario)' : undefined }}>
              <div className="fila" style={{ alignItems: 'center' }}>
                <b style={{ flex: 1, fontSize: 16 }}>{p.nombre}</b>
                {esPrincipal && <Ficha texto="Principal" color="primario" />}
                <Ficha texto={p.gratis ? 'Gratis' : 'De pago'} color={p.gratis ? 'ok' : undefined} />
              </div>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0' }}>{p.nota}</p>
              <p style={{ margin: '4px 0' }}>
                {p.configurado ? <>✅ Clave configurada ({p.origenClave === 'app' ? 'pegada en la app' : 'en el servidor'})</> : <>❌ Sin clave</>}
                {p.configurado && p.modelo ? <span className="muted"> · Modelo: {p.modelo}</span> : null}
              </p>
              {prueba && <p role="status" style={{ margin: '4px 0' }}><b>{corto(p)}:</b> {prueba.ok ? '✅ funciona' : `❌ ${prueba.estado ? `error ${prueba.estado} — ` : ''}${prueba.mensaje}`}{prueba.ok && prueba.mensaje ? <span className="muted"> — {prueba.mensaje}</span> : null}</p>}
              <div className="pila" style={{ marginTop: 8 }}>
                {p.configurado && !esPrincipal && <Boton texto={`Usar ${corto(p)} como principal`} cargando={ocupado === `principal-${p.id}`} onClick={() => hacerPrincipal(p)} />}
                <Boton texto={p.configurado ? `Cambiar clave de ${corto(p)}` : `Poner clave de ${corto(p)}`} variante="secundario" onClick={() => abrirClave(p)} />
                {p.configurado && <Boton texto={`Probar ${corto(p)}`} variante="secundario" cargando={ocupado === `probar-${p.id}`} onClick={() => probar(p)} />}
                {p.configurado && p.id !== 'claude' && <Boton texto={`Elegir modelo de ${corto(p)}`} variante="secundario" cargando={ocupado === `modelos-${p.id}`} onClick={() => verModelos(p)} />}
                {p.origenClave === 'app' && <Boton texto={`Quitar clave de ${corto(p)}`} variante="peligro" onClick={() => quitarClave(p)} />}
              </div>
            </section>
          );
        })}
      </div>

      <Hoja abierta={!!claveDe} alCerrar={() => setClaveDe(null)} titulo={claveDe ? `Clave de ${claveDe.nombre}` : ''}>
        {claveDe && (
          <>
            <p className="muted">Consíguela en: <b>{claveDe.donde}</b>. Se prueba antes de guardarse, se guarda cifrada en tu cuenta de Google (no en la hoja) y nunca se vuelve a mostrar.</p>
            {claveDe.id === 'otra' && <Campo etiqueta="Dirección del servicio" tipo="url" valor={base} alCambiar={setBase} pista="https://api.tuproveedor.com/v1" />}
            <Campo etiqueta="Clave (API key)" secreto valor={clave} alCambiar={setClave} autoComplete="off" />
            <Boton texto="Probar y guardar" cargando={ocupado === `clave-${claveDe.id}`} onClick={guardarClave} />
          </>
        )}
      </Hoja>

      <Hoja abierta={!!modelosDe} alCerrar={() => setModelosDe(null)} titulo={modelosDe ? `Modelos de ${corto(modelosDe.p)}` : ''}>
        {modelosDe && (
          <div role="group" aria-label={`Modelos de ${corto(modelosDe.p)}`}>
            {modelosDe.datos.mensaje && <p className="muted">{modelosDe.datos.mensaje}</p>}
            {!modelosDe.datos.mensaje && !modelosDe.datos.modelos.length && <p className="muted">El proveedor no devolvió modelos para esta clave. Revisa que la clave sea válida.</p>}
            <p className="muted" style={{ fontSize: 13 }}>Los de visión van primero. Al elegir uno se prueba con una foto de verdad; si no sirve, no se guarda.</p>
            <div className="fichas lista">
              <button type="button" className="ficha" onClick={() => usarModelo('auto')}>Automático{modelosDe.datos.sugerido ? ` (${modelosDe.datos.sugerido})` : ''}</button>
              {modelosDe.datos.modelos.map((m) => <button key={m} type="button" className={`ficha${m === modelosDe.datos.actual ? ' activa' : ''}`} aria-pressed={m === modelosDe.datos.actual} onClick={() => usarModelo(m)}>{m}</button>)}
            </div>
          </div>
        )}
      </Hoja>
    </>
  );
}
