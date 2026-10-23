import { rolDe } from '@compartido/core/ajustes';
import { Cabecera } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { AdminIA } from './AdminIA';
import { AdminUsuarios } from './AdminUsuarios';

/** Menú de administración (solo administradores): Usuarios e Inteligencia artificial, cada uno en su pantalla. */
export function Administracion({ seccion }: { seccion?: string }) {
  const { ajustes } = useApp();
  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Administración" atras={() => ir('/ajustes')} /><p className="muted">Solo los administradores pueden entrar aquí.</p></>;
  if (seccion === 'usuarios') return <AdminUsuarios />;
  if (seccion === 'ia') return <AdminIA />;
  return (
    <>
      <Cabecera titulo="Administración" subtitulo="Usuarios e inteligencia artificial" atras={() => ir('/ajustes')} />
      <div className="pila">
        <button type="button" className="tarjeta item" onClick={() => ir('/admin/usuarios')} aria-label="Administrar usuarios">
          <div style={{ flex: 1 }}><div className="t">Usuarios</div><div className="s">Crear técnicos, supervisores y administradores; dar de baja; entregar su enlace de acceso.</div></div>
        </button>
        <button type="button" className="tarjeta item" onClick={() => ir('/admin/ia')} aria-label="Administrar la inteligencia artificial">
          <div style={{ flex: 1 }}><div className="t">Inteligencia artificial</div><div className="s">Elegir Gemini o Claude, el modelo de Gemini y probar que funcionan.</div></div>
        </button>
      </div>
    </>
  );
}
