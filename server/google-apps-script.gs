/**
 * Receptor de ELI-LUMINARIA para Google Sheets (+ fotos en Google Drive).
 * Varios técnicos (Android e iOS) pueden usar la misma hoja a la vez. Instrucciones: docs/google-sheets.md
 *
 * Requiere el runtime V8 (por defecto en proyectos nuevos).
 *
 * Contrato (POST JSON, texto plano):
 *   { token, proyecto:{uuid,nombre}, luminarias:[...], borradas:[uuid] }   → guarda/actualiza/marca borradas
 *   { token, proyecto:{...}, accion:'listar', desde:'ISO' }                → devuelve lo recibido desde esa marca
 *   { token, accion:'latido', dispositivo, tecnico, estado, ... }           → monitoreo de jornada (pestañas _Equipo y _Jornadas)
 *   { token: TOKEN_ADMIN, accion:'equipo' }                                 → datos del panel/mapa de supervisión (lo usa la web)
 *   { token, accion:'usuario', clave }                                      → quién es esa clave según la pestaña _Usuarios (lo usa el proxy)
 * Mapa en vivo para el administrador: <URL de la Web App>?vista=equipo&token=<TOKEN_ADMIN>
 * El orden lo pone EL SERVIDOR (columna "Recibido"), no los relojes de los teléfonos.
 */
var TOKEN = 'CAMBIA-ESTE-TOKEN';           // el mismo que pondrás en la app (Ajustes → Token secreto)
var CARPETA_FOTOS = 'ELI-LUMINARIA Fotos';  // carpeta de Drive para las fotos (se crea sola)
var TOKEN_ADMIN = 'CAMBIA-ESTE-TOKEN-ADMIN'; // SOLO para ti: abre el mapa en vivo del equipo (distinto del token del equipo)
var MINUTOS_SIN_SENAL = 15;                  // una jornada activa sin latidos por más de esto se muestra "Sin señal"
// Auditoría de capturas (modo terceros): umbrales de las alertas de la columna "Alertas"
// OJO: LIMITE_PRECISION_M es la política del SERVIDOR para todos. Si configuras la app con --precision mayor (p. ej. 40),
// sube también este valor o verás alertas GPS_IMPRECISO en capturas que la app sí aceptó.
var LIMITE_PRECISION_M = 25;      // GPS_IMPRECISO si la precisión del GPS es peor que esto
var VELOCIDAD_MAX_KMH = 120;      // SALTO_IMPOSIBLE: dos capturas del mismo técnico a mayor velocidad que esta
var AGRUPADAS_RADIO_M = 3;        // AGRUPADAS: 4 o más capturas del mismo técnico en este radio...
var AGRUPADAS_MIN = 4;
var AGRUPADAS_VENTANA_MIN = 10;   // ...dentro de esta ventana de tiempo
var TOLERANCIA_JORNADA_MIN = 2;   // margen al comprobar que la captura cae dentro de su jornada
var AUDITORIA_EN_LINEA_MAX_FILAS = 3000; // en pestañas más grandes la auditoría la hace solo el activador por tiempo (auditarTodo), no cada envío
var HOJA_EQUIPO = '_Equipo', HOJA_JORNADAS = '_Jornadas', HOJA_USUARIOS = '_Usuarios'; // pestañas del sistema (los proyectos no pueden empezar por "_")

