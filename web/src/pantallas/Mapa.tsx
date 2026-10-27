import { useMemo, useState } from 'react';
import { coordenadaValida } from '@compartido/lib/geo';
import { Cabecera } from '../componentes/ui';
import { avisar } from '../componentes/dialogos';
import { colorTecnologia, Marca, MapaLeaflet } from '../componentes/MapaLeaflet';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { obtenerPosicion } from '../servicios/gps';
import { useEnLinea } from '../servicios/red';

export function Mapa() {
  const { items, proyecto } = useApp();
  const enLinea = useEnLinea();
  const [ajustar, setAjustar] = useState(1);
  const [yo, setYo] = useState<{ lat: number; lng: number; n: number } | null>(null);

  const marcas = useMemo<Marca[]>(() => items.filter((l) => coordenadaValida(l.latitud, l.longitud)).map((l) => ({
    lat: l.latitud!, lng: l.longitud!, color: colorTecnologia(l.tecnologia),
    lineas: [l.codigo || l.codigoPoste || l.fabricante || `Luminaria #${l.id}`, [l.tecnologia, l.potenciaW && `${l.potenciaW} W`].filter(Boolean).join(' · ')].filter(Boolean),
    accion: { texto: 'Abrir ficha', alClic: () => ir(`/editar/${l.id}`) },
  })), [items]);

  const centrar = async () => {
    const p = await obtenerPosicion('alta');
    if (!p) { await avisar('Ubicación', 'No se pudo obtener tu ubicación. Revisa el permiso de ubicación del navegador.'); return; }
    setYo((a) => ({ lat: p.latitud, lng: p.longitud, n: (a?.n ?? 0) + 1 }));
  };

  return (
    <>
      <Cabecera titulo="Mapa" subtitulo={`${proyecto?.nombre ?? ''} · ${marcas.length} con coordenada`} acciones={[{ icono: 'mapa', etiqueta: 'Ajustar a todas', onClick: () => setAjustar((n) => n + 1) }]} />
      {!enLinea && <p className="aviso" role="status" data-testid="mapa-sin-conexion">Sin conexión: el fondo del mapa no carga, pero tus luminarias se muestran igual como puntos.</p>}
      <MapaLeaflet marcas={marcas} ajustar={ajustar} yo={yo} alCentrarEnMi={centrar} />
    </>
  );
}
