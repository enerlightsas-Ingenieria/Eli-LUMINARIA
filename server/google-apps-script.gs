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
 *   { token, accion:'ingresar', usuario, clave } / { token, accion:'proyectos' }          → ingreso con usuario y clave; nombres de los proyectos
 *   { token, accion:'usuario', clave }                                      → quién es esa clave según la pestaña _Usuarios (lo usa el proxy)
 *   { token: TOKEN_ADMIN, accion:'usuarios_listar' | 'usuarios_guardar' }   → menú de administración de la web (crear/editar usuarios)
 *   { token, accion:'config' } / { token: TOKEN_ADMIN, accion:'config_guardar', clave, valor } → ajustes del sistema (pestaña _Config), p. ej. qué IA va primero
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
var HOJA_EQUIPO = '_Equipo', HOJA_JORNADAS = '_Jornadas', HOJA_USUARIOS = '_Usuarios', HOJA_CONFIG = '_Config', HOJA_PROYECTOS = '_Proyectos'; // pestañas del sistema (los proyectos no pueden empezar por "_")

var COLUMNAS = [
  ['uuid', 'UUID'], ['id', 'ID (local del teléfono)'], ['codigoPoste', 'Código del poste'], ['codigo', 'Código de la luminaria'], ['creadoEn', 'Fecha'],
  ['tecnico', 'Técnico'], ['latitud', 'Latitud'], ['longitud', 'Longitud'], ['precisionM', 'Precisión (m)'],
  ['direccion', 'Dirección'], ['fabricante', 'Fabricante'],
  ['tecnologia', 'Tecnología'], ['potenciaW', 'Potencia (W)'],
  ['control', 'Control'], ['montaje', 'Montaje'],
  ['estado', 'Estado'], ['confianza', 'Confianza IA'], ['observaciones', 'Observaciones'],
  ['mapa', 'Enlace mapa'], ['foto', 'Foto'], ['eliminada', 'Eliminada'], ['recibidoEn', 'Recibido'],
  // Las columnas nuevas se AÑADEN SIEMPRE AL FINAL: todo el script lee por posición y así las pestañas ya creadas siguen siendo válidas.
  ['origen', 'Origen de la foto'], ['ubicacionSimulada', 'Ubicación simulada'], ['jornadaId', 'ID jornada'], ['alertas', 'Alertas'], ['usuario', 'Usuario'],
  ['sector', 'Sector'], ['materialPoste', 'Material del poste'], ['numeroTransformador', 'N.º transformador'],
  ['barrio', 'Barrio'], ['miniatura', 'Miniatura (no editar)']
];
// La miniatura es la foto pequeña que se reparte a los teléfonos: su columna va oculta.
var COLUMNAS_OCULTAS = ['miniatura'];
// Columnas de campos que la app ya no pide (modelo, tensión, pines, temperatura de color, grado IP): se BORRAN de las pestañas que las traigan.
var COLUMNAS_BORRAR = ['Modelo', 'Tensión (V)', 'Pines fotocelda', 'Temp. color (K)', 'IP'];
// Encabezados de la versión anterior (con Marca, Tipo de luminaria, Flujo y Altura): esas pestañas se archivan, no se mezclan.
var ENCABEZADOS_RETIRADOS = ['Marca', 'Tipo de luminaria', 'Flujo (lm)', 'Altura (m)', 'Código activo'];
// Columnas que se dejan como número (para sumar/graficar); el resto se fuerza a texto para que Sheets no
// convierta modelos como "1-2" en fechas ni recorte ceros.
var NUMERICAS = ['id', 'latitud', 'longitud', 'precisionM', 'potenciaW'];

function col(clave) { for (var i = 0; i < COLUMNAS.length; i++) if (COLUMNAS[i][0] === clave) return i; return -1; }

