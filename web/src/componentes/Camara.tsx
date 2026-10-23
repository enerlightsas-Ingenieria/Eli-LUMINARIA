import { useEffect, useRef, useState } from 'react';
import { aJpegReducido, archivoAJpeg } from '../servicios/fotos';
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

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError('Este navegador no permite usar la cámara dentro de la página.'); return; }
      try {
        const f = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!vivo) { f.getTracks().forEach((t) => t.stop()); return; }
        flujo.current = f;
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
    const blob = await aJpegReducido(v, v.videoWidth, v.videoHeight);
    flujo.current?.getTracks().forEach((t) => t.stop());
    alCapturar(blob, 'camara');
  };

  const elegirArchivo = async (f?: File) => { if (f) alCapturar(await archivoAJpeg(f), 'galeria'); };

  return (
    <div className="camara" role="dialog" aria-modal="true" aria-label={`Cámara: ${titulo}`}>
      <video ref={video} playsInline muted autoPlay />
      <div className="camara-texto"><b>{titulo}</b>{ayuda && <div style={{ fontSize: 13 }}>{ayuda}</div>}</div>
      {error && (
        <div className="cubierta" style={{ background: 'rgba(0,0,0,.85)', color: '#fff' }}>
          <p>{error}</p>
          {permitirArchivo && <button type="button" className="boton primario" onClick={() => archivo.current?.click()}>Elegir una foto</button>}
          {!permitirArchivo && <p style={{ opacity: .8, fontSize: 13 }}>En el modo terceros la foto debe tomarse con la cámara.</p>}
        </div>
      )}
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
