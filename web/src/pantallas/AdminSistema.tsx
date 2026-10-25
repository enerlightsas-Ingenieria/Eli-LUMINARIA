import { useEffect, useState } from 'react';
import { rolDe } from '@compartido/core/ajustes';
import { avisar } from '../componentes/dialogos';
import { Cabecera, Cargando } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { estadoSistema, guardarFotosEnDrive } from '../servicios/identidad';

/** Ajustes del sistema que decide el administrador y valen para todas las personas. */
export function AdminSistema() {
  const { ajustes } = useApp();
  const [fotos, setFotos] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { estadoSistema().then((s) => setFotos(s.fotos)).catch((e) => setError(e.message ?? String(e))); }, []);

  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Fotos" atras={() => ir('/ajustes')} /><p className="muted">Solo los administradores pueden cambiar esto.</p></>;

  const cambiar = async (valor: boolean) => {
    const antes = fotos;
    setFotos(valor); setGuardando(true);                       // se refleja al instante y se revierte si el servidor no lo acepta
    try { setFotos((await guardarFotosEnDrive(valor)).fotos); }
    catch (e: any) { setFotos(antes); await avisar('No se pudo guardar', e.message ?? String(e)); }
    finally { setGuardando(false); }
  };

  return (
    <>
      <Cabecera titulo="Fotos" subtitulo="Qué se guarda en Drive" atras={() => ir('/admin')} />
      {!!error && <p className="aviso" role="alert">{error}</p>}
      {fotos === null && !error && <Cargando texto="Cargando…" />}
      {fotos !== null && (
        <>
          <label className="interruptor"><input type="checkbox" checked={fotos} disabled={guardando} onChange={(e) => cambiar(e.target.checked)} /> Guardar la primera foto de cada luminaria en Google Drive</label>
          <p className="muted">
            Con esto activado, al sincronizar se sube la <b>primera foto</b> de cada luminaria a la carpeta <b>ELI-LUMINARIA Fotos</b> de Drive y su enlace aparece en la columna <b>Foto</b> de la hoja. Vale para todas las personas, sin que tengan que configurar nada.
            Solo se guarda una foto por luminaria (la general); las demás se quedan en el teléfono y sirven para el análisis con IA.
            Si lo desactivas, ya no se suben fotos nuevas (las que ya están en Drive se conservan).
          </p>
        </>
      )}
    </>
  );
}
