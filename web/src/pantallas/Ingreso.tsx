import { FormEvent, useEffect, useState } from 'react';
import { Boton, Campo } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { ErrorIngreso, ingresar, servidorPorDefecto } from '../servicios/identidad';

/** Pantalla de entrada: usuario y clave que entrega el administrador. Es lo primero que ve quien aún no ha ingresado. */
export function Ingreso() {
  const { configCambiada, refrescar } = useApp();
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [servidor, setServidor] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [avanzado, setAvanzado] = useState(false);
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  useEffect(() => { servidorPorDefecto().then((s) => { setServidor(s); if (!s) setAvanzado(true); }); }, []);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !clave.trim()) { setError('Escribe tu usuario y tu clave.'); return; }
    setEntrando(true); setError('');
    try {
      await ingresar(servidor, usuario, clave);
      configCambiada(); await refrescar();
      ir('/', true);
    } catch (err: any) { setError(err instanceof ErrorIngreso ? err.message : 'No se pudo ingresar. Inténtalo de nuevo.'); }
    finally { setEntrando(false); }
  };

  return (
    <form className="ingreso" onSubmit={entrar} aria-label="Ingreso">
      <h1>ELI-LUMINARIA</h1>
      <p className="muted" style={{ marginBottom: 16 }}>Ingresa con el usuario y la clave que te dio tu administrador.</p>
      <Campo etiqueta="Usuario" valor={usuario} alCambiar={setUsuario} pista="Tu nombre, como te lo dieron" autoComplete="username" />
      <Campo etiqueta="Clave" secreto={!verClave} valor={clave} alCambiar={setClave} autoComplete="current-password" />
      <label className="interruptor"><input type="checkbox" checked={verClave} onChange={(e) => setVerClave(e.target.checked)} /> Mostrar la clave</label>
      {avanzado && <Campo etiqueta="Dirección del servidor" tipo="url" valor={servidor} alCambiar={setServidor} pista="https://…workers.dev" />}
      {!!error && <p className="aviso" role="alert">{error}</p>}
      <Boton texto="Entrar" tipo="submit" cargando={entrando} />
      <div className="pila" style={{ marginTop: 14 }}>
        {!avanzado && <button type="button" className="enlace-sub" onClick={() => setAvanzado(true)}>Cambiar el servidor</button>}
        <button type="button" className="enlace-sub" onClick={() => ir('/ayuda')}>Ayuda para instalar la app</button>
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>La primera vez necesitas internet. Después podrás trabajar sin conexión.</p>
    </form>
  );
}