function doPost(e) {
  var lock = LockService.getScriptLock(), conLock = false;
  try {
    var d = JSON.parse(e.postData.contents);
    // 'equipo' y la administración de usuarios exigen TOKEN_ADMIN; todo lo demás, el token del equipo
    var soloAdmin = ['equipo', 'usuarios_listar', 'usuarios_guardar', 'usuarios_borrar', 'proyecto_guardar', 'proyecto_activar', 'proyecto_eliminar', 'config_guardar', 'ia_clave_guardar', 'ia_claves'].indexOf(d.accion) >= 0;
    var esAdmin = soloAdmin && d.token === TOKEN_ADMIN;
    if (soloAdmin ? !esAdmin : d.token !== TOKEN) return salida({ ok: false, error: 'Token inválido' }); // las acciones de administración NO sirven con el token del equipo
    // Las consultas que solo leen usuarios o configuración NO esperan el candado: así no se hace cola detrás de los envíos y no se agota la espera.
    if (['usuario', 'ingresar', 'contactos', 'config', 'ia_claves', 'usuarios_listar'].indexOf(d.accion) < 0) { lock.waitLock(45000); conLock = true; }
    var ahora = new Date().toISOString(); // se toma ANTES de leer: el cursor de los teléfonos nunca se salta escrituras
    if (d.accion === 'equipo') { var datos = datosEquipo(TOKEN_ADMIN); datos.ok = true; return salida(datos); }
    if (d.accion === 'latido') return salida(registrarLatido(d, ahora));
    if (d.accion === 'usuario') return salida({ ok: true, usuario: buscarUsuario(d.clave) });
    if (d.accion === 'ingresar') return salida({ ok: true, usuario: ingresarUsuario(d.usuario, d.clave) });
    if (d.accion === 'proyectos') { var infoP = proyectosInfo(); return salida({ ok: true, proyectos: infoP.filter(function (x) { return x.activo; }).map(function (x) { return x.nombre; }), info: infoP.map(quitarFila) }); }
    if (d.accion === 'contactos') return salida({ ok: true, contactos: contactosUsuarios() });
    if (d.accion === 'config') return salida({ ok: true, config: leerConfig() });
    if (d.accion === 'config_guardar') return salida(guardarConfig(d));
    if (d.accion === 'ia_clave_guardar') return salida(guardarClaveIA(d));
    if (d.accion === 'ia_claves') return salida({ ok: true, claves: clavesIA() });
    if (d.accion === 'usuarios_listar') return salida({ ok: true, usuarios: listarUsuarios() });
    if (d.accion === 'usuarios_guardar') return salida(guardarUsuario(d));
    if (d.accion === 'usuarios_borrar') return salida(borrarUsuario(d));
    if (d.accion === 'proyecto_guardar') return salida(guardarProyecto(d));
    if (d.accion === 'proyecto_activar') return salida(activarProyecto(d));
    if (d.accion === 'proyecto_eliminar') return salida(eliminarProyecto(d));
    var hoja = obtenerHoja(d.proyecto, d.soloExistentes === true);
    if (!hoja) return salida({ ok: false, error: 'El proyecto no existe (o fue eliminado). Solo el administrador crea proyectos: pídele que lo cree.' });

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
      var n = fila[l.uuid];
      // Quién registró: lo sella el proxy según la cuenta con la que se ingresó (el teléfono no puede declarar otro). Al editar, el autor original se conserva.
      if (n) {
        var iT = col('tecnico'), iUs = col('usuario');
        var previa = hoja.getRange(n, 1, 1, COLUMNAS.length).getValues()[0];
        if (previa[iT] !== '' && previa[iT] !== undefined) l.tecnico = previa[iT];
        if (previa[iUs] !== '' && previa[iUs] !== undefined) l.usuario = previa[iUs]; else if (d.por && d.por.usuario) l.usuario = d.por.usuario;
      } else if (d.por && d.por.usuario) {
        l.usuario = d.por.usuario;
        if (d.por.nombre) l.tecnico = d.por.nombre;
      }
      var valores = COLUMNAS.map(function (c) { return textoSeguro(l[c[0]]); });
      if (n) {
        var iF = col('foto');
        if (!l.foto) valores[iF] = hoja.getRange(n, iF + 1).getValue(); // conserva el enlace de foto anterior
        var iMi = col('miniatura');
        if (!l.miniatura) valores[iMi] = hoja.getRange(n, iMi + 1).getValue(); // y la miniatura
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
    if (conLock) { try { lock.releaseLock(); } catch (x) {} }
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

function obtenerHoja(proyecto, soloExistentes) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var nombreProyecto = proyecto && proyecto.nombre;
  // Si el teléfono manda el id del proyecto, manda el nombre ACTUAL de la hoja (así un teléfono con el nombre viejo no recrea el proyecto renombrado).
  if (proyecto && proyecto.id) { var conocido = proyectoPorId(proyecto.id); if (conocido) nombreProyecto = conocido.nombre; }
  // Se normaliza el nombre (espacios y mayúsculas) para que "Barrio A" y "barrio  a" sean la misma pestaña.
  var limpio = nombreLimpio(nombreProyecto) || 'General';
  var hoja = buscarHoja(libro, limpio);
  if (hoja && esDisenoAnterior(hoja)) { archivarHoja(libro, hoja); hoja = null; }
  if (!hoja && soloExistentes) return null;                           // solo el administrador crea proyectos
  var nueva = !hoja;
  hoja = hoja || libro.insertSheet(limpio);
  if (hoja.getLastRow() > 0) { actualizarColumnas(hoja); asegurarEncabezados(hoja); }
  if (nueva) agregarFilaProyecto(limpio, proyecto && proyecto.cliente);
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(COLUMNAS.map(function (c) { return c[1]; }));
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold').setBackground('#FFC53D');
    COLUMNAS.forEach(function (c, i) {
      if (NUMERICAS.indexOf(c[0]) < 0) hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    ocultarColumnas(hoja);
  }
  return hoja;
}

/** ¿La pestaña tiene el diseño anterior de columnas (con campos que ya no existen)? */
function esDisenoAnterior(hoja) {
  if (hoja.getLastRow() < 1) return false;
  var n = Math.min(hoja.getMaxColumns(), 60);
  var cab = hoja.getRange(1, 1, 1, n).getValues()[0];
  for (var i = 0; i < cab.length; i++) if (ENCABEZADOS_RETIRADOS.indexOf(String(cab[i])) >= 0) return true;
  return false;
}

/** Aparta la pestaña anterior sin borrar nada: "Proyecto" → "Proyecto (anterior)". La pestaña nueva nace con el diseño actual. */
function archivarHoja(libro, hoja) {
  var base = hoja.getName() + ' (anterior)', nombre = base, k = 2;
  while (buscarHoja(libro, nombre)) nombre = base + ' ' + k++;
  hoja.setName(nombre);
}

/** Completa encabezados y columnas de pestañas creadas con una versión anterior del script (nunca toca los datos existentes). */
function asegurarEncabezados(hoja) {
  var maxCol = hoja.getMaxColumns();
  if (maxCol < COLUMNAS.length) hoja.insertColumnsAfter(maxCol, COLUMNAS.length - maxCol);
  var cab = hoja.getRange(1, 1, 1, COLUMNAS.length).getValues()[0];
  var nuevas = false;
  COLUMNAS.forEach(function (c, i) {
    if (cab[i] !== '') return;
    nuevas = true;
    hoja.getRange(1, i + 1).setValue(c[1]);
    hoja.getRange(1, i + 1, 1, 1).setFontWeight('bold').setBackground('#FFC53D');
    if (NUMERICAS.indexOf(c[0]) < 0) hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  if (nuevas) ocultarColumnas(hoja);   // una pestaña de una versión anterior recibe las columnas nuevas y esconde la miniatura
}

/** Oculta las columnas internas (la miniatura). */
function ocultarColumnas(hoja) {
  COLUMNAS.forEach(function (c, i) { if (COLUMNAS_OCULTAS.indexOf(c[0]) >= 0) hoja.hideColumns(i + 1); });
}

/**
 * Pone una pestaña con el diseño anterior al día: BORRA las columnas de los campos retirados (modelo, tensión, pines, temperatura de color,
 * IP) y convierte "Fotocelda" (Sí/No) en "Control" (Fotocelda / Sin control). Los demás datos no se tocan.
 */
function actualizarColumnas(hoja) {
  var n = Math.min(hoja.getMaxColumns(), 60);
  var cab = hoja.getRange(1, 1, 1, n).getValues()[0];
  var hubo = false;
  for (var i = cab.length - 1; i >= 0; i--) if (COLUMNAS_BORRAR.indexOf(String(cab[i])) >= 0) { hoja.deleteColumn(i + 1); hubo = true; }
  if (hubo) cab = hoja.getRange(1, 1, 1, Math.min(hoja.getMaxColumns(), 60)).getValues()[0];
  var iF = cab.indexOf('Fotocelda');
  if (iF < 0) return;
  hoja.getRange(1, iF + 1).setValue('Control');
  var filas = hoja.getLastRow() - 1;
  if (filas < 1) return;
  var rango = hoja.getRange(2, iF + 1, filas, 1);
  rango.setValues(rango.getValues().map(function (r) {
    var v = String(r[0] === undefined || r[0] === null ? '' : r[0]).trim();
    return [!v ? '' : /^(no|sin)/i.test(v) ? 'Sin control' : 'Fotocelda'];
  }));
}

/** Antes de leer una pestaña de proyecto por posición: si trae el diseño anterior de columnas, se actualiza. */
function prepararLectura(h) {
  if (h.getLastRow() >= 1 && h.getRange(1, 1).getValue() === COLUMNAS[0][1] && !esDisenoAnterior(h)) actualizarColumnas(h);
}

/** Quita las columnas retiradas de TODAS las pestañas de proyecto (menú ELI-LUMINARIA). */
function actualizarTodasLasColumnas() {
  var libro = SpreadsheetApp.getActiveSpreadsheet(), n = 0;
  libro.getSheets().forEach(function (h) { if (esPestanaProyecto(h)) { actualizarColumnas(h); asegurarEncabezados(h); n++; } });
  return n;
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
 *   UBICACION_SIMULADA, GALERIA, SIN_JORNADA, JORNADA_NO_CONFIRMADA, FUERA_DE_JORNADA, GPS_IMPRECISO, SIN_COORDENADA, SALTO_IMPOSIBLE, AGRUPADAS
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
    if (typeof f.latitud !== 'number' || typeof f.longitud !== 'number') a.push('SIN_COORDENADA'); // la coordenada es lo más importante: la app no deja guardar sin ella; esto avisa si llega algo así
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
    if (h.getName().charAt(0) !== '_') { prepararLectura(h); auditarHoja(h, false); }
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

/* ---------------- Limpieza de pestañas que ya no se usan ---------------- */

var PESTANAS_SISTEMA = ['_equipo', '_jornadas', '_usuarios', '_config', '_proyectos'];
var PESTANAS_VACIAS_DE_GOOGLE = ['hoja 1', 'hoja1', 'sheet1', 'sheet 1'];

/**
 * Pestañas que ya no sirven, con el motivo. NUNCA incluye las del sistema ni una pestaña de proyecto que tenga datos:
 *  - "Proyecto (anterior)": quedaron archivadas al cambiar el diseño de columnas.
 *  - "Hoja 1" / "Sheet1" vacías (las crea Google al abrir la hoja).
 *  - pestañas de proyecto sin ningún registro (solo encabezados): se vuelven a crear solas cuando alguien sincroniza.
 */
function pestanasObsoletas() {
  var res = [];
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (h) {
    var nombre = h.getName(), clave = nombre.toLowerCase();
    if (PESTANAS_SISTEMA.indexOf(clave) >= 0 || clave.charAt(0) === '_') return;
    var filas = h.getLastRow();
    if (/ \(eliminado( \d+)?\)$/.test(nombre)) res.push({ nombre: nombre, motivo: 'proyecto eliminado por el administrador', filas: Math.max(0, filas - 1) });
    else if (/ \(anterior( \d+)?\)$/.test(nombre)) res.push({ nombre: nombre, motivo: 'archivada con el diseño anterior de columnas', filas: Math.max(0, filas - 1) });
    else if (PESTANAS_VACIAS_DE_GOOGLE.indexOf(clave) >= 0 && filas <= 1) res.push({ nombre: nombre, motivo: 'hoja en blanco de Google', filas: 0 });
    else if (filas <= 1 && h.getRange(1, 1).getValue() === COLUMNAS[0][1]) res.push({ nombre: nombre, motivo: 'proyecto sin registros (se recrea sola al sincronizar)', filas: 0 });
  });
  return res;
}

/** Borra las pestañas indicadas (siempre queda al menos una pestaña en el libro). Devuelve los nombres borrados. */
function eliminarPestanas(nombres) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var borradas = [];
  nombres.forEach(function (n) {
    var h = buscarHoja(libro, n);
    if (!h || libro.getSheets().length <= 1) return;
    libro.deleteSheet(h);
    borradas.push(n);
  });
  return borradas;
}

/** Menú ELI-LUMINARIA → Limpiar pestañas obsoletas: muestra la lista y pide confirmación antes de borrar. */
function limpiarPestanasObsoletas() {
  var ui = SpreadsheetApp.getUi();
  var lista = pestanasObsoletas();
  if (!lista.length) { ui.alert('No hay pestañas obsoletas. Todo está en uso.'); return; }
  var texto = lista.map(function (p) { return '• ' + p.nombre + ' — ' + p.motivo + (p.filas ? ' (' + p.filas + ' registros)' : ''); }).join('\n');
  var r = ui.alert('¿Borrar estas pestañas?', texto + '\n\nEsta acción no se puede deshacer. No se tocan las pestañas del sistema (_Usuarios, _Config, _Equipo, _Jornadas) ni los proyectos con registros.', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  var n = eliminarPestanas(lista.map(function (p) { return p.nombre; })).length;
  ui.alert('Listo: ' + n + ' pestaña(s) borrada(s).');
}

/* ---------------- Reinicio total ---------------- */

/**
 * Borra TODOS los datos: cada pestaña de proyecto, _Equipo y _Jornadas, y manda a la papelera de Drive la carpeta de fotos
 * (se puede recuperar 30 días). Conserva _Config; _Usuarios solo se borra si se pide. Siempre queda al menos una pestaña.
 */
function reiniciarDatos(incluirUsuarios) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var quitar = libro.getSheets().filter(function (h) {
    var c = h.getName().toLowerCase();
    if (c === '_config') return false;
    if (c === '_usuarios') return incluirUsuarios === true;
    return true; // proyectos, _equipo, _jornadas y cualquier otra
  });
  if (quitar.length >= libro.getSheets().length) libro.insertSheet('Inicio'); // Google exige al menos una pestaña
  quitar.forEach(function (h) { libro.deleteSheet(h); });
  var fotos = 0;
  var it = DriveApp.getFoldersByName(CARPETA_FOTOS);
  while (it.hasNext()) { it.next().setTrashed(true); fotos++; }
  return { pestanas: quitar.length, carpetasDeFotos: fotos, usuarios: incluirUsuarios === true ? 'borrados' : 'conservados' };
}

/** Menú ELI-LUMINARIA → Reiniciar TODO desde cero: tres confirmaciones, la última escribiendo BORRAR. */
function reiniciarDesdeCero() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.alert('Reiniciar todo desde cero', 'Se borrarán TODOS los registros de TODOS los proyectos, el monitoreo de jornadas y la carpeta de fotos de Drive (irá a la papelera). Esta acción no se puede deshacer en la hoja.', ui.ButtonSet.YES_NO);
  if (a !== ui.Button.YES) return;
  var p = ui.prompt('Confirmación', 'Escribe BORRAR (en mayúsculas) para continuar:', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK || p.getResponseText().trim() !== 'BORRAR') { ui.alert('No se borró nada.'); return; }
  var u = ui.alert('Usuarios', '¿Borrar también la lista de usuarios (pestaña _Usuarios)?\n\nSÍ = habrá que crear a todos de nuevo (tu cuenta de administrador de Cloudflare sigue funcionando).\nNO = se conservan los usuarios y sus enlaces.', ui.ButtonSet.YES_NO);
  var r = reiniciarDatos(u === ui.Button.YES);
  ui.alert('Listo', r.pestanas + ' pestaña(s) borrada(s); carpetas de fotos a la papelera: ' + r.carpetasDeFotos + '; usuarios ' + r.usuarios + '.\n\nSiguiente: borra los datos en cada teléfono (Ajustes → Borrar todos los datos de este dispositivo).', ui.ButtonSet.OK);
}

/* ---------------- Ajustes del sistema (pestaña _Config) ---------------- */

var COLUMNAS_CONFIG = [['clave', 'Clave'], ['valor', 'Valor']];
var PROVEEDORES_IA = ['gemini', 'claude', 'groq', 'openrouter', 'mistral', 'qwen', 'kimi', 'openai', 'otra'];
// ia = qué IA va primero; fotos = guardar la 1.ª foto en Drive; gemini_modelo = modelo de Gemini; modelo_<proveedor> y base_otra = ver configValida
var CONFIG_PERMITIDA = { ia: PROVEEDORES_IA, fotos: ['si', 'no'], gemini_modelo: /^gemini-[a-z0-9.\-]{1,60}$/ };
/** ¿Es un ajuste que se guarda tal cual (modelos y direcciones distinguen mayúsculas)? Los de lista cerrada se pasan a minúsculas. */
function configLibre(k) { return k === 'base_otra' || /^modelo_[a-z]{3,12}$/.test(k) || (CONFIG_PERMITIDA[k] instanceof RegExp); }
function configValida(k, v) {
  if (/^modelo_[a-z]{3,12}$/.test(k)) return PROVEEDORES_IA.indexOf(k.substring(7)) >= 0 && k !== 'modelo_gemini' && /^[A-Za-z0-9._:\/\-]{1,100}$/.test(v);
  if (k === 'base_otra') return /^https:\/\/[A-Za-z0-9._:\/\-]{4,200}$/.test(v);
  var p = CONFIG_PERMITIDA[k];
  return !!p && (p instanceof RegExp ? p.test(v) : p.indexOf(v) >= 0);
}

/** { clave: valor } de la pestaña _Config (solo claves conocidas). */
function leerConfig() {
  var hoja = buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_CONFIG);
  var cfg = {};
  if (!hoja || hoja.getLastRow() < 2) return cfg;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0]).trim(), v = String(r[1]).trim();
    if (!configLibre(k)) v = v.toLowerCase();
    if (configValida(k, v)) cfg[k] = v;
  });
  return cfg;
}