var COLUMNAS = [
  ['uuid', 'UUID'], ['id', 'ID (local del teléfono)'], ['codigo', 'Código activo'], ['creadoEn', 'Fecha'],
  ['tecnico', 'Técnico'], ['latitud', 'Latitud'], ['longitud', 'Longitud'], ['precisionM', 'Precisión (m)'],
  ['direccion', 'Dirección'], ['marca', 'Marca'], ['fabricante', 'Fabricante'], ['modelo', 'Modelo'],
  ['tipoLuminaria', 'Tipo de luminaria'], ['tecnologia', 'Tecnología'], ['potenciaW', 'Potencia (W)'],
  ['tensionV', 'Tensión (V)'], ['fotocelda', 'Fotocelda'], ['pinesFotocelda', 'Pines fotocelda'],
  ['temperaturaColorK', 'Temp. color (K)'], ['flujoLuminosoLm', 'Flujo (lm)'], ['ip', 'IP'], ['montaje', 'Montaje'],
  ['alturaM', 'Altura (m)'], ['estado', 'Estado'], ['confianza', 'Confianza IA'], ['observaciones', 'Observaciones'],
  ['mapa', 'Enlace mapa'], ['foto', 'Foto'], ['eliminada', 'Eliminada'], ['recibidoEn', 'Recibido'],
  // Las columnas nuevas se AÑADEN SIEMPRE AL FINAL: todo el script lee por posición y así las pestañas ya creadas siguen siendo válidas.
  ['origen', 'Origen de la foto'], ['ubicacionSimulada', 'Ubicación simulada'], ['jornadaId', 'ID jornada'], ['alertas', 'Alertas']
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
    // 'equipo' (panel de supervisión de la web) exige TOKEN_ADMIN; todo lo demás, el token del equipo
    var esAdmin = d.accion === 'equipo' && d.token === TOKEN_ADMIN;
    if (!esAdmin && d.token !== TOKEN) return salida({ ok: false, error: 'Token inválido' });
    var ahora = new Date().toISOString(); // se toma ANTES de leer: el cursor de los teléfonos nunca se salta escrituras
    if (d.accion === 'equipo') { var datos = datosEquipo(TOKEN_ADMIN); datos.ok = true; return salida(datos); }
    if (d.accion === 'latido') return salida(registrarLatido(d, ahora));
    if (d.accion === 'usuario') return salida({ ok: true, usuario: buscarUsuario(d.clave) });
    var hoja = obtenerHoja(d.proyecto && d.proyecto.nombre);

    if (d.accion === 'listar') return salida({ ok: true, ahora: ahora, luminarias: listar(hoja, d.desde || '') });

    var datos = leerFilas(hoja);
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
      l.ubicacionSimulada = l.ubicacionSimulada ? 'SÍ' : '';
      l.alertas = ''; // la auditoría las recalcula al final de este envío
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
    if ((d.luminarias || []).length || (d.borradas || []).length) auditarHoja(hoja, true);
    return salida({ ok: true, recibidas: (d.luminarias || []).length, borradas: (d.borradas || []).length });
  } catch (err) {
    return salida({ ok: false, error: 'Servidor ocupado o error: ' + String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.vista === 'equipo') {
    if (p.token !== TOKEN_ADMIN) return HtmlService.createHtmlOutput('Acceso denegado').setTitle('ELI-LUMINARIA');
    return HtmlService.createHtmlOutput(PAGINA_EQUIPO.replace('__TOKEN__', function () { return JSON.stringify(p.token).replace(/</g, '\\u003c'); }))
      .setTitle('ELI-LUMINARIA · Equipo').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return salida({ ok: true, servicio: 'ELI-LUMINARIA' });
}

function obtenerHoja(nombreProyecto) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  // Se normaliza el nombre (espacios y mayúsculas) para que "Barrio A" y "barrio  a" sean la misma pestaña.
  var limpio = String(nombreProyecto || 'General').replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 90) || 'General';
  limpio = limpio.replace(/^_+/, '').trim() || 'General'; // "_" está reservado para las pestañas del sistema
  var hoja = buscarHoja(libro, limpio) || libro.insertSheet(limpio);
  if (hoja.getLastRow() > 0) asegurarEncabezados(hoja);
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

/** Completa encabezados y columnas de pestañas creadas con una versión anterior del script (nunca toca los datos existentes). */
function asegurarEncabezados(hoja) {
  var maxCol = hoja.getMaxColumns();
  if (maxCol < COLUMNAS.length) hoja.insertColumnsAfter(maxCol, COLUMNAS.length - maxCol);
  var cab = hoja.getRange(1, 1, 1, COLUMNAS.length).getValues()[0];
  COLUMNAS.forEach(function (c, i) {
    if (cab[i] !== '') return;
    hoja.getRange(1, i + 1).setValue(c[1]);
    hoja.getRange(1, i + 1, 1, 1).setFontWeight('bold').setBackground('#FFC53D');
    if (NUMERICAS.indexOf(c[0]) < 0) hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setNumberFormat('@');
  });
}

/** Lee todas las filas de datos con exactamente COLUMNAS.length columnas (rellena si la pestaña es antigua y más angosta). */
function leerFilas(hoja) {
  var n = hoja.getLastRow();
  if (n < 2) return [];
  var anchas = Math.min(COLUMNAS.length, hoja.getMaxColumns());
  var datos = hoja.getRange(2, 1, n - 1, anchas).getValues();
  if (anchas < COLUMNAS.length) datos.forEach(function (r) { while (r.length < COLUMNAS.length) r.push(''); });
  return datos;
}

function listar(hoja, desde) {
  var datos = leerFilas(hoja);
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

// Evita que un texto que empiece por = + @ (o - si no es un número) se interprete como fórmula: se antepone un espacio.
// (Un apóstrofo no sirve: en celdas de texto puede quedar guardado literalmente y no sobrevive a "Descargar como CSV".)
// La app recorta los espacios al descargar, así que el dato original no se altera.
function textoSeguro(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && (/^[=+@]/.test(v) || (/^-/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)))) return ' ' + v;
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

function buscarHoja(libro, nombre) {
  var hojas = libro.getSheets();
  for (var i = 0; i < hojas.length; i++) if (hojas[i].getName().toLowerCase() === nombre.toLowerCase()) return hojas[i];
  return null;
}

/* ---------------- Auditoría de capturas ---------------- */

function distanciaM(lat1, lng1, lat2, lng2) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function tiempo(v) {
  var t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return isNaN(t) ? null : t;
}

function esSi(v) { return v === true || String(v === undefined || v === null ? '' : v).toUpperCase().indexOf('S') === 0; }

/**
 * Calcula las alertas de cada captura. 'filas' = objetos con las claves de COLUMNAS; 'jornadas' = {id: {inicio, fin|null}} en ms.
 * Devuelve un arreglo paralelo de listas de códigos:
 *   UBICACION_SIMULADA, GALERIA, SIN_JORNADA, JORNADA_NO_CONFIRMADA, FUERA_DE_JORNADA, GPS_IMPRECISO, SALTO_IMPOSIBLE, AGRUPADAS
 * Los registros sin 'origen' (apps antiguas) no se evalúan contra la jornada. Es información para el supervisor, no un veredicto.
 */
function calcularAlertas(filas, jornadas) {
  var res = filas.map(function () { return []; });
  var porTecnico = {};
  var tol = TOLERANCIA_JORNADA_MIN * 60000;
  filas.forEach(function (f, i) {
    if (!f.uuid || esSi(f.eliminada)) return;
    var a = res[i];
    var t = tiempo(f.creadoEn);
    if (esSi(f.ubicacionSimulada)) a.push('UBICACION_SIMULADA');
    if (f.origen === 'galeria') a.push('GALERIA');
    if (f.origen) {
      if (!f.jornadaId) a.push('SIN_JORNADA');
      else {
        var j = jornadas[f.jornadaId];
        if (!j) a.push('JORNADA_NO_CONFIRMADA'); // puede deberse a que su jornada aún no ha sincronizado; se reevalúa en la próxima auditoría
        else if (t !== null && (t < j.inicio - tol || (j.fin !== null && t > j.fin + tol))) a.push('FUERA_DE_JORNADA');
      }
    }
    if (typeof f.precisionM === 'number' && f.precisionM > LIMITE_PRECISION_M) a.push('GPS_IMPRECISO');
    if (typeof f.latitud === 'number' && typeof f.longitud === 'number' && t !== null) {
      (porTecnico[f.tecnico] = porTecnico[f.tecnico] || []).push({ i: i, t: t, lat: f.latitud, lng: f.longitud });
    }
  });
  Object.keys(porTecnico).forEach(function (k) {
    var p = porTecnico[k].sort(function (x, y) { return x.t - y.t; });
    var ventana = AGRUPADAS_VENTANA_MIN * 60000;
    for (var x = 1; x < p.length; x++) {
      var d = distanciaM(p[x - 1].lat, p[x - 1].lng, p[x].lat, p[x].lng);
      var dt = (p[x].t - p[x - 1].t) / 1000;
      if (d > 300 && (dt <= 0 || (d / dt) * 3.6 > VELOCIDAD_MAX_KMH)) res[p[x].i].push('SALTO_IMPOSIBLE');
    }
    for (var m = 0; m < p.length; m++) {
      var cerca = 0;
      for (var y = m - 1; y >= 0 && p[m].t - p[y].t <= ventana; y--) if (distanciaM(p[m].lat, p[m].lng, p[y].lat, p[y].lng) <= AGRUPADAS_RADIO_M) cerca++;
      for (var z = m + 1; z < p.length && p[z].t - p[m].t <= ventana; z++) if (distanciaM(p[m].lat, p[m].lng, p[z].lat, p[z].lng) <= AGRUPADAS_RADIO_M) cerca++;
      if (cerca >= AGRUPADAS_MIN - 1) res[p[m].i].push('AGRUPADAS');
    }
  });
  return res;
}

function leerJornadas() {
  var out = {};
  var h = buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_JORNADAS);
  if (!h || h.getLastRow() < 2) return out;
  h.getRange(2, 1, h.getLastRow() - 1, COL_JORNADAS.length).getValues().forEach(function (r) {
    var inicio = tiempo(r[3]);
    if (r[0] && inicio !== null) out[r[0]] = { inicio: inicio, fin: r[4] === '' ? null : tiempo(r[4]) };
  });
  return out;
}

