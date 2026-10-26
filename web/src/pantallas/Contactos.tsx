import { useEffect, useMemo, useState } from 'react';
import { rolDe, veEquipo, type Rol } from '@compartido/core/ajustes';
import { Boton, Cabecera, Cargando, Ficha } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { listarContactos, type Contacto } from '../servicios/identidad';
import { codigoPaisDeLaEmpresa, enlaceLlamada, enlaceWa, enlaceWaGeneral } from '../servicios/whatsapp';

const TEXTO_ROL: Record<Rol, string> = { tecnico: 'Técnico', supervisor: 'Supervisor', admin: 'Administrador' };
const primerNombre = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Contactos para escribir o llamar. Técnico → ve a sus supervisores; supervisor y administrador → ven a todo el equipo. */
export function Contactos() {
  const { ajustes, proyecto } = useApp();
  const esJefe = veEquipo(rolDe(ajustes));
  const [lista, setLista] = useState<Contacto[] | null>(null);
  const [error, setError] = useState('');
  const [pais, setPais] = useState('57');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => { codigoPaisDeLaEmpresa().then(setPais); }, []);
  useEffect(() => { listarContactos().then(setLista).catch((e) => setError(e.message ?? String(e))); }, []);
  useEffect(() => {
    setMensaje(esJefe ? 'Hola {nombre}, ' : `Hola, soy ${ajustes.tecnico || 'técnico'} (ELI-LUMINARIA${proyecto ? ', proyecto ' + proyecto.nombre : ''}). `);
  }, [esJefe, ajustes.tecnico, proyecto?.nombre]);

  const texto = (c: Contacto) => mensaje.replace(/\{nombre\}/g, primerNombre(c.nombre));
  const grupos = useMemo(() => (lista ?? []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)), [lista]);

  return (
    <>
      <Cabecera titulo="Contactos" subtitulo={esJefe ? 'Escribe o llama a tu equipo' : 'Escribe o llama a tu supervisor'} atras={() => ir('/ajustes')} />
      <p className="muted" style={{ marginBottom: 8 }}>Se abre WhatsApp con el mensaje ya escrito; tú solo pulsas <b>Enviar</b>. Puedes cambiar el texto antes.</p>
      <div className="campo">
        <label htmlFor="mensaje-wa">Mensaje</label>
        <textarea id="mensaje-wa" rows={3} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
        {esJefe && <p className="muted" style={{ fontSize: 12 }}>{'{nombre}'} se reemplaza por el nombre de cada persona.</p>}
      </div>
      {!!error && <p className="aviso" role="alert">{error}</p>}
      {!lista && !error && <Cargando texto="Cargando contactos…" />}
      {lista && !lista.length && <p className="muted">{esJefe ? 'Aún no hay personas con teléfono. El administrador puede agregarlo en Administración → Usuarios.' : 'Tu supervisor aún no tiene un teléfono registrado. Pídele al administrador que lo agregue.'}</p>}
      <div className="pila">
        {grupos.map((c) => {
          const wa = enlaceWa(c.telefono, texto(c), pais), tel = enlaceLlamada(c.telefono, pais);
          return (
            <div key={c.usuario} className="tarjeta" aria-label={`${c.nombre}, ${TEXTO_ROL[c.rol]}`}>
              <div className="fila" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1 }}><b>{c.nombre}</b><div className="muted" style={{ fontSize: 13 }}>{c.telefono}</div></div>
                <Ficha texto={TEXTO_ROL[c.rol]} color={c.rol === 'admin' ? 'primario' : c.rol === 'supervisor' ? 'aviso' : undefined} />
              </div>
              <div className="fila" style={{ marginTop: 8 }}>
                {wa ? <a className="boton primario bloque" style={{ textDecoration: 'none' }} href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : <span className="muted">Teléfono no válido</span>}
                {tel && <a className="boton secundario bloque" style={{ textDecoration: 'none' }} href={tel}>Llamar</a>}
              </div>
            </div>
          );
        })}
      </div>
      {esJefe && (
        <div style={{ marginTop: 14 }}>
          <a className="boton secundario bloque" style={{ textDecoration: 'none' }} href={enlaceWaGeneral(mensaje.replace(/\{nombre\}/g, 'equipo'))} target="_blank" rel="noopener noreferrer">Escribir a un grupo (elijo el chat en WhatsApp)</a>
        </div>
      )}
    </>
  );
}
