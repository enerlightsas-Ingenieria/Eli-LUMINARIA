import { useEffect, useState } from 'react';
import { rolDe } from '@compartido/core/ajustes';
import { avisar } from '../componentes/dialogos';
import { Boton, Cabecera, Cargando } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { estadoSistema, guardarFotosEnDrive, ordenarFotosEnDrive } from '../servicios/identidad';

/** Ajustes del sistema que decide el administrador y valen para todas las personas. */
export function AdminSistema() {
  const { ajustes } = useApp();
  const [fotos, setFotos] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [ordenando, setOrdenando] = useState('');

  useEffect(() => { estadoSistema().then((s) => setFotos(s.fotos)).catch((e) => setError(e.message ?? String(e))); }, []);

  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Fotos" atras={() => ir('/ajustes')} /><p className="muted">Solo los administradores pueden cambiar esto.</p></>;

  const cambiar = async (valor: boolean) => {
    const antes = fotos;
    setFotos(valor); setGuardando(true);                       // se refleja al instante y se revierte si el servidor no lo acepta
    try { setFotos((await guardarFotosEnDrive(valor)).fotos); }
    catch (e: any) { setFotos(antes); await avisar('No se pudo guardar', e.message ?? String(e)); }
    finally { setGuardando(false); }
  };

  const ordenar = async () => {
    setOrdenando('Ordenando fotos…');
    const total = { movidas: 0, renombradas: 0 };
    try {
      for (let vuelta = 0; vuelta < 40; vuelta++) {   // cada llamada trabaja ~90 s; se repite mientras queden pendientes
        const r = await ordenarFotosEnDrive();
        total.movidas += r.movidas; total.renombradas += r.renombradas;
        if (!r.pendientes) break;
        setOrdenando(`Ordenando fotos… quedan ${r.pendientes}`);
      }
      await avisar('Fotos ordenadas', `Movidas a la carpeta de su proyecto: ${total.movidas}\nRenombradas: ${total.renombradas}`);
    } catch (e: any) { await avisar('No se pudo ordenar', e.message ?? String(e)); }
    finally { setOrdenando(''); }
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
            Con esto activado, al sincronizar se sube la <b>primera foto</b> de cada luminaria a la carpeta de su proyecto en Drive y su enlace aparece en la columna <b>Foto</b> de la hoja. Vale para todas las personas, sin que tengan que configurar nada.
            Solo se guarda una foto por luminaria (la general); las demás se quedan en el teléfono y sirven para el análisis con IA.
            Si lo desactivas, ya no se suben fotos nuevas (las que ya están en Drive se conservan).
          </p>
          <p className="muted"><b>Dónde quedan:</b> en la carpeta FOTOS de ELI-LUMINARIA, una carpeta por proyecto, con nombres como <i>Proyecto - Barrio - Código - Poste - coordenada</i>. Las fotos que se subieron antes de esto siguen en la carpeta anterior hasta que las ordenes:</p>
          <Boton texto={ordenando || 'Ordenar fotos anteriores en Drive'} variante="secundario" cargando={!!ordenando} deshabilitado={!!ordenando} onClick={ordenar} />
        </>
      )}
    </>
  );
}
