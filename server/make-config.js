#!/usr/bin/env node
/**
 * Genera el código/enlace de configuración para un técnico (mismo formato que src/lib/config.ts).
 *
 *   node server/make-config.js --org "Enerlight" --tecnico "Juan Pérez" \
 *     --endpoint https://eli-luminaria-proxy.tu-cuenta.workers.dev --token TOKEN_DE_JUAN \
 *     --sync-url https://script.google.com/macros/s/XXXX/exec --sync-token TOKEN_SHEETS \
 *     --proyecto "Barrio A" --proyecto "Barrio B" [--fotos] [--terceros --precision 20]
 *   --worker URL: atajo para la web/proxy (IA en la raíz y sincronización en /sync); --web https://app.tuempresa.com imprime el enlace web;
 *   --supervisor: cuenta de supervisor (panel del equipo; usa un token de ADMIN_TOKENS en --token)
 *   --terceros: modo terceros (capturas solo con jornada activa, solo cámara, GPS ≤ --precision metros, 5–100)
 *
 * Pega el enlace en un correo/WhatsApp o conviértelo en QR con cualquier generador. Al abrirlo en el teléfono,
 * la app muestra a qué servidores apuntará y pide confirmación.
 */
function generar(o) {
  if (o.precision !== undefined) {
    if (!o.terceros) throw new Error('--precision solo tiene efecto con --terceros.');
    const p = Number(o.precision);
    if (!Number.isFinite(p) || p < 5 || p > 100) throw new Error('--precision debe ser un número entre 5 y 100 (metros).');
  }
  const cfg = {};
  if (o.org) cfg.organizacion = o.org;
  if (o.tecnico) cfg.tecnico = o.tecnico;
  if (o.endpoint) cfg.endpoint = o.endpoint;
  if (o.token) cfg.apiKey = o.token;
  if (o.modelo) cfg.modelo = o.modelo;
  if (o.syncUrl) cfg.syncUrl = o.syncUrl;
  if (o.syncToken) cfg.syncToken = o.syncToken;
  if (o.fotos) cfg.syncFotos = true;
  if (o.terceros) cfg.modoTerceros = true;
  if (o.supervisor) cfg.supervisor = true;
  if (o.worker) { // atajo: una sola URL del proxy para IA (/) y sincronización (/sync); la web no usa el token del script
    cfg.endpoint = o.worker.replace(/\/+$/, '');
    cfg.syncUrl = cfg.endpoint + '/sync';
  }
  if (o.precision) cfg.precisionMaxM = Number(o.precision);
  if (o.proyectos && o.proyectos.length) cfg.proyectos = o.proyectos;
  // JSON sólo ASCII + base64url, idéntico al que decodifica la app
  const json = JSON.stringify(cfg).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const codigo = 'ELI1.' + Buffer.from(json, 'ascii').toString('base64url');
  return { codigo, enlace: `eliluminaria://config?c=${codigo}`, enlaceWeb: o.web ? `${o.web.replace(/\/+$/, '')}/#/config?c=${codigo}` : undefined };
}

function cli(argv) {
  const o = { proyectos: [] };
  const mapa = { '--org': 'org', '--tecnico': 'tecnico', '--endpoint': 'endpoint', '--token': 'token', '--modelo': 'modelo', '--sync-url': 'syncUrl', '--sync-token': 'syncToken' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--proyecto') o.proyectos.push(argv[++i]);
    else if (a === '--fotos') o.fotos = true;
    else if (a === '--terceros') o.terceros = true;
    else if (a === '--supervisor') o.supervisor = true;
    else if (a === '--worker') o.worker = argv[++i];
    else if (a === '--web') o.web = argv[++i];
    else if (a === '--precision') o.precision = argv[++i];
    else if (mapa[a]) o[mapa[a]] = argv[++i];
    else { console.error('Opción desconocida: ' + a); process.exit(1); }
  }
  let r;
  try { r = generar(o); } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
  if (o.precision !== undefined && Number(o.precision) > 25) {
    console.error('Aviso: el servidor (LIMITE_PRECISION_M en google-apps-script.gs, 25 m por defecto) marcará GPS_IMPRECISO sobre 25 m; ajústalo a ' + o.precision + ' para no ver falsas alertas.');
  }
  console.log('Código:\n' + r.codigo + '\n\nEnlace para la app móvil:\n' + r.enlace + (r.enlaceWeb ? '\n\nEnlace para la WEB (se abre con un toque, también desde WhatsApp):\n' + r.enlaceWeb : ''));
}

module.exports = { generar };
if (require.main === module) cli(process.argv.slice(2));