/** Claves de las IAs que el administrador pega desde la app. Se guardan en las propiedades del script (no en la hoja: no se ven en ninguna celda). */
function guardarClaveIA(d) {
  var p = String(d.proveedor || '');
  if (PROVEEDORES_IA.indexOf(p) < 0) return { ok: false, error: 'Proveedor desconocido.' };
  var clave = String(d.clave === undefined || d.clave === null ? '' : d.clave).trim();
  var props = PropertiesService.getScriptProperties();
  if (!clave) { props.deleteProperty('IA_KEY_' + p); return { ok: true, guardada: false }; }
  if (!/^\S{8,400}$/.test(clave)) return { ok: false, error: 'La clave debe tener entre 8 y 400 caracteres, sin espacios.' };
  props.setProperty('IA_KEY_' + p, clave);
  return { ok: true, guardada: true };
}

function clavesIA() {
  var props = PropertiesService.getScriptProperties(), out = {};
  PROVEEDORES_IA.forEach(function (p) { var v = props.getProperty('IA_KEY_' + p); if (v) out[p] = v; });
  return out;
}

function guardarConfig(d) {
  var k = String(d.clave || ''), v = String(d.valor === undefined || d.valor === null ? '' : d.valor).trim();
  if (!configLibre(k)) v = v.toLowerCase();
  if (configLibre(k) && v === 'auto') v = '';   // "auto" = que el sistema elija (o quitar el ajuste)
  var conocida = !!CONFIG_PERMITIDA[k] || k === 'base_otra' || (/^modelo_[a-z]{3,12}$/.test(k) && PROVEEDORES_IA.indexOf(k.substring(7)) >= 0 && k !== 'modelo_gemini');
  var vaciable = configLibre(k);                 // los ajustes libres (modelos, dirección) se pueden quitar con vacío
  if (!conocida || !((vaciable && v === '') || configValida(k, v))) return { ok: false, error: 'Ajuste no permitido.' };
  var hoja = hojaSistema(HOJA_CONFIG, COLUMNAS_CONFIG, ['clave', 'valor']);
  var enc = buscarFila(hoja, COLUMNAS_CONFIG, 0, k);
  if (enc.fila) hoja.getRange(enc.fila, 2).setValue(v); else hoja.appendRow([k, v]);
  return { ok: true, config: leerConfig() };
}

