import { FormEvent, useEffect, useState } from 'react';
import { Boton, Campo } from '../componentes/ui';
import { confirmar } from '../componentes/dialogos';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { cambiarDeUsuario, ErrorIngreso, ingresar, reingresar, servidorPorDefecto } from '../servicios/identidad';
import { tomarAviso, usuarioGuardado } from '../servicios/sesion';

/**
 * Pantalla de entrada. Tres casos:
 *  - nueva: usuario + clave (primera vez en este dispositivo, necesita internet);
 *  - volver a entrar: el usuario ya está y solo se pide la clave (funciona sin internet si ya se ingresó antes);
 *  - bloqueada por inactividad: solo la clave; la sesión sigue abierta por detrás.
 */
export function Ingreso() {
  const { ajustes, bloqueada, desbloquear, configCambiada, refrescar, salir } = useApp();
  const recordado = bloqueada ? (ajustes.usuario || ajustes.tecnico) : usuarioGuardado();
  const [usuario, setUsuario] = useState(recordado);
  const [clave, setClave] = useState('');
  const [servidor, setServidor] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [avanzado, setAvanzado] = useState(false);
  const [error, setError] = useState('');
  const [aviso] = useState(() => tomarAviso());
  const [entrando, setEntrando] = useState(false);
  const soloClave = !!recordado && (bloqueada || usuario === recordado);

  useEffect(() => { servidorPorDefecto().then((s) => { setServidor(s); if (!s && !recordado) setAvanzado(true); }); }, [recordado]);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    if (!clave.trim() || (!usuario.trim() && !bloqueada)) { setError(bloqueada ? 'Escribe tu clave.' : 'Escribe tu usuario y tu clave.'); return; }
    setError('');
    if (bloqueada) { if (!desbloquear(clave)) { setError('Clave incorrecta.'); setClave(''); } return; }
    setEntrando(true);
    try {
      if (recordado && usuario.trim().toLowerCase() === recordado.toLowerCase() && !avanzado) await reingresar(usuario, clave);
      else await ingresar(servidor, usuario, clave);
      configCambiada(); await refrescar();
      ir('/', true);
    } catch (err: any) { setError(err instanceof ErrorIngreso ? err.message : 'No se pudo ingresar. Inténtalo de nuevo.'); setClave(''); }
    finally { setEntrando(false); }
  };

  const otroUsuario = async () => {
    if (!(await confirmar('Entrar con otro usuario', 'Este dispositivo dejará de recordar al usuario anterior. Los registros que ya estén guardados aquí se conservan.', 'Continuar'))) return;
    await cambiarDeUsuario(); configCambiada(); setUsuario(''); setClave(''); setError('');
  };

  return (
    <form className="ingreso" onSubmit={entrar} aria-label={bloqueada ? 'Pantalla bloqueada' : 'Ingreso'}>
      <h1>ELI-LUMINARIA</h1>
      {bloqueada
        ? <p className="muted" style={{ marginBottom: 16 }}>🔒 Por seguridad, la app se bloqueó tras {15} minutos sin usarla. Escribe tu clave para continuar{ajustes.tecnico ? `, ${ajustes.tecnico}` : ''}.</p>
        : <p className="muted" style={{ marginBottom: 16 }}>{recordado ? <>Hola de nuevo. Escribe tu clave para entrar.</> : <>Ingresa con el usuario y la clave que te dio tu administrador.</>}</p>}
      {!!aviso && <p className="aviso" role="status">{aviso}</p>}
      {!bloqueada && <Campo etiqueta="Usuario" valor={usuario} alCambiar={setUsuario} pista="Tu usuario, como te lo dieron" autoComplete="username" soloLectura={false} />}
      <Campo etiqueta="Clave" secreto={!verClave} valor={clave} alCambiar={setClave} autoComplete="current-password" />
      <label className="interruptor"><input type="checkbox" checked={verClave} onChange={(e) => setVerClave(e.target.checked)} /> Mostrar la clave</label>
      {avanzado && !bloqueada && <Campo etiqueta="Dirección del servidor" tipo="url" valor={servidor} alCambiar={setServidor} pista="https://…workers.dev" />}
      {!!error && <p className="aviso" role="alert">{error}</p>}
      <Boton texto={bloqueada ? 'Desbloquear' : 'Entrar'} tipo="submit" cargando={entrando} />
      <div className="pila" style={{ marginTop: 14 }}>
        {bloqueada && <button type="button" className="enlace-sub" onClick={salir}>Salir de la cuenta</button>}
        {!bloqueada && !!recordado && soloClave && <button type="button" className="enlace-sub" onClick={otroUsuario}>Entrar con otro usuario</button>}
        {!bloqueada && !avanzado && <button type="button" className="enlace-sub" onClick={() => setAvanzado(true)}>Cambiar el servidor</button>}
        {!bloqueada && <button type="button" className="enlace-sub" onClick={() => ir('/ayuda')}>Ayuda para instalar la app</button>}
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>La primera vez en un teléfono necesitas internet. Después puedes entrar y trabajar sin conexión.</p>
    </form>
  );
}
