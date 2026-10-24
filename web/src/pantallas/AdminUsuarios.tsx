import { useCallback, useEffect, useState } from 'react';
import { rolDe, type Rol } from '@compartido/core/ajustes';
import { avisar, confirmar } from '../componentes/dialogos';
import { Boton, Cabecera, Campo, Cargando, Ficha, Hoja, Seccion, Segmentado } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { enlaceDeAcceso, guardarUsuario, listarUsuarios, type Usuario } from '../servicios/identidad';

const ROLES: { valor: Rol; texto: string }[] = [{ valor: 'tecnico', texto: 'Técnico' }, { valor: 'supervisor', texto: 'Supervisor' }, { valor: 'admin', texto: 'Administrador' }];
const TEXTO_ROL: Record<Rol, string> = { tecnico: 'Técnico', supervisor: 'Supervisor', admin: 'Administrador' };

interface Edicion { original?: Usuario; nombre: string; rol: Rol; activo: boolean; terceros: boolean; clave: string }

/** Administración de usuarios: crea personas con usuario y clave, define su rol, da de baja y entrega sus datos de acceso. Solo administradores. */
export function AdminUsuarios() {
  const { ajustes, proyectos } = useApp();
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [error, setError] = useState('');
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [acceso, setAcceso] = useState<{ usuario: Usuario; url: string } | null>(null);

  const cargar = useCallback(async () => {
    try { setLista(await listarUsuarios()); setError(''); } catch (e: any) { setError(e.message ?? String(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Usuarios" atras={() => ir('/admin')} /><p className="muted">Solo los administradores pueden gestionar usuarios.</p></>;

  const direccion = `${location.origin}${location.pathname}`;
  const mostrarAcceso = async (u: Usuario) => setAcceso({ usuario: u, url: await enlaceDeAcceso(u, { proyectos: proyectos.map((p) => p.nombre), terceros: !!u.terceros && u.rol === 'tecnico' }) });
  const mensajeDeAcceso = (u: Usuario) => `ELI-LUMINARIA\nEntra aquí: ${direccion}\nUsuario: ${u.nombre}\nClave: ${u.clave}\n(Es personal: no la compartas.)`;

  const guardar = async (claveNueva = false) => {
    if (!edicion) return;
    const nombre = edicion.nombre.trim();
    if (!nombre) { await avisar('Falta el nombre', 'Escribe el nombre completo de la persona.'); return; }
    const clave = edicion.clave.trim();
    if (clave && (clave.length < 8 || /\s/.test(clave))) { await avisar('Clave no válida', 'La clave debe tener al menos 8 caracteres y no puede llevar espacios. Déjala vacía para que el sistema genere una.'); return; }
    if (claveNueva && !(await confirmar('Generar clave nueva', 'La clave anterior dejará de funcionar y tendrás que entregarle la nueva.', 'Generar'))) return;
    setOcupado(true);
    try {
      const u = await guardarUsuario({ nombre, rol: edicion.rol, activo: edicion.activo, terceros: edicion.rol === 'tecnico' && edicion.terceros, claveNueva: claveNueva && !clave, ...(clave ? { clave } : {}) });
      setEdicion(null);
      await cargar();
      if (u.activo) await mostrarAcceso(u);
    } catch (e: any) { await avisar('No se pudo guardar', e.message ?? String(e)); }
    finally { setOcupado(false); }
  };

  const compartir = async () => {
    if (!acceso) return;
    try { if (navigator.share) { await navigator.share({ title: 'ELI-LUMINARIA', text: mensajeDeAcceso(acceso.usuario) }); return; } }
    catch (e: any) { if (e?.name === 'AbortError') return; }
    await copiar(mensajeDeAcceso(acceso.usuario), 'Datos copiados');
  };
  const copiar = async (texto: string, titulo: string) => {
    try { await navigator.clipboard.writeText(texto); await avisar(titulo, 'Pégalo en un mensaje privado a esa persona.'); }
    catch { await avisar('No se pudo copiar', 'Mantén pulsado el texto de la ventana para copiarlo.'); }
  };

  return (
    <>
      <Cabecera titulo="Usuarios" subtitulo="Personas con acceso y su rol" atras={() => ir('/admin')}
        acciones={[{ icono: 'mas', etiqueta: 'Nuevo usuario', onClick: () => setEdicion({ nombre: '', rol: 'tecnico', activo: true, terceros: false, clave: '' }) }]} />
      <p className="muted" style={{ marginBottom: 12 }}>
        Cada persona entra a la web con su <b>usuario</b> (su nombre) y su <b>clave</b>. <b>Técnico:</b> captura y ve sus registros. <b>Supervisor:</b> además ve el panel del equipo. <b>Administrador:</b> además crea y da de baja usuarios.
      </p>
      {!!error && <p className="aviso" role="alert">{error}</p>}
      {!lista && !error && <Cargando texto="Cargando usuarios…" />}
      {lista && !lista.length && <p className="muted">Aún no hay usuarios. Toca + para crear el primero.</p>}
      <div className="pila">
        {lista?.map((u) => (
          <button key={u.nombre} type="button" className="tarjeta item" style={{ opacity: u.activo ? 1 : 0.6 }} aria-label={`${u.nombre}, ${TEXTO_ROL[u.rol]}${u.activo ? '' : ', de baja'}`}
            onClick={() => setEdicion({ original: u, nombre: u.nombre, rol: u.rol, activo: u.activo, terceros: !!u.terceros, clave: '' })}>
            <div style={{ flex: 1 }}>
              <div className="t">{u.nombre}</div>
              <div className="etq"><Ficha texto={TEXTO_ROL[u.rol]} color={u.rol === 'admin' ? 'primario' : u.rol === 'supervisor' ? 'aviso' : undefined} />{!!u.terceros && <Ficha texto="Contratista" color="aviso" />}{!u.activo && <Ficha texto="De baja" color="peligro" />}</div>
            </div>
          </button>
        ))}
      </div>

      <Hoja abierta={!!edicion} alCerrar={() => setEdicion(null)} titulo={edicion?.original ? 'Editar usuario' : 'Nuevo usuario'}>
        <Campo etiqueta="Nombre (es su usuario)" valor={edicion?.nombre ?? ''} alCambiar={(t) => setEdicion((e) => e && { ...e, nombre: t })} pista="Ej. Juan Pérez" soloLectura={!!edicion?.original} />
        <Campo etiqueta={edicion?.original ? 'Clave nueva (opcional)' : 'Clave (opcional)'} valor={edicion?.clave ?? ''} alCambiar={(t) => setEdicion((e) => e && { ...e, clave: t })} pista={edicion?.original ? 'Déjala vacía para conservar la actual' : 'Vacía = el sistema genera una fácil de teclear'} />
        <p className="muted" style={{ margin: '4px 0' }}>Rol</p>
        <Segmentado valor={edicion?.rol ?? 'tecnico'} alCambiar={(rol) => setEdicion((e) => e && { ...e, rol })} opciones={ROLES} />
        <label className="interruptor" style={{ marginTop: 12 }}><input type="checkbox" checked={edicion?.activo ?? true} onChange={(e) => setEdicion((x) => x && { ...x, activo: e.target.checked })} /> Con acceso (desmarca para dar de baja)</label>
        {edicion?.rol === 'tecnico' && <label className="interruptor"><input type="checkbox" checked={edicion.terceros} onChange={(e) => setEdicion((x) => x && { ...x, terceros: e.target.checked })} /> Contratista (modo terceros: solo con jornada, cámara y GPS preciso)</label>}
        <div className="pila">
          <Boton texto={edicion?.original ? 'Guardar y ver datos de acceso' : 'Crear y ver datos de acceso'} cargando={ocupado} onClick={() => guardar(false)} />
          {!!edicion?.original && <Boton texto="Generar clave nueva" variante="secundario" deshabilitado={ocupado} onClick={() => guardar(true)} />}
        </div>
      </Hoja>

      <Hoja abierta={!!acceso} alCerrar={() => setAcceso(null)} titulo={`Acceso de ${acceso?.usuario.nombre ?? ''}`}>
        <p className="muted">Entrega estos datos en privado. La persona abre la dirección, escribe su usuario y su clave, y listo.</p>
        <dl className="acceso">
          <dt>Dirección</dt><dd data-testid="acceso-direccion">{direccion}</dd>
          <dt>Usuario</dt><dd data-testid="acceso-usuario">{acceso?.usuario.nombre}</dd>
          <dt>Clave</dt><dd data-testid="acceso-clave">{acceso?.usuario.clave}</dd>
        </dl>
        <div className="pila">
          <Boton texto="Compartir datos de acceso" icono="copiar" onClick={compartir} />
          <Boton texto="Copiar datos" variante="secundario" onClick={() => acceso && copiar(mensajeDeAcceso(acceso.usuario), 'Datos copiados')} />
        </div>
        <Seccion>Enlace directo (alternativa)</Seccion>
        <p className="muted">Deja el teléfono listo con un toque, sin escribir nada. Contiene su clave: envíalo solo en privado.</p>
        <textarea readOnly rows={3} value={acceso?.url ?? ''} aria-label="Enlace de acceso" onFocus={(e) => e.currentTarget.select()} style={{ width: '100%', fontSize: 12 }} />
        <Boton texto="Copiar enlace" variante="secundario" onClick={() => acceso && copiar(acceso.url, 'Enlace copiado')} />
      </Hoja>
    </>
  );
}