/* ---------------- Usuarios (pestaña _Usuarios: el administrador crea personas y roles aquí) ---------------- */

var COLUMNAS_USUARIOS = [['nombre', 'Nombre'], ['rol', 'Rol (tecnico, supervisor o administrador)'], ['clave', 'Clave'], ['activo', 'Activo (si/no)'], ['terceros', 'Contratista (si/no)'], ['usuario', 'Usuario (para entrar)'], ['telefono', 'Teléfono (WhatsApp)']];

/** Crea la pestaña si no existe y la deja lista. También se puede ejecutar a mano. */
function prepararUsuarios() {
  var nueva = !buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_USUARIOS);
  var hoja = hojaSistema(HOJA_USUARIOS, COLUMNAS_USUARIOS, ['nombre', 'rol', 'clave', 'activo', 'terceros', 'usuario', 'telefono']);
  if (nueva) { hoja.appendRow(['Ejemplo Técnico', 'tecnico', '', 'no', 'no', 'ejemplo', '']); return hoja; }
  // pestañas creadas con una versión anterior: se completan los encabezados de las columnas que faltan (contratista, usuario, teléfono)
  for (var i = 4; i < COLUMNAS_USUARIOS.length; i++) {
    if (String(hoja.getRange(1, i + 1).getValue()) === '') {
      hoja.getRange(1, i + 1).setValue(COLUMNAS_USUARIOS[i][1]);
      hoja.getRange(1, i + 1, 1, 1).setFontWeight('bold').setBackground('#FFC53D');
    }
  }
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
      hoja.getRange(i + 2, 3).setValue(nuevaClave());
      hechas++;
    }
  });
  return hechas;
}