/** Recalcula la columna "Alertas" de toda la pestaña de un proyecto. */
function auditarHoja(hoja, enLinea) {
  var n = hoja.getLastRow();
  if (n < 2) return;
  if (enLinea && n - 1 > AUDITORIA_EN_LINEA_MAX_FILAS) return; // pestaña grande: la audita el activador por tiempo
  asegurarEncabezados(hoja);
  var datos = leerFilas(hoja);
  var filas = datos.map(function (r) {
    var o = {};
    COLUMNAS.forEach(function (c, i) { o[c[0]] = r[i]; });
    return o;
  });
  var alertas = calcularAlertas(filas, leerJornadas());
  var iA = col('alertas'), cambio = false;
  var nuevas = alertas.map(function (a, i) {
    var v = a.join(', ');
    if (String(datos[i][iA]) !== v) cambio = true;
    return [v];
  });
  if (cambio) hoja.getRange(2, iA + 1, n - 1, 1).setValues(nuevas); // solo escribe si algo cambió
}

/** Para un activador por tiempo (cada 10-15 min): re-audita todos los proyectos (p. ej. cuando llega una jornada tardía). */
function auditarTodo() {
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (h) {
    if (h.getName().charAt(0) !== '_') auditarHoja(h, false);
  });
}

/* ---------------- Monitoreo del equipo (jornadas) ---------------- */

