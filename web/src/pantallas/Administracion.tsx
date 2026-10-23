import { useCallback, useEffect, useState } from 'react';
import { rolDe, type Rol } from '@compartido/core/ajustes';
import { avisar, confirmar } from '../componentes/dialogos';
import { Boton, Cabecera, Campo, Cargando, Ficha, Hoja, Seccion, Segmentado } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { elegirIA, enlaceDeAcceso, elegirModeloGemini, estadoIA, guardarUsuario, listarUsuarios, modelosGemini, probarIA, type EstadoIA, type Proveedor, type ResultadoPrueba, type Usuario } from '../servicios/identidad';

const ROLES: { valor: Rol; texto: string }[] = [{ valor: 'tecnico', texto: 'Técnico' }, { valor: 'supervisor', texto: 'Supervisor' }, { valor: 'admin', texto: 'Administrador' }];
const TEXTO_ROL: Record<Rol, string> = { tecnico: 'Técnico', supervisor: 'Supervisor', admin: 'Administrador' };

interface Edicion { original?: Usuario; nombre: string; rol: Rol; activo: boolean; terceros: boolean }

/** Menú de administración: crea personas, define su rol, da de baja y entrega el enlace de acceso. Solo administradores. */
export function Administracion() {
  const { ajustes, proyectos } = useApp();
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [error, setError] = useState('');
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enlace, setEnlace] = useState<{ usuario: Usuario; url: string } | null>(null);
  const [ia, setIa] = useState<EstadoIA | null>(null);
  const [prueba, setPrueba] = useState<Record<Proveedor, ResultadoPrueba> | null>(null);
  const [probando, setProbando] = useState(false);
  const [modelos, setModelos] = useState<{ modelos: string[]; actual: string; sugerido: string; mensaje?: string } | null>(null);

  const cargar = useCallback(async () => {
    try { setLista(await listarUsuarios()); setError(''); } catch (e: any) { setError(e.message ?? String(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { estadoIA().then(setIa).catch(() => {}); }, []);

  const cambiarIA = async (p: Proveedor) => {
    try { setIa(await elegirIA(p)); setPrueba(null); } catch (e: any) { await avisar('No se pudo cambiar la IA', e.message ?? String(e)); }
  };
  const verModelos = async () => {
    try { setModelos(await modelosGemini()); } catch (e: any) { await avisar('No se pudieron listar los modelos', e.message ?? String(e)); }
  };
  const usarModelo = async (m: string) => {
    try { setIa(await elegirModeloGemini(m)); setModelos(null); setPrueba(null); await avisar('Modelo guardado', m === 'auto' ? 'Gemini elegirá solo un modelo disponible.' : `Gemini usará ${m}. Pulsa "Probar la IA" para comprobarlo.`); }
    catch (e: any) { await avisar('No se pudo guardar el modelo', e.message ?? String(e)); }
  };
  const probar = async () => {
    setProbando(true); setPrueba(null);
    try { setPrueba(await probarIA()); } catch (e: any) { await avisar('No se pudo probar la IA', e.message ?? String(e)); }
    finally { setProbando(false); }
  };

  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Administración" atras={() => ir('/ajustes')} /><p className="muted">Solo los administradores pueden gestionar usuarios.</p></>;

  const mostrarEnlace = async (u: Usuario, terceros: boolean) => {
    setEnlace({ usuario: u, url: await enlaceDeAcceso(u, { proyectos: proyectos.map((p) => p.nombre), terceros }) });
  };

  const guardar = async (claveNueva = false) => {
    if (!edicion) return;
    const nombre = edicion.nombre.trim();
    if (!nombre) { await avisar('Falta el nombre', 'Escribe el nombre completo de la persona.'); return; }
    if (claveNueva && !(await confirmar('Generar clave nueva', 'La clave anterior dejará de funcionar y tendrás que enviarle el enlace nuevo.', 'Generar'))) return;
    setOcupado(true);
    try {
      const u = await guardarUsuario({ nombre, rol: edicion.rol, activo: edicion.activo, claveNueva });
      const terceros = edicion.terceros;
      setEdicion(null);
      await cargar();
      if (u.activo) await mostrarEnlace(u, terceros);
    } catch (e: any) { await avisar('No se pudo guardar', e.message ?? String(e)); }
    finally { setOcupado(false); }
  };

  const compartir = async () => {
    if (!enlace) return;
    const texto = `Hola ${enlace.usuario.nombre}, abre este enlace en tu teléfono para entrar a ELI-LUMINARIA (es personal, no lo reenvíes):`;
    try {
      if (navigator.share) { await navigator.share({ title: 'ELI-LUMINARIA', text: texto, url: enlace.url }); return; }
    } catch (e: any) { if (e?.name === 'AbortError') return; }
    await copiar();
  };
  const copiar = async () => {
    if (!enlace) return;
    try { await navigator.clipboard.writeText(enlace.url); await avisar('Enlace copiado', 'Pégalo en un mensaje privado a esa persona.'); }
    catch { await avisar('No se pudo copiar', 'Mantén pulsado el enlace de la ventana para copiarlo.'); }
  };

  return (
    <>
      <Cabecera titulo="Administración" subtitulo="Personas con acceso y su rol" atras={() => ir('/ajustes')}
        acciones={[{ icono: 'mas', etiqueta: 'Nuevo usuario', onClick: () => setEdicion({ nombre: '', rol: 'tecnico', activo: true, terceros: false }) }]} />
      <p className="muted" style={{ marginBottom: 12 }}>
        <b>Técnico:</b> captura y ve sus registros. <b>Supervisor:</b> además ve el panel del equipo y puede capturar. <b>Administrador:</b> además crea y da de baja usuarios.
      </p>
      <Seccion>Inteligencia artificial</Seccion>
      <p className="muted" style={{ marginBottom: 8 }}>Elige cuál IA analiza primero las fotos. Si falla (sin créditos, límite de uso o caída), el sistema usa la otra automáticamente, si tiene clave.</p>
      <Segmentado valor={ia?.principal ?? 'gemini'} alCambiar={cambiarIA} opciones={[{ valor: 'gemini', texto: 'Gemini (gratis)' }, { valor: 'claude', texto: 'Claude' }]} />
      {ia && <p className="muted" style={{ margin: '8px 0' }}>Claves en el servidor: Gemini {ia.disponibles.gemini ? '✅' : '❌ falta'} · Claude {ia.disponibles.claude ? '✅' : '❌ falta'}. Modelo de Gemini: {ia.modeloGemini}.</p>}
      <Boton texto="Probar la IA" variante="secundario" cargando={probando} onClick={probar} />
      <Boton texto="Elegir el modelo de Gemini" variante="secundario" onClick={verModelos} />
      {modelos && (
        <div role="group" aria-label="Modelos de Gemini" style={{ margin: '8px 0' }}>
          {modelos.mensaje && <p className="muted">{modelos.mensaje}</p>}
          {!modelos.mensaje && !modelos.modelos.length && <p className="muted">Google no devolvió modelos para esta clave. Revisa que la clave sea válida.</p>}
          <div className="fichas">
            <button type="button" className="ficha" onClick={() => usarModelo('auto')}>Automático{modelos.sugerido ? ` (${modelos.sugerido})` : ''}</button>
            {modelos.modelos.map((m) => <button key={m} type="button" className={`ficha${m === modelos.actual ? ' activa' : ''}`} aria-pressed={m === modelos.actual} onClick={() => usarModelo(m)}>{m}</button>)}
          </div>
        </div>
      )}
      {prueba && (['gemini', 'claude'] as Proveedor[]).map((p) => (
        <p key={p} role="status" style={{ margin: '8px 0' }}><b>{p === 'gemini' ? 'Gemini' : 'Claude'}:</b> {prueba[p].ok ? '✅ funciona' : `❌ ${prueba[p].estado ? `error ${prueba[p].estado} — ` : ''}${prueba[p].mensaje}`}</p>
      ))}

      <Seccion>Personas</Seccion>
      {!!error && <p className="aviso" role="alert">{error}</p>}
      {!lista && !error && <Cargando texto="Cargando usuarios…" />}
      {lista && !lista.length && <p className="muted">Aún no hay usuarios. Toca + para crear el primero.</p>}
      <div className="pila">
        {lista?.map((u) => (
          <button key={u.nombre} type="button" className="tarjeta item" style={{ opacity: u.activo ? 1 : 0.6 }} aria-label={`${u.nombre}, ${TEXTO_ROL[u.rol]}${u.activo ? '' : ', de baja'}`}
            onClick={() => setEdicion({ original: u, nombre: u.nombre, rol: u.rol, activo: u.activo, terceros: false })}>
            <div style={{ flex: 1 }}>
              <div className="t">{u.nombre}</div>
              <div className="etq"><Ficha texto={TEXTO_ROL[u.rol]} color={u.rol === 'admin' ? 'primario' : u.rol === 'supervisor' ? 'aviso' : undefined} />{!u.activo && <Ficha texto="De baja" color="peligro" />}</div>
            </div>
          </button>
        ))}
      </div>

      <Hoja abierta={!!edicion} alCerrar={() => setEdicion(null)} titulo={edicion?.original ? 'Editar usuario' : 'Nuevo usuario'}>
        <Campo etiqueta="Nombre" valor={edicion?.nombre ?? ''} alCambiar={(t) => setEdicion((e) => e && { ...e, nombre: t })} pista="Ej. Juan Pérez" soloLectura={!!edicion?.original} />
        <p className="muted" style={{ margin: '4px 0' }}>Rol</p>
        <Segmentado valor={edicion?.rol ?? 'tecnico'} alCambiar={(rol) => setEdicion((e) => e && { ...e, rol })} opciones={ROLES} />
        <label className="interruptor" style={{ marginTop: 12 }}><input type="checkbox" checked={edicion?.activo ?? true} onChange={(e) => setEdicion((x) => x && { ...x, activo: e.target.checked })} /> Con acceso (desmarca para dar de baja)</label>
        {edicion?.rol === 'tecnico' && <label className="interruptor"><input type="checkbox" checked={edicion.terceros} onChange={(e) => setEdicion((x) => x && { ...x, terceros: e.target.checked })} /> Contratista (modo terceros: solo con jornada, cámara y GPS preciso)</label>}
        <div className="pila">
          <Boton texto={edicion?.original ? 'Guardar y ver enlace' : 'Crear y ver enlace'} cargando={ocupado} onClick={() => guardar(false)} />
          {!!edicion?.original && <Boton texto="Generar clave nueva" variante="secundario" deshabilitado={ocupado} onClick={() => guardar(true)} />}
        </div>
      </Hoja>

      <Hoja abierta={!!enlace} alCerrar={() => setEnlace(null)} titulo={`Acceso de ${enlace?.usuario.nombre ?? ''}`}>
        <Seccion>Enlace personal</Seccion>
        <p className="muted">Al abrirlo en su teléfono, la app queda lista (servidor, clave y proyectos). Contiene su clave: envíalo en un mensaje privado.</p>
        <textarea readOnly rows={4} value={enlace?.url ?? ''} aria-label="Enlace de acceso" onFocus={(e) => e.currentTarget.select()} style={{ width: '100%', fontSize: 12 }} />
        <div className="pila">
          <Boton texto="Compartir" icono="copiar" onClick={compartir} />
          <Boton texto="Copiar enlace" variante="secundario" onClick={copiar} />
        </div>
      </Hoja>
    </>
  );
}
