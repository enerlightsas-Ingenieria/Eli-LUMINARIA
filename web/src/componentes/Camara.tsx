import { PointerEvent as EventoPuntero, WheelEvent, useCallback, useEffect, useRef, useState } from 'react';
import { aJpegReducido, archivoAJpeg, recorteParaZoom } from '../servicios/fotos';
import { Icono } from './Icono';

/**
 * Cámara dentro de la página (getUserMedia): la foto se toma en el momento y no puede venir de la galería.
 * Sin cámara disponible: en modo normal se ofrece el selector del sistema; en modo terceros se exige cámara.
 */
export function Camara({ titulo, ayuda, permitirArchivo, alCapturar, alCerrar }: {
  titulo: string; ayuda?: string; permitirArchivo: boolean; alCapturar: (foto: Blob, origen: 'camara' | 'galeria') => void; alCerrar: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [lista, setLista] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  // Zoom: con el zoom real de la cámara cuando el teléfono lo ofrece (Android) y, si no (iPhone), digital: se acerca la imagen y la foto sale recortada igual.
  const [zoom, setZoom] = useState(1);
  const zoomActual = useRef(1);
  const rango = useRef({ min: 1, max: 5, real: false });
  const [maxZoom, setMaxZoom] = useState(5);
  const [zoomReal, setZoomReal] = useState(false);
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const pinza = useRef<{ d: number; z: number } | null>(null);

  const aplicarZoom = useCallback((valor: number) => {
    const r = rango.current;
    const z = Math.round(Math.min(r.max, Math.max(r.min, valor)) * 100) / 100;
    zoomActual.current = z; setZoom(z);
    const pista = flujo.current?.getVideoTracks()[0];
    if (r.real && pista) pista.applyConstraints({ advanced: [{ zoom: z } as any] }).catch(() => {});
  }, []);

  // En iPhone, pellizcar la pantalla hace zoom a TODA la página: se bloquea ese gesto mientras la cámara está abierta.
  useEffect(() => {
    const frenar = (e: Event) => e.preventDefault();
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, frenar, { passive: false });
    return () => { for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.removeEventListener(ev, frenar); };
  }, []);

  const distancia = () => { const [a, b] = [...punteros.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const alBajar = (e: EventoPuntero) => {
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 2) pinza.current = { d: distancia(), z: zoomActual.current };
  };
  const alMover = (e: EventoPuntero) => {
    if (!punteros.current.has(e.pointerId)) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.current.size === 2 && pinza.current) aplicarZoom(pinza.current.z * (distancia() / pinza.current.d));
  };
  const alSoltar = (e: EventoPuntero) => { punteros.current.delete(e.pointerId); if (punteros.current.size < 2) pinza.current = null; };
  const alRodar = (e: WheelEvent) => aplicarZoom(zoomActual.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError('Este navegador no permite usar la cámara dentro de la página.'); return; }
      try {
        const f = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!vivo) { f.getTracks().forEach((t) => t.stop()); return; }
        flujo.current = f;
        const cap = (f.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as any;
        if (cap.zoom && typeof cap.zoom.max === 'number' && cap.zoom.max > (cap.zoom.min ?? 1)) {
          rango.current = { min: cap.zoom.min ?? 1, max: Math.min(cap.zoom.max, 10), real: true };
          setMaxZoom(rango.current.max); setZoomReal(true);
        }
        if (video.current) { video.current.srcObject = f; await video.current.play().catch(() => {}); }
        setLista(true);
      } catch (e: any) {
        setError(e?.name === 'NotAllowedError' ? 'Permite el acceso a la cámara en el navegador (candado junto a la dirección) y vuelve a intentarlo.' : 'No se pudo abrir la cámara.');
      }
    })();
    return () => { vivo = false; flujo.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const disparar = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const digital = !rango.current.real && zoomActual.current > 1;
    const r = digital ? recorteParaZoom(v.videoWidth, v.videoHeight, zoomActual.current) : undefined;
    const blob = r ? await aJpegReducido(v, r.sw, r.sh, 1280, 0.8, r) : await aJpegReducido(v, v.videoWidth, v.videoHeight);
    flujo.current?.getTracks().forEach((t) => t.stop());
    alCapturar(blob, 'camara');
  };

  const elegirArchivo = async (f?: File) => { if (f) alCapturar(await archivoAJpeg(f), 'galeria'); };

  return (
    <div className="camara" role="dialog" aria-modal="true" aria-label={`Cámara: ${titulo}`}>
      <div className="camara-visor" data-testid="visor" onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar} onPointerLeave={alSoltar} onWheel={alRodar}>
        <video ref={video} playsInline muted autoPlay style={!zoomReal && zoom > 1 ? { transform: `scale(${zoom})` } : undefined} />
        <div className="camara-texto"><b>{titulo}</b>{ayuda && <div style={{ fontSize: 13 }}>{ayuda}</div>}</div>
        {zoom > 1 && <div className="camara-zoom-etq" data-testid="zoom-valor">{zoom.toFixed(1)}×</div>}
      </div>
      {error && (
        <div className="cubierta" style={{ background: 'rgba(0,0,0,.85)', color: '#fff' }}>
          <p>{error}</p>
          {permitirArchivo && <button type="button" className="boton primario" onClick={() => archivo.current?.click()}>Elegir una foto</button>}
          {!permitirArchivo && <p style={{ opacity: .8, fontSize: 13 }}>En el modo terceros la foto debe tomarse con la cámara.</p>}
        </div>
      )}
      <div className="camara-zoom" aria-label="Zoom de la cámara">
        <button type="button" className="plano" aria-label="Alejar" onClick={() => aplicarZoom(zoomActual.current - 0.5)}>−</button>
        <input type="range" aria-label="Zoom" min={1} max={maxZoom} step={0.1} value={zoom} onChange={(e) => aplicarZoom(Number(e.target.value))} />
        <button type="button" className="plano" aria-label="Acercar" onClick={() => aplicarZoom(zoomActual.current + 0.5)}>+</button>
      </div>
      <div className="camara-barra">
        <button type="button" className="plano" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="disparador" aria-label="Tomar foto" disabled={!lista} onClick={disparar} />
        {permitirArchivo
          ? <button type="button" className="plano" onClick={() => archivo.current?.click()}><Icono nombre="carpeta" tam={20} /><br />Galería</button>
          : <span style={{ minWidth: 80 }} />}
      </div>
      <input ref={archivo} type="file" accept="image/*" hidden onChange={(e) => elegirArchivo(e.target.files?.[0])} />
    </div>
  );
}