var COL_EQUIPO = [
  ['dispositivo', 'Dispositivo'], ['tecnico', 'Técnico'], ['estado', 'Estado'], ['senal', 'Última señal'],
  ['latitud', 'Latitud'], ['longitud', 'Longitud'], ['precisionM', 'Precisión (m)'], ['proyecto', 'Proyecto'],
  ['luminarias', 'Luminarias en la jornada'], ['inicio', 'Jornada desde'], ['plataforma', 'Plataforma'], ['version', 'App'],
  ['visible', 'Estado actual']
];
var COL_JORNADAS = [
  ['jornadaId', 'ID jornada'], ['dispositivo', 'Dispositivo'], ['tecnico', 'Técnico'], ['inicio', 'Inicio'],
  ['fin', 'Fin'], ['horas', 'Horas'], ['luminarias', 'Luminarias'], ['proyecto', 'Proyecto']
];
var TEXTO_EQUIPO = ['dispositivo', 'tecnico', 'estado', 'proyecto', 'plataforma', 'version'];
var TEXTO_JORNADAS = ['jornadaId', 'dispositivo', 'tecnico', 'proyecto'];

function hojaSistema(nombre, columnas, textoClaves) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = buscarHoja(libro, nombre);
  if (hoja) return hoja;
  hoja = libro.insertSheet(nombre);
  hoja.appendRow(columnas.map(function (c) { return c[1]; }));
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, columnas.length).setFontWeight('bold').setBackground('#FFC53D');
  columnas.forEach(function (c, i) {
    if (textoClaves.indexOf(c[0]) >= 0) hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  return hoja;
}

/** Inserta o actualiza la fila cuya columna iClave vale "clave". 'conservar' = campos que no se pisan una vez escritos. */
function buscarFila(hoja, columnas, iClave, clave) {
  var n = hoja.getLastRow();
  var datos = n > 1 ? hoja.getRange(2, 1, n - 1, columnas.length).getValues() : [];
  for (var i = 0; i < datos.length; i++) if (String(datos[i][iClave]) === String(clave)) return { fila: i + 2, datos: datos };
  return { fila: 0, datos: datos };
}

function upsert(hoja, columnas, iClave, clave, obj, conservar) {
  var enc = buscarFila(hoja, columnas, iClave, clave);
  var fila = enc.fila, datos = enc.datos;
  var valores = columnas.map(function (c, j) {
    var v = obj[c[0]] === undefined ? '' : obj[c[0]];
    if (fila && conservar && conservar.indexOf(c[0]) >= 0 && datos[fila - 2][j] !== '') v = datos[fila - 2][j];
    return typeof v === 'string' ? textoSeguro(v) : v;
  });
  if (fila) hoja.getRange(fila, 1, 1, columnas.length).setValues([valores]);
  else { hoja.appendRow(valores); fila = hoja.getLastRow(); }
  return fila;
}

function texto(v, max) { return String(v === undefined || v === null ? '' : v).substring(0, max); }

/* ---------------- Usuarios (pestaña _Usuarios: el administrador crea personas y roles aquí) ---------------- */

var COLUMNAS_USUARIOS = [['nombre', 'Nombre'], ['rol', 'Rol (tecnico o supervisor)'], ['clave', 'Clave'], ['activo', 'Activo (si/no)']];

/** Crea la pestaña si no existe y la deja lista. También se puede ejecutar a mano. */
function prepararUsuarios() {
  var nueva = !buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_USUARIOS);
  var hoja = hojaSistema(HOJA_USUARIOS, COLUMNAS_USUARIOS, ['nombre', 'rol', 'clave', 'activo']);
  if (nueva) hoja.appendRow(['Ejemplo Técnico', 'tecnico', '', 'no']);
  return hoja;
}

