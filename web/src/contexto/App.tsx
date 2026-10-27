import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Ajustes } from '@compartido/core/ajustes';
import type { Luminaria } from '@compartido/types';
import { ajustesPorDefecto, cargarAjustes } from '../servicios/ajustes';
import { confirmar } from '../componentes/dialogos';
import { cerrarSesion, verificarIdentidad } from '../servicios/identidad';
import { jornada } from '../servicios/nucleo';
import { claveDeSesion, INACTIVIDAD_MINUTOS } from '../servicios/sesion';
import { ir } from '../router';
import { guardarKv, leerKv, listarLuminarias, listarProyectos, ProyectoConCuenta } from '../servicios/almacen';

export interface ContextoApp {
  listo: boolean;
  proyectos: ProyectoConCuenta[];
  proyecto: ProyectoConCuenta | null;
  items: Luminaria[];
  pendientes: number;
  ajustes: Ajustes;
  refrescar: () => Promise<void>;
  activar: (id: number) => Promise<void>;
  recargarAjustes: () => Promise<void>;
  /** Sube cada vez que se importa una configuración: las pantallas que muestran ajustes deben recargarlos. */
  versionConfig: number;
  configCambiada: () => void;
  /** Pantalla bloqueada por inactividad: la clave sigue en memoria (el envío en segundo plano continúa) pero hay que volver a escribirla. */
  bloqueada: boolean;
  desbloquear: (clave: string) => boolean;
  /** Cierra la sesión (pide confirmación). */
  salir: () => Promise<void>;
}

const Ctx = createContext<ContextoApp>(null as any);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [listo, setListo] = useState(false);
  const [proyectos, setProyectos] = useState<ProyectoConCuenta[]>([]);
  const [activoId, setActivoId] = useState<number | null>(null);
  const [items, setItems] = useState<Luminaria[]>([]);
  const [ajustes, setAjustes] = useState<Ajustes>(ajustesPorDefecto());
  const [versionConfig, setVersionConfig] = useState(0);
  const [bloqueada, setBloqueada] = useState(false);
  const ultimaActividad = useRef(Date.now());

  const cargar = useCallback(async (preferido?: number | null) => {
    const ps = await listarProyectos();
    const guardado = preferido ?? Number(await leerKv('proyectoActivo'));
    const activo = ps.find((p) => p.id === guardado) ?? ps[0] ?? null;
    setProyectos(ps);
    setActivoId(activo?.id ?? null);
    setItems(activo ? await listarLuminarias(activo.id) : []);
    setAjustes(await cargarAjustes());
    setListo(true);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { document.documentElement.dataset.tema = ajustes.tema; }, [ajustes.tema]);

  // El servidor es quien dice el rol y el nombre de la cuenta: se consulta al abrir y al importar una configuración (si hay conexión).
  useEffect(() => {
    if (!listo) return;
    let vivo = true;
    verificarIdentidad().then((cambio) => { if (cambio && vivo) { cargarAjustes().then(setAjustes); cargar(); } });
    return () => { vivo = false; };
  }, [listo, versionConfig, cargar]);

  // Al volver el internet se vuelve a preguntar quién es esta cuenta (así se notan bajas y cambios de rol hechos mientras no había señal).
  useEffect(() => {
    if (!listo || !ajustes.apiKey) return;
    const alVolver = () => { verificarIdentidad().then((cambio) => { if (cambio) { cargarAjustes().then(setAjustes); cargar(); } }); };
    window.addEventListener('online', alVolver);
    return () => window.removeEventListener('online', alVolver);
  }, [listo, ajustes.apiKey, cargar]);

  // Bloqueo por inactividad: tras INACTIVIDAD_MINUTOS sin tocar la app (o al volver a ella pasado ese tiempo) se pide la clave otra vez.
  const hayCuenta = !!ajustes.apiKey;
  useEffect(() => {
    if (!hayCuenta) { setBloqueada(false); return; }
    ultimaActividad.current = Date.now();
    const limite = INACTIVIDAD_MINUTOS * 60_000;
    const marcar = () => { ultimaActividad.current = Date.now(); };
    const revisar = () => { if (Date.now() - ultimaActividad.current >= limite) setBloqueada(true); };
    const eventos = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true, capture: true }));
    const reloj = setInterval(revisar, 10_000);
    const alVolver = () => { if (document.visibilityState === 'visible') revisar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { eventos.forEach((e) => window.removeEventListener(e, marcar, { capture: true })); clearInterval(reloj); document.removeEventListener('visibilitychange', alVolver); };
  }, [hayCuenta]);

  const desbloquear = useCallback((clave: string) => {
    if (!clave.trim() || clave.trim() !== claveDeSesion()) return false;
    ultimaActividad.current = Date.now(); setBloqueada(false);
    return true;
  }, []);

  const salir = useCallback(async () => {
    const activa = (await jornada.cargarJornada().catch(() => null))?.fase === 'activa';
    const aviso = activa ? '\n\nTienes una jornada ACTIVA: al salir se deja de reportar tu ubicación.' : '';
    if (!(await confirmar('Salir', `Saldrás de tu cuenta. Los registros guardados en este dispositivo se conservan y se enviarán cuando vuelvas a entrar.${aviso}`, 'Salir', !!activa))) return;
    await cerrarSesion(); setBloqueada(false);
    setVersionConfig((v) => v + 1); setAjustes(await cargarAjustes());
    ir('/', true);
  }, []);

  const refrescar = useCallback(() => cargar(activoId), [cargar, activoId]);
  const activar = useCallback(async (id: number) => { await guardarKv('proyectoActivo', String(id)); await cargar(id); }, [cargar]);
  const recargarAjustes = useCallback(async () => setAjustes(await cargarAjustes()), []);
  const configCambiada = useCallback(() => { setVersionConfig((v) => v + 1); cargarAjustes().then(setAjustes); }, []);

  const valor = useMemo<ContextoApp>(() => ({
    listo, proyectos, proyecto: proyectos.find((p) => p.id === activoId) ?? null, items, ajustes,
    pendientes: items.filter((l) => !l.sincronizado).length,
    refrescar, activar, recargarAjustes, versionConfig, configCambiada, bloqueada, desbloquear, salir,
  }), [listo, proyectos, activoId, items, ajustes, refrescar, activar, recargarAjustes, versionConfig, configCambiada, bloqueada, desbloquear, salir]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
