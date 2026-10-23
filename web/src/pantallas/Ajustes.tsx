import { useEffect, useState } from 'react';
import { resumenSync } from '@compartido/core/sync';
import { ENDPOINT_POR_DEFECTO, MODELO_POR_DEFECTO } from '@compartido/core/ajustes';
import { rolDe } from '@compartido/core/ajustes';
import type { Ajustes as TipoAjustes } from '@compartido/core/ajustes';
import { avisar } from '../componentes/dialogos';
import { pedirYAplicar } from '../componentes/importarConfig';
import { Boton, Cabecera, Campo, Segmentado, Seccion } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { cargarAjustes, guardarAjustes } from '../servicios/ajustes';
import { sincronizacion } from '../servicios/nucleo';
import { pedirAlmacenamientoPersistente } from '../servicios/pwa';
import { useEstadoSinConexion } from '../servicios/usoSinConexion';

declare const __VERSION__: string;

export function AjustesPantalla() {
  const { proyecto, refrescar, recargarAjustes, versionConfig, configCambiada } = useApp();
  const [a, setA] = useState<TipoAjustes | null>(null);
  const [codigo, setCodigo] = useState('');
  const [sync, setSync] = useState(false);
  const [persistente, setPersistente] = useState<boolean | null>(null);
  const estadoOffline = useEstadoSinConexion();

  // Se recarga al abrir y cada vez que se importa una configuración: si no, "Guardar" pisaría con valores viejos lo recién importado.
  useEffect(() => { cargarAjustes().then(setA); }, [versionConfig]);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersistente).catch(() => {}); }, []);
  if (!a) return null;

  const cambiar = (p: Partial<TipoAjustes>) => setA((x) => ({ ...x!, ...p }));
  const guardar = async () => { await guardarAjustes(a); await recargarAjustes(); await avisar('Listo', 'Ajustes guardados.'); };

  const sincronizarYa = async () => {
    if (!proyecto) return;
    await guardarAjustes(a); await recargarAjustes();
    setSync(true);
    try { const r = await sincronizacion.sincronizar(proyecto); await refrescar(); await avisar('Sincronizado', resumenSync(r)); }
    catch (e: any) { await avisar('No se pudo sincronizar', e.message ?? String(e)); }
    finally { setSync(false); }
  };

  return (
    <>
      <Cabecera titulo="Ajustes" />
      <Seccion>Técnico y configuración</Seccion>
      <p className="muted" style={{ marginBottom: 12 }}>Tu nombre se registra en cada luminaria. Si tu empresa te dio un enlace o código de configuración, ábrelo o pégalo aquí: deja la app lista sin escribir claves.</p>
      {a.rol && <p data-testid="cuenta" style={{ marginBottom: 8 }}>Cuenta: <b>{a.tecnico}</b> · {{ tecnico: 'Técnico', supervisor: 'Supervisor', admin: 'Administrador' }[rolDe(a)]}</p>}
      <Campo etiqueta="Nombre del técnico" valor={a.tecnico} alCambiar={(t) => cambiar({ tecnico: t })} pista="Ej. Juan Pérez" soloLectura={!!a.rol} />
      {rolDe(a) === 'admin' && <Boton texto="Administración de usuarios" icono="usuarios" onClick={() => ir('/admin')} />}
      <Campo etiqueta="Código de configuración" valor={codigo} alCambiar={setCodigo} pista="ELI1.…  o el enlace completo" tipo="url" />
      <Boton texto="Importar configuración" variante="secundario" deshabilitado={!codigo.trim()} onClick={() => pedirYAplicar(codigo, () => { setCodigo(''); configCambiada(); refrescar(); })} />

      <Seccion>Apariencia</Seccion>
      <Segmentado valor={a.tema} alCambiar={(tema) => { cambiar({ tema }); document.documentElement.dataset.tema = tema; }} opciones={[{ valor: 'auto', texto: 'Automático' }, { valor: 'claro', texto: 'Claro' }, { valor: 'oscuro', texto: 'Oscuro' }]} />

      <Seccion>Uso sin conexión</Seccion>
      <p data-testid="estado-offline" style={{ marginBottom: 8 }}>{estadoOffline === 'lista' ? '✅ Lista: puedes abrir la app y capturar sin internet.' : estadoOffline === 'preparando' ? '⏳ Preparando… mantén la página abierta con internet unos segundos.' : '⚠️ No disponible en este navegador (abre la página con https).'}</p>
      <p className="muted">Sin señal puedes capturar, llenar datos y guardar: todo queda en este dispositivo y se envía solo al volver la conexión. La IA, el mapa de fondo y la sincronización sí necesitan internet.</p>

      <Seccion>Análisis con IA</Seccion>
      <label className="interruptor"><input type="checkbox" checked={a.iaActiva !== false} onChange={(e) => cambiar({ iaActiva: e.target.checked })} /> Usar análisis con IA (cada análisis consume crédito de la API)</label>
      <p className="muted" style={{ marginBottom: 12 }}>Apágalo para trabajar 100 % manual, sin ningún costo de IA. Usa la IA (Gemini o Claude, la que elija el administrador) a través del servidor de tu empresa, que guarda la clave. Aquí va el <b>token personal</b> que te dieron, no la clave de Anthropic.</p>
      <Campo etiqueta="Servidor (URL del proxy)" tipo="url" valor={a.endpoint} alCambiar={(t) => cambiar({ endpoint: t })} />
      <Campo etiqueta="Token personal" secreto valor={a.apiKey} alCambiar={(t) => cambiar({ apiKey: t })} />
      <Campo etiqueta="Modelo" valor={a.modelo} alCambiar={(t) => cambiar({ modelo: t })} />
      <Boton texto="Restablecer servidor y modelo" variante="secundario" onClick={() => cambiar({ endpoint: ENDPOINT_POR_DEFECTO, modelo: MODELO_POR_DEFECTO })} />

      <Seccion>Sincronización</Seccion>
      <p className="muted" style={{ marginBottom: 12 }}>Cada proyecto crea su pestaña en la hoja de tu empresa y cada luminaria se actualiza sin duplicarse. Con el proxy, la dirección termina en <code>/sync</code>.</p>
      <Campo etiqueta="URL de sincronización" tipo="url" valor={a.syncUrl} alCambiar={(t) => cambiar({ syncUrl: t })} pista="https://tu-proxy.workers.dev/sync" />
      <label className="interruptor"><input type="checkbox" checked={a.syncFotos} onChange={(e) => cambiar({ syncFotos: e.target.checked })} /> Incluir la primera foto (se guarda en Drive)</label>
      <label className="interruptor"><input type="checkbox" checked={a.autoSync} onChange={(e) => cambiar({ autoSync: e.target.checked })} /> Sincronizar automáticamente cuando haya conexión</label>
      <Boton texto={`Sincronizar "${proyecto?.nombre ?? ''}" ahora`} variante="secundario" cargando={sync} deshabilitado={!a.syncUrl} onClick={sincronizarYa} />

      {a.modoTerceros && <p className="muted" style={{ marginTop: 12 }}>🔒 Modo terceros activo (configurado por tu empresa): capturas solo con jornada activa, con la cámara y con GPS de ±{a.precisionMaxM} m.</p>}
      <div style={{ marginTop: 22 }}><Boton texto="Guardar ajustes" onClick={guardar} /></div>

      <Seccion>Datos en este dispositivo</Seccion>
      <p className="muted">
        {persistente === true ? 'El navegador protegerá tus datos locales contra borrados automáticos.' : persistente === false ? 'El navegador podría borrar los datos locales si falta espacio o pasan días sin usar la página. Instala la app en tu pantalla de inicio y mantén la sincronización al día.' : ''}
      </p>
      {persistente === false && <div style={{ marginTop: 8 }}><Boton texto="Proteger datos locales" variante="secundario" onClick={async () => setPersistente(await pedirAlmacenamientoPersistente())} /></div>}

      <Seccion>Acerca de</Seccion>
      <p className="muted">ELI-LUMINARIA web {typeof __VERSION__ === 'string' ? __VERSION__ : ''}<br />Inventario de luminarias con IA y GPS. Los datos viven en este dispositivo; solo salen las fotos que envías a analizar y lo que sincronizas.<br />Tu ubicación solo se comparte con tu empresa mientras tienes una jornada ACTIVA.</p>
      <div style={{ marginTop: 10 }}><Boton texto="Cómo instalar la app y resolver problemas" variante="secundario" icono="info" onClick={() => ir('/ayuda')} /></div>
    </>
  );
}