/** Rellena con una clave aleatoria las filas que tengan nombre pero no clave. Menú: ELI-LUMINARIA → Generar claves faltantes. */
function generarClavesFaltantes() {
  var hoja = prepararUsuarios();
  var n = hoja.getLastRow();
  if (n < 2) return 0;
  var datos = hoja.getRange(2, 1, n - 1, 4).getValues();
  var hechas = 0;
  datos.forEach(function (r, i) {
    if (String(r[0]).trim() && !String(r[2]).trim() && !usuarioInactivo(r[3])) { // la fila de ejemplo (Activo = no) se deja como está
      hoja.getRange(i + 2, 3).setValue(Utilities.getUuid().replace(/-/g, '').substring(0, 12));
      hechas++;
    }
  });
  return hechas;
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('ELI-LUMINARIA')
      .addItem('Preparar pestaña Usuarios', 'prepararUsuarios')
      .addItem('Generar claves faltantes', 'generarClavesFaltantes')
      .addToUi();
  } catch (e) {}
}

function usuarioInactivo(v) {
  var a = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return a === 'no' || a === 'n' || a === 'false' || a === '0';
}

/** { nombre, rol } de la clave, o null. Sin pestaña, sin clave o con Activo = no → null. Cualquier rol que no sea "supervisor" es técnico. */
function buscarUsuario(clave) {
  clave = String(clave === undefined || clave === null ? '' : clave).trim();
  if (!clave) return null;
  var hoja = buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_USUARIOS);
  if (!hoja || hoja.getLastRow() < 2) return null;
  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < datos.length; i++) {
    var r = datos[i];
    if (String(r[2]).trim() !== clave) continue;
    if (usuarioInactivo(r[3])) return null;
    var nombre = String(r[0]).trim();
    if (!nombre) return null;
    var rol = String(r[1]).trim().toLowerCase().indexOf('sup') === 0 ? 'supervisor' : 'tecnico';
    return { nombre: nombre, rol: rol };
  }
  return null;
}

