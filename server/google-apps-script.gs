/**
 * Receptor de ELI-LUMINARIA para Google Sheets (+ fotos en Google Drive).
 * Instrucciones en docs/google-sheets.md
 */
var TOKEN = 'CAMBIA-ESTE-TOKEN';           // el mismo que pondrás en la app (Ajustes → Token secreto)
var CARPETA_FOTOS = 'ELI-LUMINARIA Fotos';  // carpeta de Drive para las fotos (se crea sola)

var COLUMNAS = [
  ['uuid', 'UUID'], ['id', 'ID'], ['codigo', 'Código activo'], ['creadoEn', 'Fecha'], ['tecnico', 'Técnico'], ['latitud', 'Latitud'],
  ['longitud', 'Longitud'], ['precisionM', 'Precisión (m)'], ['direccion', 'Dirección'], ['marca', 'Marca'],
  ['fabricante', 'Fabricante'], ['modelo', 'Modelo'], ['tipoLuminaria', 'Tipo de luminaria'],
  ['tecnologia', 'Tecnología'], ['potenciaW', 'Potencia (W)'], ['tensionV', 'Tensión (V)'],
  ['fotocelda', 'Fotocelda'], ['pinesFotocelda', 'Pines fotocelda'], ['temperaturaColorK', 'Temp. color (K)'],
  ['flujoLuminosoLm', 'Flujo (lm)'], ['ip', 'IP'], ['montaje', 'Montaje'], ['alturaM', 'Altura (m)'],
  ['estado', 'Estado'], ['confianza', 'Confianza IA'], ['observaciones', 'Observaciones'],
  ['mapa', 'Enlace mapa'], ['foto', 'Foto']
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return salida({ ok: false, error: 'Token inválido' });

    var libro = SpreadsheetApp.getActiveSpreadsheet();
    var nombre = String(d.proyecto.nombre || 'General').replace(/[\\\/\?\*\[\]:]/g, ' ').substring(0, 90);
    var hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
    if (hoja.getLastRow() === 0) {
      hoja.appendRow(COLUMNAS.map(function (c) { return c[1]; }));
      hoja.setFrozenRows(1);
      hoja.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold').setBackground('#FFC53D');
    }

    var uuids = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
    d.luminarias.forEach(function (l) {
      if (l.foto) l.foto = guardarFoto(l);
      l.mapa = (l.latitud != null && l.longitud != null) ? 'https://maps.google.com/?q=' + l.latitud + ',' + l.longitud : '';
      var fila = COLUMNAS.map(function (c) { return textoSeguro(l[c[0]]); });
      var i = uuids.indexOf(l.uuid);
      if (i >= 0) {
        var colFoto = COLUMNAS.length - 1;
        if (!l.foto) fila[colFoto] = hoja.getRange(i + 2, colFoto + 1).getValue(); // conserva el enlace anterior
        hoja.getRange(i + 2, 1, 1, fila.length).setValues([fila]);
      }
      else { hoja.appendRow(fila); uuids.push(l.uuid); }
    });
    return salida({ ok: true, recibidas: d.luminarias.length });
  } catch (err) {
    return salida({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return salida({ ok: true, servicio: 'ELI-LUMINARIA' }); }

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
