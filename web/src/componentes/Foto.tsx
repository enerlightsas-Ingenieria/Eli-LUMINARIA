import { useEffect, useState } from 'react';
import { urlDeFoto } from '../servicios/fotos';

/** Muestra una foto guardada en el dispositivo (por id). */
export function Foto({ id, className, alt = '' }: { id?: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { let vivo = true; if (id) urlDeFoto(id).then((u) => { if (vivo) setUrl(u); }); return () => { vivo = false; }; }, [id]);
  return url ? <img className={className} src={url} alt={alt} /> : <div className={className} role="img" aria-label={alt || 'Sin foto'} />;
}