/** Un latido por teléfono con jornada: sobrescribe SU fila (solo se guarda la última posición, sin historial de rutas). */
function registrarLatido(d, ahora) {
  var estados = { activa: 'En jornada', pausada: 'Pausada', terminada: 'Terminada' };
  var estado = estados[d.estado];
  var dispositivo = texto(d.dispositivo, 64);
  if (!estado) return { ok: false, error: 'Estado de jornada inválido' };
  if (!dispositivo) return { ok: false, error: 'Falta el identificador del dispositivo' };

  // La ubicación solo cuenta con la jornada ACTIVA; en pausa o al terminar se borra la última posición.
  var conPos = d.estado === 'activa' && typeof d.latitud === 'number' && typeof d.longitud === 'number' &&
    Math.abs(d.latitud) <= 90 && Math.abs(d.longitud) <= 180;
  var inicio = d.inicio ? new Date(d.inicio) : new Date(ahora);
  if (isNaN(inicio.getTime())) inicio = new Date(ahora);
  var senal = new Date(ahora);
  var luminarias = Number(d.luminarias) || 0;

  var idJornada = texto(d.jornadaId, 64) || dispositivo + '-' + inicio.getTime();
  var hJ = hojaSistema(HOJA_JORNADAS, COL_JORNADAS, TEXTO_JORNADAS);
  var previa = buscarFila(hJ, COL_JORNADAS, 0, idJornada);
  // Un latido atrasado (p. ej. una "pausa" que tardó en llegar) no puede reabrir una jornada que ya se cerró.
  if (previa.fila && previa.datos[previa.fila - 2][4] !== '' && d.estado !== 'terminada') return { ok: true, ignorado: true };

  var hE = hojaSistema(HOJA_EQUIPO, COL_EQUIPO, TEXTO_EQUIPO);
  var fe = upsert(hE, COL_EQUIPO, 0, dispositivo, {
    dispositivo: dispositivo, tecnico: texto(d.tecnico, 80), estado: estado, senal: senal,
    latitud: conPos ? d.latitud : '', longitud: conPos ? d.longitud : '',
    precisionM: conPos && typeof d.precisionM === 'number' ? Math.round(d.precisionM) : '',
    proyecto: texto(d.proyecto, 90), luminarias: luminarias, inicio: inicio,
    plataforma: texto(d.plataforma, 20), version: texto(d.version, 20), visible: ''
  });
  // Estado actual: se recalcula solo al abrir la hoja (Sin señal si el último latido es viejo)
  hE.getRange(fe, COL_EQUIPO.length).setFormulaR1C1(
    '=IF(RC3="Terminada","Terminada",IF(RC3="Pausada","Pausada",IF(NOW()-RC4>TIME(0,' + MINUTOS_SIN_SENAL + ',0),"Sin señal","En jornada")))');

  // La hora de fin la declara el teléfono (puede haber cerrado sin señal y enviar horas después), acotada: no antes del inicio ni en el futuro.
  var fin = '';
  if (d.estado === 'terminada') {
    var finCliente = d.fin ? new Date(d.fin) : null;
    fin = finCliente && !isNaN(finCliente.getTime()) && finCliente >= inicio ? new Date(Math.min(finCliente.getTime(), senal.getTime())) : senal;
  }
  upsert(hJ, COL_JORNADAS, 0, idJornada, {
    jornadaId: idJornada, dispositivo: dispositivo, tecnico: texto(d.tecnico, 80),
    inicio: inicio, fin: fin, horas: fin ? Math.round((fin - inicio) / 36000) / 100 : '', luminarias: luminarias, proyecto: texto(d.proyecto, 90)
  }, ['fin', 'horas']); // reintentos de "terminar" no mueven la hora de fin
  return { ok: true };
}

