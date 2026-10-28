import { useCallback, useEffect, useState } from 'react';
import { rolDe, type Rol } from '@compartido/core/ajustes';
import { avisar, confirmar } from '../componentes/dialogos';
import { Boton, Cabecera, Campo, Cargando, Ficha, Hoja, Seccion, Segmentado } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { eliminarUsuario, enlaceDeAcceso, guardarUsuario, listarUsuarios, type Usuario } from '../servicios/identidad';
import { normalizar } from '../servicios/sesion';
import { codigoPaisDeLaEmpresa, enlaceWa } from '../servicios/whatsapp';

const ROLES: { valor: Rol; texto: string }[] = [{ valor: 'tecnico', texto: 'Técnico' }, { valor: 'supervisor', texto: 'Supervisor' }, { valor: 'admin', texto: 'Administrador' }];
const TEXTO_ROL: Record<Rol, string> = { tecnico: 'Técnico', supervisor: 'Supervisor', admin: 'Administrador' };

interface Edicion { original?: Usuario; nombre: string; usuario: string; telefono: string; usuarioTocado: boolean; rol: Rol; activo: boolean; terceros: boolean; clave: string; proyectos: string[]; tecnicos: string[] }

/** Propuesta de usuario a partir del nombre: inicial del primer nombre + último apellido, en minúsculas y sin tildes (Juan Pérez → jperez). */
export const sugerirUsuario = (nombre: string) => {
  const p = normalizar(nombre).split(' ').filter(Boolean);
  if (!p.length) return '';
  return (p.length === 1 ? p[0] : p[0][0] + p[p.length - 1]).replace(/[^a-z0-9]/g, '');
};