/** Clave aleatoria de 20 caracteres (≈ 76 bits): se entrega dentro del enlace de cada persona. */
function nuevaClave() {
  // 10 caracteres fáciles de dictar y teclear (sin i, l, o, 0, 1): 31^10 ≈ 8 × 10^14 combinaciones. Formato xxxxx-xxxxx.
  var abc = 'abcdefghjkmnpqrstuvwxyz23456789', hex = Utilities.getUuid().replace(/-/g, ''), out = '';
  for (var i = 0; i < 10; i++) out += abc.charAt(parseInt(hex.substr(i * 2, 2), 16) % abc.length);
  return out.substring(0, 5) + '-' + out.substring(5);
}

/** Nombre comparable: sin acentos, mayúsculas ni espacios de más ("María  López" = "maria lopez"). */
function normNombre(s) { return String(s === undefined || s === null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function esAfirmativo(v) { var a = String(v === undefined || v === null ? '' : v).trim().toLowerCase(); return a === 'si' || a === 'sí' || a === 's' || a === 'true' || a === '1' || a === 'yes'; }

function rolDe(texto) {
  var r = String(texto === undefined || texto === null ? '' : texto).trim().toLowerCase();
  return r.indexOf('adm') === 0 ? 'admin' : r.indexOf('sup') === 0 ? 'supervisor' : 'tecnico'; // lo desconocido → el menor privilegio
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('ELI-LUMINARIA')
      .addItem('Limpiar pestañas obsoletas', 'limpiarPestanasObsoletas')
      .addItem('Quitar columnas que ya no se usan', 'actualizarTodasLasColumnas')
      .addItem('Reiniciar TODO desde cero (borra los datos)', 'reiniciarDesdeCero')
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
  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < datos.length; i++) {
    var r = datos[i];
    if (String(r[2]).trim() !== clave) continue;
    if (usuarioInactivo(r[3])) return null;
    var nombre = String(r[0]).trim();
    if (!nombre) return null;
    return { nombre: nombre, usuario: loginDe(r), rol: rolDe(r[1]), terceros: esAfirmativo(r[4]) };
  }
  return null;
}

/** Personas activas con teléfono, para que quien las necesite les escriba por WhatsApp. Sin claves. */
function contactosUsuarios() {
  return listarUsuarios().filter(function (u) { return u.activo && u.telefono; })
    .map(function (u) { return { nombre: u.nombre, usuario: u.usuario, rol: u.rol, telefono: u.telefono }; });
}

/** Con qué se entra: la columna Usuario; si está vacía (cuentas antiguas), el nombre. */
function loginDe(r) { return String(r[5] === undefined || r[5] === null ? '' : r[5]).trim() || String(r[0]).trim(); }

/** Ingreso con usuario y clave: el usuario es el nombre (sin distinguir mayúsculas, acentos ni espacios de más). null si no coincide. */
function ingresarUsuario(usuario, clave) {
  var u = buscarUsuario(clave);
  return u && normNombre(u.usuario) === normNombre(usuario) ? u : null;
}

/** ¿Es una pestaña de proyecto (diseño actual, no archivada ni del sistema)? */
function esPestanaProyecto(h) {
  var n = h.getName();
  if (n.charAt(0) === '_' || / \((anterior|eliminado)( \d+)?\)$/.test(n)) return false;
  return h.getLastRow() >= 1 && h.getRange(1, 1).getValue() === COLUMNAS[0][1];
}

/** Nombre de pestaña válido para un proyecto ("" si no queda nada). */
function nombreLimpio(nombre) {
  var limpio = String(nombre === undefined || nombre === null ? '' : nombre).replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 90);
  return limpio.replace(/^_+/, '').trim();
}

