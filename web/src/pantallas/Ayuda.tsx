import { useEffect, useState } from 'react';
import { Boton, Cabecera, Seccion } from '../componentes/ui';
import { volver } from '../router';
import { alCambiarInstalable, esIOS, esInstalada, instalar, puedeInstalar } from '../servicios/pwa';

export function Ayuda() {
  const [, forzar] = useState(0);
  useEffect(() => alCambiarInstalable(() => forzar((n) => n + 1)), []);
  const ios = esIOS();
  return (
    <>
      <Cabecera titulo="Ayuda" atras={volver} />
      <Seccion>Instalar en el teléfono (recomendado)</Seccion>
      {esInstalada() ? <p className="muted">✅ Ya estás usando la app instalada.</p> : (
        <div className="pila">
          {puedeInstalar() && <Boton texto="Instalar app" onClick={async () => { await instalar(); forzar((n) => n + 1); }} />}
          {ios ? (
            <ol className="muted" style={{ paddingLeft: 20, margin: 0 }}>
              <li>Abre esta página en <b>Safari</b> (no en el navegador de WhatsApp u otra app).</li>
              <li>Toca el botón <b>Compartir</b> (el cuadrado con la flecha).</li>
              <li>Elige <b>Añadir a pantalla de inicio</b> y luego <b>Añadir</b>.</li>
              <li>Abre ELI-LUMINARIA desde su ícono. Así funciona a pantalla completa y tus datos no se borran por inactividad.</li>
            </ol>
          ) : (
            <ol className="muted" style={{ paddingLeft: 20, margin: 0 }}>
              <li>Abre esta página en <b>Chrome</b>.</li>
              <li>Menú ⋮ → <b>Instalar app</b> (o <b>Añadir a la pantalla de inicio</b>).</li>
              <li>Abre ELI-LUMINARIA desde su ícono.</li>
            </ol>
          )}
        </div>
      )}
      <Seccion>Permisos</Seccion>
      <p className="muted">Necesita <b>cámara</b> y <b>ubicación</b>. Si los bloqueaste, toca el candado junto a la dirección (o en iPhone: Ajustes → Safari → Cámara/Ubicación) y permítelos. La página debe abrirse con <b>https</b>.</p>
      <Seccion>Trabajar sin conexión</Seccion>
      <ol className="muted" style={{ paddingLeft: 20, margin: 0 }}>
        <li><b>Prepárala una vez con internet:</b> abre la app y espera el aviso <b>✅ Lista para trabajar sin conexión</b> (también lo ves en Ajustes → Uso sin conexión). Basta con hacerlo una vez, y de nuevo cuando salga una versión nueva.</li>
        <li><b>En campo, sin señal:</b> abre la app desde su ícono, captura, llena los datos (con las opciones rápidas) y guarda. Verás la banda <b>📴 Sin conexión</b>; lo guardado queda como <b>Pendiente</b>.</li>
        <li><b>Al volver la señal:</b> se envía solo. Si capturaste sin IA, aparecerá <b>"N luminarias sin analizar"</b> y tú decides cuándo analizarlas (cada análisis consume crédito de la API).</li>
      </ol>
      <p className="muted" style={{ marginTop: 8 }}>Necesitan internet: la IA, el fondo del mapa y la sincronización. En iPhone, instala la app en la pantalla de inicio para que Safari no borre tus datos pendientes. Si tu empresa quiere cero costo de IA, puedes apagarla en Ajustes.</p>
      <Seccion>Jornada</Seccion>
      <p className="muted">Durante la jornada activa mantén la página abierta: la pantalla se mantiene encendida y se envía tu posición cada 5 minutos. Si cambias de aplicación o bloqueas el teléfono, el envío se detiene y se reanuda al volver.</p>
      <Seccion>Diferencias con la app móvil</Seccion>
      <p className="muted">En el navegador no se puede detectar si la ubicación es simulada ni usar el GPS en segundo plano. La empresa lo compensa auditando cada captura en el servidor.</p>
    </>
  );
}
