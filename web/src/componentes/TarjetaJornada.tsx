import { useState } from 'react';
import { useApp } from '../contexto/App';
import { useJornada } from '../contexto/Jornada';
import { jornada } from '../servicios/nucleo';
import { Boton } from './ui';
import { avisar, confirmar, dialogo } from './dialogos';

const AVISO =
  'Mientras la jornada esté ACTIVA y esta página esté abierta, tu empresa recibirá tu ubicación aproximada, la hora y cuántas luminarias llevas, cada 5 minutos.\n\n' +
  '• Al pausar o terminar, se deja de enviar tu ubicación.\n' +
  '• Fuera de la jornada tu ubicación no se comparte.\n' +
  '• La pantalla se mantiene encendida mientras la jornada está activa (si tu navegador lo permite).\n' +
  '• Verás siempre que la jornada está activa.\n\n¿Aceptas?';

const hora = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Inicia la jornada pidiendo antes (una sola vez) el consentimiento. Lo usan la tarjeta y la pantalla de captura. */
export function useEmpezarJornada() {
  const { iniciar } = useJornada();
  const { ajustes } = useApp();
  const [ocupado, setOcupado] = useState(false);
  const empezar = async () => {
    if (!ajustes.syncUrl) { await avisar('Jornada', 'Tu empresa aún no ha configurado el servidor de sincronización. Abre tu enlace de configuración o impórtalo en Ajustes.'); return; }
    if (!(await jornada.haAceptado())) {
      if ((await dialogo({ titulo: 'Aviso de ubicación', mensaje: AVISO, botones: [{ texto: 'Cancelar', estilo: 'cancelar' }, { texto: 'Acepto' }] })) !== 1) return;
      await jornada.registrarConsentimiento();
    }
    setOcupado(true);
    try { await iniciar(); } finally { setOcupado(false); }
  };
  return { empezar, ocupado };
}

export function TarjetaJornada() {
  const { ajustes } = useApp();
  const { estado, ultimoEnvio, pausar, reanudar, terminar } = useJornada();
  const { empezar, ocupado: iniciando } = useEmpezarJornada();
  const [ocupadoAccion, setOcupado] = useState(false);
  if (!estado) return null;
  const ocupado = iniciando || ocupadoAccion;
  const correr = async (f: () => Promise<void>) => { setOcupado(true); try { await f(); } finally { setOcupado(false); } };

  const enJornada = estado.fase === 'activa' || estado.fase === 'pausada';
  const activa = estado.fase === 'activa';
  const minutos = ultimoEnvio ? Math.max(0, Math.round((Date.now() - ultimoEnvio.getTime()) / 60000)) : null;

  return (
    <div className={`tarjeta jornada${activa ? ' activa' : ''}`} data-testid="tarjeta-jornada">
      {!enJornada ? (
        <Boton texto="Iniciar jornada" variante="secundario" icono="play" cargando={ocupado} onClick={empezar} />
      ) : (
        <>
          <div><span className={`punto${activa ? ' ok' : ''}`} /><b>{activa ? 'Jornada activa' : 'Jornada en pausa'} · desde {hora(estado.inicio)}</b></div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {activa ? `Mantén esta página abierta. ${minutos != null ? `Última señal enviada hace ${minutos} min.` : 'Enviando primera señal…'}` : 'En pausa: no se envía tu ubicación.'}
          </p>
          <div className="fila" style={{ marginTop: 10 }}>
            <Boton texto={activa ? 'Pausar' : 'Reanudar'} variante="secundario" cargando={ocupado} onClick={() => correr(activa ? pausar : reanudar)} />
            <Boton texto="Terminar" variante="peligro" onClick={async () => { if (await confirmar('Terminar jornada', '¿Terminar la jornada? Se dejará de enviar tu ubicación.', 'Terminar', true)) correr(terminar); }} />
          </div>
        </>
      )}
      {ajustes.modoTerceros && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Modo terceros: solo puedes capturar luminarias con la jornada activa.</p>}
      {estado.fase === 'terminada' && estado.sinEnviar && <p className="aviso" style={{ fontSize: 12, marginTop: 8 }}>El cierre de la jornada se enviará cuando haya conexión.</p>}
    </div>
  );
}