var COLUMNAS_PROYECTOS = [['id', 'ID'], ['nombre', 'Nombre'], ['cliente', 'Cliente / municipio'], ['notas', 'Notas'], ['activo', 'Activo']];
function minusculas(v) { return String(v === undefined || v === null ? '' : v).trim().toLowerCase(); }
function quitarFila(p) { return { id: p.id, nombre: p.nombre, cliente: p.cliente, notas: p.notas, activo: p.activo }; }

/** La pestaña _Proyectos (datos de cada proyecto: id, nombre, cliente, notas y si está activo). Se crea sola. */
function hojaProyectos() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var h = buscarHoja(libro, HOJA_PROYECTOS);
  if (!h) {
    h = libro.insertSheet(HOJA_PROYECTOS);
    h.appendRow(COLUMNAS_PROYECTOS.map(function (c) { return c[1]; }));
    h.setFrozenRows(1);
    h.getRange(1, 1, 1, COLUMNAS_PROYECTOS.length).setFontWeight('bold').setBackground('#FFC53D');
  }
  return h;
}

/**
 * Los proyectos: uno por cada pestaña de proyecto. Cada pestaña tiene su fila en _Proyectos (se crea sola si falta y se quita si la pestaña ya no existe).
 * Devuelve [{ id, nombre, cliente, notas, activo, fila }] en el orden de las pestañas.
 */
function proyectosInfo() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var h = hojaProyectos();
  var filas = h.getLastRow() >= 2 ? h.getRange(2, 1, h.getLastRow() - 1, 5).getValues() : [];
  var tabs = [];
  libro.getSheets().forEach(function (x) { if (esPestanaProyecto(x) && tabs.length < 100) tabs.push(x.getName()); });
  var conTab = {};
  tabs.forEach(function (n) { conTab[minusculas(n)] = true; });
  for (var i = filas.length - 1; i >= 0; i--) {                       // filas sin pestaña: se quitan
    if (!conTab[minusculas(filas[i][1])]) { h.deleteRow(i + 2); filas.splice(i, 1); }
  }
  var hay = {};
  filas.forEach(function (r) { hay[minusculas(r[1])] = true; });
  var nuevas = tabs.filter(function (n) { return !hay[minusculas(n)]; }).map(function (n) { return [nuevoIdProyecto(), n, '', '', 'si']; });
  if (nuevas.length) { h.getRange(filas.length + 2, 1, nuevas.length, 5).setValues(nuevas); filas = filas.concat(nuevas); }
  var porNombre = {};
  filas.forEach(function (r, i) {
    porNombre[minusculas(r[1])] = { id: String(r[0]), nombre: String(r[1]), cliente: String(r[2] === undefined ? '' : r[2]), notas: String(r[3] === undefined ? '' : r[3]), activo: !usuarioInactivo(r[4]), fila: i + 2 };
  });
  return tabs.map(function (n) { return porNombre[minusculas(n)]; });
}

function nuevoIdProyecto() { return 'p' + Utilities.getUuid().replace(/-/g, '').substring(0, 10); }
function proyectoPorId(id) {   // ligero (se usa en cada envío): solo lee _Proyectos, sin recorrer las pestañas
  var h = buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_PROYECTOS);
  if (!h || h.getLastRow() < 2) return null;
  var filas = h.getRange(2, 1, h.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < filas.length; i++) if (String(filas[i][0]) === String(id)) return { id: String(filas[i][0]), nombre: String(filas[i][1]) };
  return null;
}
function buscarProyecto(d) {
  var todos = proyectosInfo(), nombre = minusculas(d.nombreAnterior || d.nombre);
  for (var i = 0; i < todos.length; i++) if ((d.id && todos[i].id === String(d.id)) || (!d.id && nombre && minusculas(todos[i].nombre) === nombre)) return todos[i];
  return null;
}
function agregarFilaProyecto(nombre, cliente) {
  var h = buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_PROYECTOS);
  if (!h) return;                                                     // la pestaña se crea al listar los proyectos; ahí cada pestaña recibe su fila
  var filas = h.getLastRow() >= 2 ? h.getRange(2, 1, h.getLastRow() - 1, 5).getValues() : [];
  for (var i = 0; i < filas.length; i++) if (minusculas(filas[i][1]) === minusculas(nombre)) return;
  h.appendRow([nuevoIdProyecto(), nombre, String(cliente === undefined || cliente === null ? '' : cliente).substring(0, 120), '', 'si']);
}

