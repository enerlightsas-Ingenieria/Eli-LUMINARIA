import { useEffect, useState } from 'react';
import { useApp } from '../contexto/App';
import { esIOS, esInstalada } from '../servicios/pwa';
import { useEnLinea } from '../servicios/red';
import { useActualizacionDisponible, useEstadoSinConexion } from '../servicios/usoSinConexion';

const CLAVE_AVISADO = 'eli.sinconexion.avisado';

/** Avisos de estado: sin conexión, preparando/lista para trabajar sin internet, versión nueva, y riesgo de pérdida de datos en iPhone. */
export function EstadoConexion() {
  const enLinea = useEnLinea();
  const { pendientes } = useApp();
  const estado = useEstadoSinConexion();
  const nueva = useActualizacionDisponible();
  const [mostrarLista, setMostrarLista] = useState(false);

  // "Lista para trabajar sin conexión": se muestra UNA vez, cuando termina de prepararse
  useEffect(() => {
    if (estado !== 'lista') return;
    try { if (localStorage.getItem(CLAVE_AVISADO)) return; localStorage.setItem(CLAVE_AVISADO, '1'); } catch { /* sin almacenamiento */ }
    setMostrarLista(true);
    const t = setTimeout(() => setMostrarLista(false), 8000);
    return () => clearTimeout(t);
  }, [estado]);

  const riesgoIOS = esIOS() && !esInstalada() && pendientes > 0;

  return (
    <div className="avisos" data-testid="avisos">
      {!enLinea && (
        <div className="banda sin-conexion" role="status" data-testid="banda-sin-conexion">
          📴 Sin conexión — puedes seguir trabajando. {pendientes ? `${pendientes} pendiente${pendientes === 1 ? '' : 's'} se enviará${pendientes === 1 ? '' : 'n'} solo${pendientes === 1 ? '' : 's'} al volver la señal.` : 'Lo que guardes se enviará solo al volver la señal.'}
        </div>
      )}
      {enLinea && estado === 'preparando' && <div className="banda" role="status">⏳ Preparando la app para trabajar sin conexión…</div>}
      {mostrarLista && <div className="banda ok" role="status" data-testid="banda-lista">✅ Lista para trabajar sin conexión</div>}
      {nueva && <div className="banda" role="status">Hay una versión nueva. <button type="button" className="enlace" onClick={() => location.reload()}>Actualizar</button></div>}
      {riesgoIOS && <div className="banda aviso" role="alert">⚠️ Tienes datos sin enviar. En iPhone, instala la app en la pantalla de inicio (Compartir → Añadir a pantalla de inicio) para que Safari no los borre.</div>}
    </div>
  );
}
