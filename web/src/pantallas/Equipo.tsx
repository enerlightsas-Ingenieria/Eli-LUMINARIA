import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cabecera, Cargando } from '../componentes/ui';
import { Marca, MapaLeaflet } from '../componentes/MapaLeaflet';
import { datosEquipo } from '../servicios/nucleo';

const COLORES: Record<string, string> = { 'En jornada': '#16a34a', 'Sin señal': '#ea580c', Pausada: '#2563eb', Terminada: '#6b7280' };
const ORDEN: Record<string, number> = { 'En jornada': 0, 'Sin señal': 1, Pausada: 2, Terminada: 3 };

/** El proxy atribuye la presencia al nombre del TOKEN y las capturas llevan el nombre del PERFIL: se comparan sin mayúsculas ni acentos. */
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const hace = (iso: string, ahora: string) => {
  const m = Math.round((new Date(ahora).getTime() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(m)) return '—'; if (m < 1) return 'ahora'; if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)} h ${m % 60} min`;
};

/** Panel de supervisión: quién trabaja, quién está sin señal y dónde, con la calidad de lo capturado. Requiere cuenta de supervisor. */
export function Equipo() {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [verLuminarias, setVerLuminarias] = useState(false);
  const [ajustar, setAjustar] = useState(1);

  const cargar = useCallback(async () => {
    try { setD(await datosEquipo()); setError(''); } catch (e: any) { setError(e.message ?? String(e)); }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [cargar]);

  const tecnicos: any[] = useMemo(() => [...(d?.tecnicos ?? [])].sort((a, b) => (ORDEN[a.estado] - ORDEN[b.estado]) || String(a.tecnico).localeCompare(b.tecnico)), [d]);
  const calidad = useMemo(() => {
    const m = new Map<string, { total: number; conAlertas: number; codigos: Record<string, number> }>();
    for (const [k, v] of Object.entries<any>(d?.calidad ?? {})) {
      const n = norm(k);
      const prev = m.get(n) ?? { total: 0, conAlertas: 0, codigos: {} };
      for (const [c, x] of Object.entries<number>(v.codigos ?? {})) prev.codigos[c] = (prev.codigos[c] ?? 0) + x;
      m.set(n, { total: prev.total + v.total, conAlertas: prev.conAlertas + v.conAlertas, codigos: prev.codigos });
    }
    return m;
  }, [d]);
  const cuenta = (e: string) => tecnicos.filter((t) => t.estado === e).length;

  const marcas = useMemo<Marca[]>(() => {
    const m: Marca[] = tecnicos.filter((t) => t.latitud !== '' && t.latitud != null && t.longitud !== '' && t.longitud != null).map((t) => ({
      lat: Number(t.latitud), lng: Number(t.longitud), color: COLORES[t.estado] ?? '#6b7280', radio: 11, tooltip: t.tecnico || 'Sin nombre', permanente: true,
      lineas: [`${t.tecnico || 'Sin nombre'}`, `${t.estado} · ${hace(t.senal, d.ahora)}`, `${t.luminarias || 0} luminarias`],
    }));
    if (verLuminarias) for (const l of d?.luminarias ?? []) m.push({ lat: l.lat, lng: l.lng, color: '#94a3b8', radio: 3, tooltip: `${l.marca || 'Luminaria'}${l.tec ? ' · ' + l.tec : ''}` });
    return m;
  }, [tecnicos, verLuminarias, d]);

  useEffect(() => { if (d) setAjustar((n) => (n === 1 ? 2 : n)); }, [d]);

  return (
    <>
      <Cabecera titulo="Equipo" subtitulo={d ? `${cuenta('En jornada')} en jornada · ${cuenta('Sin señal')} sin señal · ${cuenta('Pausada')} en pausa` : 'Cargando…'}
        acciones={[{ icono: 'actualizar', etiqueta: 'Actualizar', onClick: cargar }, { icono: 'mapa', etiqueta: 'Ajustar a todos', onClick: () => setAjustar((n) => n + 1) }]} />
      {error && <p className="aviso" role="alert">{error}</p>}
      {!d && !error && <Cargando />}
      {d && (
        <div className="equipo-grid">
          <div className="pila" data-testid="lista-equipo" style={{ alignContent: 'start' }}>
            {!tecnicos.length && <p className="muted">Aún no hay técnicos con jornada.</p>}
            {tecnicos.map((t) => {
              const q = calidad.get(norm(t.tecnico));
              const codigos = q ? Object.entries(q.codigos).map(([k, v]) => `${k} ×${v}`).join(', ') : '';
              return (
                <div key={t.dispositivo} className="tarjeta">
                  <div><span className="punto" style={{ background: COLORES[t.estado] }} /><b>{t.tecnico || 'Sin nombre'}</b></div>
                  <div className="muted" style={{ fontSize: 13 }}>{t.estado} · {hace(t.senal, d.ahora)}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{t.luminarias || 0} luminarias · {t.proyecto || '—'} · {t.plataforma}</div>
                  {q && <div style={{ fontSize: 13, color: q.conAlertas ? 'var(--aviso)' : 'var(--muted)' }}>{q.total} capturas · {q.conAlertas} con alertas{codigos ? ` (${codigos})` : ''}</div>}
                </div>
              );
            })}
            <label className="interruptor"><input type="checkbox" checked={verLuminarias} onChange={(e) => setVerLuminarias(e.target.checked)} /> Ver luminarias en el mapa</label>
          </div>
          <MapaLeaflet marcas={marcas} ajustar={ajustar} />
        </div>
      )}
    </>
  );
}
