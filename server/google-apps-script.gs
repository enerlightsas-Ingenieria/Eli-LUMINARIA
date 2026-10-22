/**
 * Receptor de ELI-LUMINARIA para Google Sheets (+ fotos en Google Drive).
 * Varios técnicos (Android e iOS) pueden usar la misma hoja a la vez. Instrucciones: docs/google-sheets.md
 *
 * Contrato (POST JSON, texto plano):
 *   { token, proyecto:{uuid,nombre}, luminarias:[...], borradas:[uuid] }   → guarda/actualiza/marca borradas
 *   { token, proyecto:{...}, accion:'listar', desde:'ISO' }                → devuelve lo recibido desde esa marca
 * El orden lo pone EL SERVIDOR (columna "Recibido"), no los relojes de los teléfonos.
 */
var TOKEN = 'CAMBIA-ESTE-TOKEN';           // el mismo que pondrás en la app (Ajustes → Token secreto)
var CARPETA_FOTOS = 'ELI-LUMINARIA Fotos';  // carpeta de Drive para las fotos (se crea sola)

var COLUMNAS = [
  ['uuid', 'UUID'], ['id', 'ID (local del teléfono)'], ['codigo', 'Código activo'], ['creadoEn', 'Fecha'],
  ['tecnico', 'Técnico'], ['latitud', 'Latitud'], ['longitud', 'Longitud'], ['precisionM', 'Precisión (m)'],
  ['direccion', 'Dirección'], ['marca', 'Marca'], ['fabricante', 'Fabricante'], ['modelo', 'Modelo'],
  ['tipoLuminaria', 'Tipo de luminaria'], ['tecnologia', 'Tecnología'], ['potenciaW', 'Potencia (W)'],
  ['tensionV', 'Tensión (V)'], ['fotocelda', 'Fotocelda'], ['pinesFotocelda', 'Pines fotocelda'],
  ['temperaturaColorK', 'Temp. color (K)'], ['flujoLuminosoLm', 'Flujo (lm)'], ['ip', 'IP'], ['montaje', 'Montaje'],
  ['alturaM', 'Altura (m)'], ['estado', 'Estado'], ['confianza', 'Confianza IA'], ['observaciones', 'Observaciones'],
  ['mapa', 'Enlace mapa'], ['foto', 'Foto'], ['eliminada', 'Eliminada'], ['recibidoEn', 'Recibido']
];
// Columnas que se dejan como número (para sumar/graficar); el resto se fuerza a texto para que Sheets no
// convierta modelos como "1-2" en fechas ni recorte ceros.
var NUMERICAS = ['id', 'latitud', 'longitud', 'precisionM', 'potenciaW', 'tensionV', 'pinesFotocelda', 'temperaturaColorK', 'flujoLuminosoLm', 'alturaM'];

function col(clave) { for (var i = 0; i < COLUMNAS.length; i++) if (COLUMNAS[i][0] === clave) return i; return -1; }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return salida({ ok: false, error: 'Token inválido' });
    var ahora = new Date().toISOString(); // se toma ANTES de leer: el cursor de los teléfonos nunca se salta escrituras
    var hoja = obtenerHoja(d.proyecto && d.proyecto.nombre);

    if (d.accion === 'listar') return salida({ ok: true, ahora: ahora, luminarias: listar(hoja, d.desde || '') });

    var datos = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, COLUMNAS.length).getValues() : [];
    var iU = col('uuid'), iE = col('eliminada');
    var fila = {}; // uuid → número de fila
    datos.forEach(function (r, i) { fila[r[iU]] = i + 2; });
    var eliminadas = {};
    datos.forEach(function (r) { if (String(r[iE]).toUpperCase().indexOf('S') === 0) eliminadas[r[iU]] = true; });

    (d.luminarias || []).forEach(function (l) {
      if (eliminadas[l.uuid]) return; // lo borrado gana: el teléfono lo recibirá como eliminado en su próxima descarga
      if (l.foto) l.foto = guardarFoto(l);
      l.mapa = (l.latitud != null && l.longitud != null) ? 'https://maps.google.com/?q=' + l.latitud + ',' + l.longitud : '';
      l.eliminada = '';
      l.recibidoEn = ahora;
      var valores = COLUMNAS.map(function (c) { return textoSeguro(l[c[0]]); });
      var n = fila[l.uuid];
      if (n) {
        var iF = col('foto');
        if (!l.foto) valores[iF] = hoja.getRange(n, iF + 1).getValue(); // conserva el enlace de foto anterior
        hoja.getRange(n, 1, 1, valores.length).setValues([valores]);
      } else {
        hoja.appendRow(valores);
        fila[l.uuid] = hoja.getLastRow();
      }
    });

    (d.borradas || []).forEach(function (u) { // borrado lógico: la fila se conserva para auditoría
      var n = fila[u];
      if (!n) return;
      hoja.getRange(n, iE + 1).setValue('SÍ');
      hoja.getRange(n, col('recibidoEn') + 1).setValue(ahora);
    });
    return salida({ ok: true, recibidas: (d.luminarias || []).length, borradas: (d.borradas || []).length });
  } catch (err) {
    return salida({ ok: false, error: 'Servidor ocupado o error: ' + String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet() { return salida({ ok: true, servicio: 'ELI-LUMINARIA' }); }

function obtenerHoja(nombreProyecto) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  // Se normaliza el nombre (espacios y mayúsculas) para que "Barrio A" y "barrio  a" sean la misma pestaña.
  var limpio = String(nombreProyecto || 'General').replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 90) || 'General';
  var hojas = libro.getSheets();
  var hoja = null;
  for (var i = 0; i < hojas.length; i++) if (hojas[i].getName().toLowerCase() === limpio.toLowerCase()) { hoja = hojas[i]; break; }
  if (!hoja) hoja = libro.insertSheet(limpio);
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(COLUMNAS.map(function (c) { return c[1]; }));
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold').setBackground('#FFC53D');
    COLUMNAS.forEach(function (c, i) {
      if (NUMERICAS.indexOf(c[0]) < 0) hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  }
  return hoja;
}

function listar(hoja, desde) {
  if (hoja.getLastRow() < 2) return [];
  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLUMNAS.length).getValues();
  var iR = col('recibidoEn');
  var salidaFilas = [];
  datos.forEach(function (r) {
    var recibido = r[iR] instanceof Date ? r[iR].toISOString() : String(r[iR]);
    if (!r[0] || recibido < desde) return; // >= : reenviar un borde es inofensivo (fusión idempotente)
    var o = {};
    COLUMNAS.forEach(function (c, i) {
      if (c[0] === 'mapa' || c[0] === 'foto') return;
      o[c[0]] = r[i] instanceof Date ? r[i].toISOString() : r[i];
    });
    salidaFilas.push(o);
  });
  return salidaFilas;
}

// Evita que un texto que empiece por = + @ - se interprete como fórmula.
function textoSeguro(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+@]/.test(v)) return "'" + v;
  return v;
}

function guardarFoto(l) {
  var it = DriveApp.getFoldersByName(CARPETA_FOTOS);
  var carpeta = it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_FOTOS);
  var blob = Utilities.newBlob(Utilities.base64Decode(l.foto), 'image/jpeg', l.uuid + '.jpg');
  var previos = carpeta.getFilesByName(l.uuid + '.jpg');
  while (previos.hasNext()) previos.next().setTrashed(true);
  return carpeta.createFile(blob).getUrl();
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
