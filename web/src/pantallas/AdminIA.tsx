import { useEffect, useState } from 'react';
import { rolDe } from '@compartido/core/ajustes';
import { avisar } from '../componentes/dialogos';
import { Boton, Cabecera, Segmentado } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { elegirIA, elegirModeloGemini, estadoIA, modelosGemini, probarIA, type EstadoIA, type Proveedor, type ResultadoPrueba } from '../servicios/identidad';

/** Administración de la IA: cuál analiza primero, qué modelo de Gemini usa y una prueba de cada proveedor. Solo administradores. */
export function AdminIA() {
  const { ajustes } = useApp();
  const [ia, setIa] = useState<EstadoIA | null>(null);
  const [error, setError] = useState('');
  const [prueba, setPrueba] = useState<Record<Proveedor, ResultadoPrueba> | null>(null);
  const [probando, setProbando] = useState(false);
  const [modelos, setModelos] = useState<{ modelos: string[]; actual: string; sugerido: string; mensaje?: string } | null>(null);

  useEffect(() => { estadoIA().then(setIa).catch((e) => setError(e.message ?? String(e))); }, []);

  const cambiarIA = async (p: Proveedor) => {
    try { setIa(await elegirIA(p)); setPrueba(null); } catch (e: any) { await avisar('No se pudo cambiar la IA', e.message ?? String(e)); }
  };
  const verModelos = async () => {
    try { setModelos(await modelosGemini()); } catch (e: any) { await avisar('No se pudieron listar los modelos', e.message ?? String(e)); }
  };
  const usarModelo = async (m: string) => {
    try { setIa(await elegirModeloGemini(m)); setModelos(null); setPrueba(null); await avisar('Modelo guardado', m === 'auto' ? 'Gemini elegirá solo un modelo disponible.' : `Gemini usará ${m}. Pulsa "Probar la IA" para comprobarlo.`); }
    catch (e: any) { await avisar('No se pudo guardar el modelo', e.message ?? String(e)); }
  };
  const probar = async () => {
    setProbando(true); setPrueba(null);
    try { setPrueba(await probarIA()); } catch (e: any) { await avisar('No se pudo probar la IA', e.message ?? String(e)); }
    finally { setProbando(false); }
  };

  if (rolDe(ajustes) !== 'admin') return <><Cabecera titulo="Inteligencia artificial" atras={() => ir('/ajustes')} /><p className="muted">Solo los administradores pueden gestionar la IA.</p></>;

  return (
    <>
      <Cabecera titulo="Inteligencia artificial" subtitulo="Qué IA analiza las fotos" atras={() => ir('/admin')} />
      {!!error && <p className="aviso" role="alert">{error}</p>}
      <p className="muted" style={{ marginBottom: 8 }}>Elige cuál IA analiza primero las fotos. Si falla (sin créditos, límite de uso o caída), el sistema usa la otra automáticamente, si tiene clave.</p>
      <Segmentado valor={ia?.principal ?? 'gemini'} alCambiar={cambiarIA} opciones={[{ valor: 'gemini', texto: 'Gemini (gratis)' }, { valor: 'claude', texto: 'Claude' }]} />
      {ia && <p className="muted" style={{ margin: '8px 0' }}>Claves en el servidor: Gemini {ia.disponibles.gemini ? '✅' : '❌ falta'} · Claude {ia.disponibles.claude ? '✅' : '❌ falta'}. Modelo de Gemini: {ia.modeloGemini}.</p>}
      <Boton texto="Probar la IA" variante="secundario" cargando={probando} onClick={probar} />
      <Boton texto="Elegir el modelo de Gemini" variante="secundario" onClick={verModelos} />
      {modelos && (
        <div role="group" aria-label="Modelos de Gemini" style={{ margin: '8px 0' }}>
          {modelos.mensaje && <p className="muted">{modelos.mensaje}</p>}
          {!modelos.mensaje && !modelos.modelos.length && <p className="muted">Google no devolvió modelos para esta clave. Revisa que la clave sea válida.</p>}
          <div className="fichas">
            <button type="button" className="ficha" onClick={() => usarModelo('auto')}>Automático{modelos.sugerido ? ` (${modelos.sugerido})` : ''}</button>
            {modelos.modelos.map((m) => <button key={m} type="button" className={`ficha${m === modelos.actual ? ' activa' : ''}`} aria-pressed={m === modelos.actual} onClick={() => usarModelo(m)}>{m}</button>)}
          </div>
        </div>
      )}
      {prueba && (['gemini', 'claude'] as Proveedor[]).map((p) => (
        <p key={p} role="status" style={{ margin: '8px 0' }}><b>{p === 'gemini' ? 'Gemini' : 'Claude'}:</b> {prueba[p].ok ? '✅ funciona' : `❌ ${prueba[p].estado ? `error ${prueba[p].estado} — ` : ''}${prueba[p].mensaje}`}</p>
      ))}

    </>
  );
}