/** Administración de usuarios: crea personas con usuario y clave, define su rol, da de baja y entrega sus datos de acceso. Solo administradores. */
export function AdminUsuarios() {
  const { ajustes, proyectos, inactivos } = useApp();
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [superusuarios, setSuperusuarios] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [acceso, setAcceso] = useState<{ usuario: Usuario; url: string } | null>(null);
  const [pais, setPais] = useState('57');
  const [verBajas, setVerBajas] = useState(false);
  useEffect(() => { codigoPaisDeLaEmpresa().then(setPais); }, []);

  const cargar = useCallback(async () => {
    try { const r = await listarUsuarios(); setLista(r.usuarios); setSuperusuarios(r.superusuarios); setError(''); } catch (e: any) { setError(e.message ?? String(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Usuarios" atras={() => ir('/admin')} /><p className="muted">Solo los administradores pueden gestionar usuarios.</p></>;

  const todosProyectos = [...proyectos, ...inactivos].filter((p) => !!p.idHoja);
  const tecnicosActivos = (lista ?? []).filter((u) => u.rol === 'tecnico' && u.activo);
  const alternar = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  const direccion = `${location.origin}${location.pathname}`;
  const mostrarAcceso = async (u: Usuario) => setAcceso({ usuario: u, url: await enlaceDeAcceso(u, { proyectos: proyectos.map((p) => p.nombre), terceros: !!u.terceros && u.rol === 'tecnico' }) });
  const mensajeDeAcceso = (u: Usuario) => `ELI-LUMINARIA\nEntra aquí: ${direccion}\nUsuario: ${u.usuario}\nClave: ${u.clave}\n(Es personal: no la compartas.)`;

  const guardar = async (claveNueva = false) => {
    if (!edicion) return;
    const nombre = edicion.nombre.trim();
    if (!nombre) { await avisar('Falta el nombre', 'Escribe el nombre completo de la persona.'); return; }
    const usuario = edicion.usuario.trim();
    if (usuario.length < 2) { await avisar('Falta el usuario', 'Escribe el usuario con el que va a entrar (por ejemplo jperez).'); return; }
    const clave = edicion.clave.trim();
    if (clave && (clave.length < 8 || /\s/.test(clave))) { await avisar('Clave no válida', 'La clave debe tener al menos 8 caracteres y no puede llevar espacios. Déjala vacía para que el sistema genere una.'); return; }
    if (claveNueva && !(await confirmar('Generar clave nueva', 'La clave anterior dejará de funcionar y tendrás que entregarle la nueva.', 'Generar'))) return;
    setOcupado(true);
    try {
      const u = await guardarUsuario({ nombre, usuario, telefono: edicion.telefono.trim(), rol: edicion.rol, activo: edicion.activo, terceros: edicion.rol === 'tecnico' && edicion.terceros, claveNueva: claveNueva && !clave, ...(clave ? { clave } : {}), ...(edicion.rol === 'supervisor' ? { proyectos: edicion.proyectos, tecnicos: edicion.tecnicos } : {}) });
      setEdicion(null);
      await cargar();
      if (u.activo) await mostrarAcceso(u);
    } catch (e: any) { await avisar('No se pudo guardar', e.message ?? String(e)); }
    finally { setOcupado(false); }
  };

  /** Eliminación definitiva: la cuenta desaparece (sus registros se conservan en la hoja con su nombre). Dos confirmaciones. */
  const eliminar = async (u: Usuario | undefined = edicion?.original) => {
    if (!u) return;
    if (!(await confirmar('Eliminar definitivamente', `Se eliminará para siempre la cuenta de ${u.nombre} (${u.usuario}): ya no podrá entrar y no se podrá recuperar. Sus registros se conservan en la hoja con su nombre.\n\nSi solo quieres quitarle el acceso por ahora, usa "Dar de baja" (desmarca "Con acceso").`, 'Continuar', true))) return;
    if (!(await confirmar('¿Seguro?', `Última confirmación: eliminar definitivamente a ${u.nombre} (${u.usuario}).`, 'Sí, eliminar', true))) return;
    setOcupado(true);
    try { await eliminarUsuario(u.usuario); setEdicion(null); await cargar(); }
    catch (e: any) { await avisar('No se pudo eliminar', e.message ?? String(e)); }
    finally { setOcupado(false); }
  };

  const reactivar = async (u: Usuario) => {
    setOcupado(true);
    try { await guardarUsuario({ nombre: u.nombre, usuario: u.usuario, telefono: u.telefono ?? '', rol: u.rol, activo: true, terceros: u.rol === 'tecnico' && !!u.terceros, claveNueva: false }); await cargar(); }
    catch (e: any) { await avisar('No se pudo reactivar', e.message ?? String(e)); }
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
        acciones={[{ icono: 'mas', etiqueta: 'Nuevo usuario', onClick: () => setEdicion({ nombre: '', usuario: '', telefono: '', usuarioTocado: false, rol: 'tecnico', activo: true, terceros: false, clave: '', proyectos: [], tecnicos: [] }) }]} />
      <p className="muted" style={{ marginBottom: 12 }}>
        Cada persona entra a la web con su <b>usuario</b> (su nombre) y su <b>clave</b>. <b>Técnico:</b> captura y ve sus registros. <b>Supervisor:</b> además ve el panel del equipo. <b>Administrador:</b> además crea y da de baja usuarios.
      </p>
      {!!error && <p className="aviso" role="alert">{error}</p>}
      {!lista && !error && <Cargando texto="Cargando usuarios…" />}
      {lista && !lista.length && <p className="muted">Aún no hay usuarios. Toca + para crear el primero.</p>}
      {superusuarios.length > 0 && (
        <div className="pila" style={{ marginBottom: 10 }} data-testid="superusuarios">
          {superusuarios.map((n) => (
            <div key={n} className="tarjeta" aria-label={`${n}, superusuario`}>
              <div className="t" style={{ fontWeight: 700 }}>{n}</div>
              <div className="s muted">Usuario: {n}</div>
              <div className="etq" style={{ marginTop: 6 }}><Ficha texto="Superusuario" color="primario" /></div>
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Administrador de la plataforma (definido en el servidor). No se edita desde aquí; es la llave de emergencia.</p>
            </div>
          ))}
        </div>
      )}
      <div className="pila">
        {lista?.filter((u) => u.activo).map((u) => (
          <button key={u.nombre} type="button" className="tarjeta item" style={{ opacity: u.activo ? 1 : 0.6 }} aria-label={`${u.nombre}, ${TEXTO_ROL[u.rol]}${u.activo ? '' : ', de baja'}`}
            onClick={() => setEdicion({ original: u, nombre: u.nombre, usuario: u.usuario, telefono: u.telefono ?? '', usuarioTocado: true, rol: u.rol, activo: u.activo, terceros: !!u.terceros, clave: '', proyectos: u.proyectos ?? [], tecnicos: u.tecnicos ?? [] })}>
            <div style={{ flex: 1 }}>
              <div className="t">{u.nombre}</div>
              <div className="s">Usuario: {u.usuario}{u.telefono ? ` · ${u.telefono}` : ''}</div>
              <div className="etq"><Ficha texto={TEXTO_ROL[u.rol]} color={u.rol === 'admin' ? 'primario' : u.rol === 'supervisor' ? 'aviso' : undefined} />{!!u.terceros && <Ficha texto="Contratista" color="aviso" />}{!u.activo && <Ficha texto="De baja" color="peligro" />}</div>
            </div>
          </button>
        ))}
      </div>

      {(lista?.some((u) => !u.activo)) && (
        <div style={{ marginTop: 14 }}>
          <Boton texto={verBajas ? 'Ocultar usuarios dados de baja' : `Ver usuarios dados de baja (${lista!.filter((u) => !u.activo).length})`} variante="secundario" onClick={() => setVerBajas((v) => !v)} />
          {verBajas && (
            <div className="pila" style={{ marginTop: 10 }} data-testid="usuarios-baja">
              {lista!.filter((u) => !u.activo).map((u) => (
                <div key={u.nombre} className="tarjeta" aria-label={`${u.nombre}, dado de baja`} style={{ opacity: 0.85 }}>
                  <div className="t" style={{ fontWeight: 700 }}>{u.nombre}</div>
                  <div className="s muted">Usuario: {u.usuario} · {TEXTO_ROL[u.rol]} · sin acceso</div>
                  <div className="fila" style={{ marginTop: 8, gap: 8 }}>
                    <Boton texto="Reactivar" variante="secundario" bloque={false} deshabilitado={ocupado} onClick={() => reactivar(u)} />
                    <Boton texto="Eliminar definitivamente" variante="peligro" bloque={false} deshabilitado={ocupado} onClick={() => eliminar(u)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Hoja abierta={!!edicion} alCerrar={() => setEdicion(null)} titulo={edicion?.original ? 'Editar usuario' : 'Nuevo usuario'}>
        <Campo etiqueta="Nombre completo" valor={edicion?.nombre ?? ''} alCambiar={(t) => setEdicion((e) => e && { ...e, nombre: t, usuario: e.original || e.usuarioTocado ? e.usuario : sugerirUsuario(t) })} pista="Ej. Juan Pérez" />
        <Campo etiqueta="Teléfono (WhatsApp)" valor={edicion?.telefono ?? ''} alCambiar={(t) => setEdicion((e) => e && { ...e, telefono: t })} pista="Ej. 300 123 4567 (opcional)" />
        <Campo etiqueta="Usuario (para entrar)" valor={edicion?.usuario ?? ''} alCambiar={(t) => setEdicion((e) => e && { ...e, usuario: t, usuarioTocado: true })} pista="Ej. jperez" soloLectura={!!edicion?.original} />
        <Campo etiqueta={edicion?.original ? 'Clave nueva (opcional)' : 'Clave (opcional)'} valor={edicion?.clave ?? ''} alCambiar={(t) => setEdicion((e) => e && { ...e, clave: t })} pista={edicion?.original ? 'Déjala vacía para conservar la actual' : 'Vacía = el sistema genera una fácil de teclear'} />
        <p className="muted" style={{ margin: '4px 0' }}>Rol</p>
        <Segmentado valor={edicion?.rol ?? 'tecnico'} alCambiar={(rol) => setEdicion((e) => e && { ...e, rol })} opciones={ROLES} />
        {edicion?.rol === 'supervisor' && (
          <div data-testid="alcance" style={{ marginTop: 12 }}>
            <p className="muted" style={{ margin: '4px 0' }}><b>¿Qué supervisa?</b> Marca solo lo que debe ver. Si no marcas nada en una lista, ve todo.</p>
            <p className="muted" style={{ margin: '8px 0 2px', fontWeight: 700 }}>Proyectos</p>
            {todosProyectos.map((p) => (
              <label key={p.idHoja} className="interruptor"><input type="checkbox" checked={edicion.proyectos.includes(p.idHoja!)} onChange={() => setEdicion((x) => x && { ...x, proyectos: alternar(x.proyectos, p.idHoja!) })} /> {p.nombre}</label>
            ))}
            {!todosProyectos.length && <p className="muted">Aún no hay proyectos.</p>}
            <p className="muted" style={{ margin: '8px 0 2px', fontWeight: 700 }}>Técnicos</p>
            {tecnicosActivos.map((t) => (
              <label key={t.usuario} className="interruptor"><input type="checkbox" checked={edicion.tecnicos.includes(t.usuario)} onChange={() => setEdicion((x) => x && { ...x, tecnicos: alternar(x.tecnicos, t.usuario) })} /> {t.nombre} ({t.usuario})</label>
            ))}
            {!tecnicosActivos.length && <p className="muted">Aún no hay técnicos.</p>}
          </div>
        )}
        <label className="interruptor" style={{ marginTop: 12 }}><input type="checkbox" checked={edicion?.activo ?? true} onChange={(e) => setEdicion((x) => x && { ...x, activo: e.target.checked })} /> Con acceso (desmarca para dar de baja)</label>
        {edicion?.rol === 'tecnico' && <label className="interruptor"><input type="checkbox" checked={edicion.terceros} onChange={(e) => setEdicion((x) => x && { ...x, terceros: e.target.checked })} /> Contratista (modo terceros: solo con jornada, cámara y GPS preciso)</label>}
        <div className="pila">
          <Boton texto={edicion?.original ? 'Guardar y ver datos de acceso' : 'Crear y ver datos de acceso'} cargando={ocupado} onClick={() => guardar(false)} />
          {!!edicion?.original && <Boton texto="Generar clave nueva" variante="secundario" deshabilitado={ocupado} onClick={() => guardar(true)} />}
          {!!edicion?.original && <Boton texto="Eliminar definitivamente" variante="peligro" deshabilitado={ocupado} onClick={() => eliminar()} />}
        </div>
      </Hoja>

      <Hoja abierta={!!acceso} alCerrar={() => setAcceso(null)} titulo={`Acceso de ${acceso?.usuario.nombre ?? ''}`}>
        <p className="muted">Entrega estos datos en privado. La persona abre la dirección, escribe su usuario y su clave, y listo.</p>
        <dl className="acceso">
          <dt>Dirección</dt><dd data-testid="acceso-direccion">{direccion}</dd>
          <dt>Nombre</dt><dd>{acceso?.usuario.nombre}</dd>
          <dt>Usuario</dt><dd data-testid="acceso-usuario">{acceso?.usuario.usuario}</dd>
          <dt>Clave</dt><dd data-testid="acceso-clave">{acceso?.usuario.clave}</dd>
        </dl>
        <div className="pila">
          <Boton texto="Compartir datos de acceso" icono="copiar" onClick={compartir} />
          {acceso && enlaceWa(acceso.usuario.telefono ?? '', mensajeDeAcceso(acceso.usuario), pais)
            ? <a className="boton primario bloque" style={{ textDecoration: 'none' }} href={enlaceWa(acceso.usuario.telefono ?? '', mensajeDeAcceso(acceso.usuario), pais)} target="_blank" rel="noopener noreferrer">Enviar por WhatsApp a {acceso.usuario.nombre}</a>
            : <p className="muted" style={{ fontSize: 13 }}>Agrega su teléfono al usuario para enviarle estos datos directo por WhatsApp.</p>}
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