/** Cambia nombre, cliente y notas de un proyecto (el nombre cambia la pestaña: nadie crea un proyecto nuevo). */
function guardarProyecto(d) {
  var p = buscarProyecto({ id: d.id, nombre: d.nombreAnterior });
  if (!p) return { ok: false, error: 'No se encontró el proyecto.' };
  var nombre = nombreLimpio(d.nombre);
  if (!nombre) return { ok: false, error: 'Escribe un nombre para el proyecto.' };
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  if (minusculas(nombre) !== minusculas(p.nombre)) {
    if (buscarHoja(libro, nombre)) return { ok: false, error: 'Ya existe un proyecto con ese nombre.' };
    buscarHoja(libro, p.nombre).setName(nombre);
  } else if (nombre !== p.nombre) buscarHoja(libro, p.nombre).setName(nombre);   // solo cambian mayúsculas
  var h = hojaProyectos();
  h.getRange(p.fila, 2, 1, 3).setValues([[nombre, textoSeguro(String(d.cliente === undefined || d.cliente === null ? '' : d.cliente).substring(0, 120)), textoSeguro(String(d.notas === undefined || d.notas === null ? '' : d.notas).substring(0, 500))]]);
  return { ok: true, proyectos: proyectosInfo().map(quitarFila) };
}

/** Activa o desactiva un proyecto (un proyecto desactivado no se muestra a nadie; sus datos se conservan). */
function activarProyecto(d) {
  var p = buscarProyecto(d);
  if (!p) return { ok: false, error: 'No se encontró el proyecto.' };
  hojaProyectos().getRange(p.fila, 5).setValue(d.activo === false ? 'no' : 'si');
  return { ok: true, proyectos: proyectosInfo().map(quitarFila) };
}

/**
 * Elimina un proyecto para siempre: su pestaña (y las archivadas "(anterior)"/"(eliminado)"), su fila de _Proyectos y sus fotos de Drive.
 * Las fotos se borran de a 400 por llamada; si quedan, el resultado lo dice (se repite la acción).
 */
function eliminarProyecto(d) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var p = buscarProyecto(d);
  var nombre = p ? p.nombre : String(d.nombre === undefined || d.nombre === null ? '' : d.nombre).trim();
  if (!p && !nombre && d.id) return { ok: true, eliminado: false };    // ya no existía
  if (!nombre || nombre.charAt(0) === '_') return { ok: false, error: 'Falta el nombre del proyecto.' };
  var principal = buscarHoja(libro, nombre);
  if (principal && !esPestanaProyecto(principal)) return { ok: false, error: 'Esa pestaña no es un proyecto.' };
  var base = minusculas(nombre);
  var hojas = libro.getSheets().filter(function (h) {
    var n = h.getName();
    return minusculas(n) === base || new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\((anterior|eliminado)( \\d+)?\\)$', 'i').test(n);
  });
  if (!hojas.length && !p) return { ok: true, eliminado: false };
  var fotos = 0, restantes = 0;
  var it = DriveApp.getFoldersByName(CARPETA_FOTOS);
  if (it.hasNext()) {
    var carpeta = it.next();
    hojas.forEach(function (h) {
      if (h.getLastRow() < 2) return;
      h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().forEach(function (r) {
        var u = String(r[0]).trim();
        if (!u) return;
        if (fotos >= 400) { restantes++; return; }
        var f = carpeta.getFilesByName(u + '.jpg');
        while (f.hasNext()) { f.next().setTrashed(true); fotos++; }
      });
    });
  }
  if (restantes) return { ok: true, eliminado: false, fotosRestantes: restantes, error: 'Quedan ' + restantes + ' fotos por borrar: repite la eliminación.' };
  hojaProyectos();                                                    // garantiza que el libro conserve al menos una pestaña
  hojas.forEach(function (h) { libro.deleteSheet(h); });
  if (p) hojaProyectos().deleteRow(p.fila);
  return { ok: true, eliminado: true, hojas: hojas.length, fotos: fotos, proyectos: proyectosInfo().map(quitarFila) };
}

/** Todas las personas (con su clave: solo la ve el administrador a través del proxy). */
function listarUsuarios() {
  var hoja = buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_USUARIOS);
  if (!hoja || hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { nombre: String(r[0]).trim(), usuario: loginDe(r), rol: rolDe(r[1]), clave: String(r[2]).trim(), activo: !usuarioInactivo(r[3]), terceros: esAfirmativo(r[4]), telefono: String(r[6] === undefined ? '' : r[6]).trim() }; });
}

