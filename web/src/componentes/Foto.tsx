import { useEffect, useState } from 'react';
import { urlDeFoto } from '../servicios/fotos';

/** Muestra una foto guardada en el dispositivo (por id). */
/** `miniatura` (base64) se usa cuando la foto no está en este dispositivo (registros de otras personas). */
export function Foto({ id, miniatura, className, alt = '' }: { id?: string; miniatura?: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { let vivo = true; if (id) urlDeFoto(id).then((u) => { if (vivo) setUrl(u); }); return () => { vivo = false; }; }, [id]);
  if (url) return <img className={className} src={url} alt={alt} />;
  if (miniatura) return <img className={className} src={`data:image/jpeg;base64,${miniatura}`} alt={alt} />;
  return <div className={className} role="img" aria-label={alt || 'Sin foto'} />;
}
