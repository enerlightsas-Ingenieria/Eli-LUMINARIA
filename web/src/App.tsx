import { useEffect, useRef } from 'react';
import { AutoSync } from './componentes/AutoSync';
import { EstadoConexion } from './componentes/EstadoConexion';
import { Dialogos } from './componentes/dialogos';
import { Icono } from './componentes/Icono';
import { Cargando } from './componentes/ui';
import { AppProvider, useApp } from './contexto/App';
import { JornadaProvider } from './contexto/Jornada';
import { AjustesPantalla as Ajustes } from './pantallas/Ajustes';
import { Administracion } from './pantallas/Administracion';
import { Ayuda } from './pantallas/Ayuda';
import { Capturar } from './pantallas/Capturar';
import { Editar } from './pantallas/Editar';
import { Equipo } from './pantallas/Equipo';
import { Mapa } from './pantallas/Mapa';
import { Proyectos } from './pantallas/Proyectos';
import { Registros } from './pantallas/Registros';
import { pedirYAplicar } from './componentes/importarConfig';
import { rolDe, veEquipo } from '@compartido/core/ajustes';
import { ir, useRuta } from './router';
import { pedirAlmacenamientoPersistente } from './servicios/pwa';

const PANTALLAS_SIN_PESTANAS = ['capturar', 'editar', 'config', 'ayuda'];

function Pestanas({ activa, supervisor }: { activa: string; supervisor: boolean }) {
  // El supervisor (y el administrador) tienen además el Panel; todos pueden capturar como técnico.
  const base = [{ ruta: supervisor ? 'registros' : '', icono: 'lista', texto: 'Registros' }, { ruta: 'mapa', icono: 'mapa', texto: 'Mapa' }, { ruta: 'proyectos', icono: 'carpeta', texto: 'Proyectos' }, { ruta: 'ajustes', icono: 'ajustes', texto: 'Ajustes' }];
  const tabs = supervisor ? [{ ruta: '', icono: 'usuarios', texto: 'Panel' }, ...base] : base;
  if (supervisor && activa === 'admin') activa = 'ajustes';
  return (
    <div className="pestanas"><nav aria-label="Secciones">
      {tabs.map((t) => <a key={t.ruta} href={`#/${t.ruta}`} className={activa === t.ruta ? 'activa' : ''} aria-current={activa === t.ruta ? 'page' : undefined}><Icono nombre={t.icono} /><span>{t.texto}</span></a>)}
    </nav></div>
  );
}

/**
 * Enlace de configuración (https://…/#/config?c=ELI1.…): se procesa UNA vez por código, se limpia de la barra de direcciones
 * enseguida (no queda en el historial) y pide confirmación. Vive aquí y no en una pantalla para que no dependa de su ciclo de vida.
 */
function useEnlaceDeConfiguracion(listo: boolean) {
  const ruta = useRuta();
  const { configCambiada, refrescar } = useApp();
  const procesado = useRef<string | null>(null);
  useEffect(() => {
    if (!listo) return;
    if (ruta.camino[0] !== 'config') { procesado.current = null; return; }
    const codigo = ruta.consulta.get('c');
    if (!codigo) { ir('/', true); return; }
    if (procesado.current === codigo) return;
    procesado.current = codigo;
    ir('/', true);
    pedirYAplicar(`?c=${codigo}`, () => { configCambiada(); refrescar(); });
  }, [listo, ruta, configCambiada, refrescar]);
}

function Cuerpo() {
  const ruta = useRuta();
  const { listo, ajustes } = useApp();
  useEnlaceDeConfiguracion(listo);
  const [primero = '', segundo] = ruta.camino;
  useEffect(() => { pedirAlmacenamientoPersistente(); }, []);
  if (!listo) return <Cargando texto="Abriendo…" />;
  const supervisor = veEquipo(rolDe(ajustes));
  const conPestanas = !PANTALLAS_SIN_PESTANAS.includes(primero);

  let pantalla;
  switch (primero) {
    case '': pantalla = supervisor ? <Equipo /> : <Registros />; break;
    case 'registros': pantalla = <Registros />; break;
    case 'admin': pantalla = <Administracion seccion={segundo} />; break;
    case 'mapa': pantalla = <Mapa />; break;
    case 'proyectos': pantalla = <Proyectos />; break;
    case 'ajustes': pantalla = <Ajustes />; break;
    case 'capturar': pantalla = <Capturar />; break;
    case 'editar': pantalla = <Editar key={segundo} id={segundo ?? 'nuevo'} />; break;
    case 'config': pantalla = supervisor ? <Equipo /> : <Registros />; break;   // mientras se procesa el enlace
    case 'ayuda': pantalla = <Ayuda />; break;
    default: pantalla = supervisor ? <Equipo /> : <Registros />;
  }
  return (
    <div className="app">
      <EstadoConexion />
      <main className={`pantalla${conPestanas ? '' : ' sin-pestanas'}`}>{pantalla}</main>
      {conPestanas && <Pestanas activa={primero} supervisor={supervisor} />}
      <AutoSync />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <JornadaProvider>
        <Cuerpo />
        <Dialogos />
      </JornadaProvider>
    </AppProvider>
  );
}