/** Elimina una cuenta por su usuario. Los registros que hizo se conservan en la hoja (llevan su nombre y usuario). No puedes eliminarte a ti mismo. */
function borrarUsuario(d) {
  var login = String(d.usuario === undefined || d.usuario === null ? '' : d.usuario).trim();
  if (!login) return { ok: false, error: 'Falta el usuario a eliminar.' };
  if (normNombre(d.por) === normNombre(login)) return { ok: false, error: 'No puedes eliminarte a ti mismo.' };
  var hoja = buscarHoja(SpreadsheetApp.getActiveSpreadsheet(), HOJA_USUARIOS);
  if (!hoja || hoja.getLastRow() < 2) return { ok: false, error: 'No existe ese usuario.' };
  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < datos.length; i++) {
    if (String(datos[i][0]).trim() && normNombre(loginDe(datos[i])) === normNombre(login)) {
      hoja.deleteRow(i + 2);
      return { ok: true, eliminado: loginDe(datos[i]) };
    }
  }
  return { ok: false, error: 'No existe ese usuario.' };
}

/**
 * Crea o edita una persona por su nombre. { nombre, rol, activo, claveNueva:true, por }.
 * Reglas: el administrador no puede quitarse a sí mismo el rol ni darse de baja (se quedaría sin acceso), y los nombres no se repiten.
 */
function guardarUsuario(d) {
  var nombre = String(d.nombre === undefined || d.nombre === null ? '' : d.nombre).trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length > 60) return { ok: false, error: 'El nombre es obligatorio (máximo 60 caracteres).' };
  if (/^[=+\-@_]/.test(nombre)) return { ok: false, error: 'El nombre no puede empezar por = + - @ _' };
  var login = String(d.usuario === undefined || d.usuario === null || d.usuario === '' ? nombre : d.usuario).trim().replace(/\s+/g, ' ');
  if (login.length < 2 || login.length > 40 || /^[=+\-@_]/.test(login)) return { ok: false, error: 'El usuario debe tener entre 2 y 40 caracteres y no puede empezar por = + - @ _' };
  var rol = rolDe(d.rol);
  var activo = d.activo !== false;
  var terceros = d.terceros === true;
  var propio = normNombre(d.por) === normNombre(login);
  if (propio && (!activo || rol !== 'admin')) return { ok: false, error: 'No puedes quitarte el rol de administrador ni darte de baja a ti mismo.' };

  var manual = d.clave === undefined || d.clave === null || d.clave === '' ? '' : String(d.clave);
  if (manual && !/^\S{8,64}$/.test(manual)) return { ok: false, error: 'La clave debe tener entre 8 y 64 caracteres, sin espacios.' };
  if (manual && (normNombre(manual) === normNombre(login) || normNombre(manual) === normNombre(nombre))) return { ok: false, error: 'La clave no puede ser igual al usuario ni al nombre.' };

  var hoja = prepararUsuarios();
  var n = hoja.getLastRow();
  var datos = n > 1 ? hoja.getRange(2, 1, n - 1, 7).getValues() : [];
  var fila = 0;
  datos.forEach(function (r, i) { if (!fila && normNombre(loginDe(r)) === normNombre(login)) fila = i + 2; });
  // la fila de ejemplo que crea el sistema (inactiva y sin clave) se reutiliza en vez de dejarla ahí
  if (!fila) datos.forEach(function (r, i) { if (!fila && String(r[0]).trim() === 'Ejemplo Técnico' && !String(r[2]).trim()) fila = i + 2; });

  var otras = datos.filter(function (r, i) { return i + 2 !== fila; }).map(function (r) { return String(r[2]).trim(); });
  var clave = fila ? String(hoja.getRange(fila, 3).getValue()).trim() : '';
  if (manual) {
    if (otras.indexOf(manual) >= 0) return { ok: false, error: 'Esa clave ya la usa otra persona. Elige otra.' };
    clave = manual;
  } else if (!clave || d.claveNueva === true) {
    do { clave = nuevaClave(); } while (otras.indexOf(clave) >= 0);
  }
  // teléfono (WhatsApp): si no se envía, se conserva el que ya tenía
  var telefono = fila ? String(hoja.getRange(fila, 7).getValue()).trim() : '';
  if (d.telefono !== undefined && d.telefono !== null) telefono = String(d.telefono).trim();
  var valores = [textoSeguro(nombre), rol, clave, activo ? 'si' : 'no', terceros ? 'si' : 'no', textoSeguro(login), telefono ? textoSeguro(telefono) : ''];
  if (fila) hoja.getRange(fila, 1, 1, 7).setValues([valores]);
  else { hoja.appendRow(valores); }
  return { ok: true, usuario: { nombre: nombre, usuario: login, rol: rol, clave: clave, activo: activo, terceros: terceros, telefono: telefono } };
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
  var iLat = col('latitud'), iLng = col('longitud'), iTec = col('tecnico'), iFab = col('fabricante'), iTecn = col('tecnologia'), iEli = col('eliminada');
  libro.getSheets().forEach(function (h) {
    if (h.getName().charAt(0) === '_' || h.getLastRow() < 2 || luminarias.length >= 5000) return;
    prepararLectura(h);
    leerFilas(h).forEach(function (r) {
      if (luminarias.length >= 5000 || !r[0] || String(r[iEli]).toUpperCase().indexOf('S') === 0) return;
      var q = calidad[r[iTec]] = calidad[r[iTec]] || { total: 0, conAlertas: 0, codigos: {} };
      q.total++;
      if (r[iAl]) { q.conAlertas++; String(r[iAl]).split(', ').forEach(function (c) { q.codigos[c] = (q.codigos[c] || 0) + 1; }); }
      if (typeof r[iLat] === 'number' && typeof r[iLng] === 'number') luminarias.push({ lat: r[iLat], lng: r[iLng], tec: r[iTec], fab: r[iFab], tecnologia: r[iTecn] });
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
    L.circleMarker([l.lat, l.lng], {radius:3, color:'#475569', weight:1, fillColor:'#94a3b8', fillOpacity:.8}).bindTooltip(esc((l.fab || 'Luminaria') + (l.tec ? ' · ' + l.tec : ''))).addTo(capaL);
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