/** Datos para el mapa en vivo (los consume la página con google.script.run). Exige TOKEN_ADMIN. */
function datosEquipo(token) {
  if (token !== TOKEN_ADMIN) throw new Error('Acceso denegado');
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var ahora = new Date();
  var iso = function (v) { return v instanceof Date ? v.toISOString() : v; };

  var tecnicos = [];
  var hE = buscarHoja(libro, HOJA_EQUIPO);
  if (hE && hE.getLastRow() > 1) {
    hE.getRange(2, 1, hE.getLastRow() - 1, COL_EQUIPO.length).getValues().forEach(function (r) {
      if (!r[0]) return;
      var senal = r[3] instanceof Date ? r[3] : new Date(r[3]);
      var estado = String(r[2]);
      var efectivo = estado === 'En jornada' && (ahora - senal) / 60000 > MINUTOS_SIN_SENAL ? 'Sin señal' : estado;
      tecnicos.push({ dispositivo: r[0], tecnico: r[1], estado: efectivo, estadoReportado: estado, senal: iso(senal),
        latitud: r[4], longitud: r[5], precisionM: r[6], proyecto: r[7], luminarias: r[8], inicio: iso(r[9]), plataforma: r[10] });
    });
  }

  var luminarias = [];
  var calidad = {};
  var iAl = col('alertas');
  var iLat = col('latitud'), iLng = col('longitud'), iTec = col('tecnico'), iMarca = col('marca'), iTecn = col('tecnologia'), iEli = col('eliminada');
  libro.getSheets().forEach(function (h) {
    if (h.getName().charAt(0) === '_' || h.getLastRow() < 2 || luminarias.length >= 5000) return;
    leerFilas(h).forEach(function (r) {
      if (luminarias.length >= 5000 || !r[0] || String(r[iEli]).toUpperCase().indexOf('S') === 0) return;
      var q = calidad[r[iTec]] = calidad[r[iTec]] || { total: 0, conAlertas: 0, codigos: {} };
      q.total++;
      if (r[iAl]) { q.conAlertas++; String(r[iAl]).split(', ').forEach(function (c) { q.codigos[c] = (q.codigos[c] || 0) + 1; }); }
      if (typeof r[iLat] === 'number' && typeof r[iLng] === 'number') luminarias.push({ lat: r[iLat], lng: r[iLng], tec: r[iTec], marca: r[iMarca], tecnologia: r[iTecn] });
    });
  });
  return { ahora: ahora.toISOString(), limite: MINUTOS_SIN_SENAL, tecnicos: tecnicos, luminarias: luminarias, calidad: calidad };
}

var PAGINA_EQUIPO = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
 html,body{height:100%;margin:0;font:14px/1.35 system-ui,sans-serif;color:#0f1b2d;background:#f4f6fa}
 #top{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#0f1b2d;color:#f2f6fb}
 #top b{color:#ffc53d;letter-spacing:.5px} #top label{margin-left:auto;cursor:pointer}
 #main{display:flex;height:calc(100% - 46px)} #lista{width:320px;max-width:42%;overflow:auto;background:#fff;border-right:1px solid #d5dde9}
 #map{flex:1}
 .t{padding:10px 12px;border-bottom:1px solid #e8edf5;cursor:pointer} .t:hover{background:#f4f6fa}
 .t .n{font-weight:700} .t .s{font-size:12px;color:#5b6b80} .pt{display:inline-block;width:10px;height:10px;border-radius:5px;margin-right:6px}
 #vacio{padding:16px;color:#5b6b80}
 @media (max-width:700px){#main{flex-direction:column-reverse}#lista{width:auto;max-width:none;height:38%;border-right:0;border-top:1px solid #d5dde9}}
</style></head><body>
<div id="top"><b>ELI-LUMINARIA · Equipo</b><span id="res">Cargando…</span><span id="act"></span>
 <label><input type="checkbox" id="ver"> ver luminarias</label></div>
<div id="main"><div id="lista"></div><div id="map"></div></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var TOKEN = __TOKEN__;
var COLORES = {'En jornada':'#16a34a','Sin señal':'#ea580c','Pausada':'#2563eb','Terminada':'#6b7280'};
var ORDEN = {'En jornada':0,'Sin señal':1,'Pausada':2,'Terminada':3};
var map = L.map('map').setView([4.65,-74.1],6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var capaT = L.layerGroup().addTo(map), capaL = L.layerGroup(), marcas = {}, primera = true;
document.getElementById('ver').onchange = function(){ if(this.checked) capaL.addTo(map); else map.removeLayer(capaL); };

function hace(iso, ahora){
  var m = Math.round((new Date(ahora) - new Date(iso)) / 60000);
  if (isNaN(m)) return '—'; if (m < 1) return 'ahora'; if (m < 60) return 'hace ' + m + ' min';
  return 'hace ' + Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
function el(tag, cls, txt){ var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

function pintar(d){
  capaT.clearLayers(); capaL.clearLayers(); marcas = {};
  var lista = document.getElementById('lista'); lista.innerHTML = '';
  var cuenta = {'En jornada':0,'Sin señal':0,'Pausada':0,'Terminada':0};
  d.tecnicos.sort(function(a,b){ return (ORDEN[a.estado]-ORDEN[b.estado]) || String(a.tecnico).localeCompare(b.tecnico); });
  var puntos = [];
  d.tecnicos.forEach(function(t){
    cuenta[t.estado] = (cuenta[t.estado] || 0) + 1;
    var fila = el('div','t');
    var n = el('div','n'); var p = el('span','pt'); p.style.background = COLORES[t.estado] || '#6b7280';
    n.appendChild(p); n.appendChild(document.createTextNode(t.tecnico || 'Sin nombre')); fila.appendChild(n);
    fila.appendChild(el('div','s', t.estado + ' · ' + hace(t.senal, d.ahora)));
    fila.appendChild(el('div','s', (t.luminarias || 0) + ' luminarias · ' + (t.proyecto || '—') + ' · ' + (t.plataforma || '')));
    var q = (d.calidad || {})[t.tecnico];
    if (q) {
      var cods = Object.keys(q.codigos).map(function(k){ return k + ' ×' + q.codigos[k]; }).join(', ');
      var linea = el('div', 's', q.total + ' capturas · ' + q.conAlertas + ' con alertas' + (cods ? ' (' + cods + ')' : ''));
      if (q.conAlertas) linea.style.color = '#c2410c';
      fila.appendChild(linea);
    }
    lista.appendChild(fila);
    if (t.latitud !== '' && t.latitud != null && t.longitud !== '' && t.longitud != null) {
      var m = L.circleMarker([t.latitud, t.longitud], {radius:11, color:'#fff', weight:3, fillColor: COLORES[t.estado] || '#6b7280', fillOpacity:1}).addTo(capaT);
      m.bindTooltip(esc(t.tecnico || 'Sin nombre'), {permanent:true, direction:'top', offset:[0,-10]});
      m.bindPopup('<b>' + esc(t.tecnico) + '</b><br>' + esc(t.estado) + ' · ' + hace(t.senal, d.ahora) + '<br>' + (t.luminarias||0) + ' luminarias');
      marcas[t.dispositivo] = m; puntos.push([t.latitud, t.longitud]);
      fila.onclick = (function(mm, la, lo){ return function(){ map.setView([la, lo], 17); mm.openPopup(); }; })(m, t.latitud, t.longitud);
    }
  });
  if (!d.tecnicos.length) lista.appendChild(el('div', null, 'Aún no hay técnicos con jornada.')).id = 'vacio';
  d.luminarias.forEach(function(l){
    L.circleMarker([l.lat, l.lng], {radius:3, color:'#475569', weight:1, fillColor:'#94a3b8', fillOpacity:.8}).bindTooltip(esc((l.marca || 'Luminaria') + (l.tec ? ' · ' + l.tec : ''))).addTo(capaL);
  });
  document.getElementById('res').textContent = cuenta['En jornada'] + ' en jornada · ' + cuenta['Sin señal'] + ' sin señal · ' + cuenta['Pausada'] + ' en pausa';
  document.getElementById('act').textContent = 'actualizado ' + new Date(d.ahora).toLocaleTimeString();
  if (primera && puntos.length) { map.fitBounds(puntos, {padding:[60,60], maxZoom:16}); primera = false; }
}
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function cargar(){
  google.script.run.withSuccessHandler(pintar)
    .withFailureHandler(function(e){ document.getElementById('act').textContent = 'Error: ' + (e && e.message || e); })
    .datosEquipo(TOKEN);
}
cargar(); setInterval(cargar, 60000);
</script></body></html>`;
