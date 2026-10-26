/**
 * Simulador de hoja de Google + servidor = el script REAL de Apps Script. Sin dependencias de jest ni de SQLite,
 * para usarlo tanto en las pruebas unitarias como en las pruebas de navegador (web/e2e).
 */
import * as fs from 'fs';
import * as path from 'path';

/** Hoja simulada (imita la conversión de Sheets: "150" → 150 salvo en columnas con formato texto). */
export class Hoja {
  filas: any[][] = [];
  maxColumnas = 26; // como una pestaña nueva de Google Sheets; appendRow la amplía
  formatos: Record<number, string> = {};
  formulas: Record<string, string> = {};
  constructor(public nombre: string) {}
  getName() { return this.nombre; }
  deleteRow(n: number) { this.filas.splice(n - 1, 1); }
  setName(n: string) { this.nombre = n; }
  getLastRow() { return this.filas.length; }
  getMaxRows() { return 1000; }
  getMaxColumns() { return this.maxColumnas; }
  insertColumnsAfter(_pos: number, n: number) { this.maxColumnas += n; }
  setFrozenRows() {}
  coac(x: any, col: number, cabecera = false) {
    if (typeof x === 'string' && /^'[=+@]/.test(x)) return x.slice(1); // el apóstrofo fuerza texto y no se guarda
    return typeof x === 'string' && !cabecera && this.formatos[col] !== '@' && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x;
  }
  appendRow(v: any[]) { this.maxColumnas = Math.max(this.maxColumnas, v.length); const cab = this.filas.length === 0; this.filas.push(v.map((x, i) => this.coac(x, i + 1, cab))); }
  getRange(r: number, c: number, nr = 1, nc = 1) {
    const h = this;
    if (c - 1 + nc > h.maxColumnas) throw new Error('The coordinates of the range are outside the dimensions of the sheet.'); // fiel a Sheets
    const api: any = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => h.filas[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (vals: any[][]) => vals.forEach((fila, i) => { h.filas[r - 1 + i] ??= []; fila.forEach((x, j) => { h.filas[r - 1 + i][c - 1 + j] = h.coac(x, c + j); }); }),
      getValue: () => h.filas[r - 1]?.[c - 1] ?? '',
      setValue: (x: any) => { h.filas[r - 1] ??= []; h.filas[r - 1][c - 1] = x; },
      setFormulaR1C1: (f: string) => { h.formulas[`${r},${c}`] = f; },
      setFontWeight: () => api, setBackground: () => api,
      setNumberFormat: (f: string) => { for (let j = 0; j < nc; j++) h.formatos[c + j] = f; return api; },
    };
    return api;
  }
}

export function crearServidor(rutaScript?: string) {
  const hojas: Hoja[] = [];
  const fotosGuardadas: string[] = [];                            // archivos que el script mandó a Drive
  const carpetaApi = (_c: any) => ({ getFilesByName: () => ({ hasNext: () => false }), createFile: (b: { nombre: string }) => { fotosGuardadas.push(b.nombre); return { getUrl: () => 'https://drive.test/' + b.nombre }; } });
  const carpetas: { nombre: string; papelera: boolean }[] = [];   // carpetas de Drive simuladas (las de fotos)
  const libro = { getSheets: () => hojas, insertSheet: (n: string) => { const h = new Hoja(n); hojas.push(h); return h; }, deleteSheet: (h: Hoja) => { hojas.splice(hojas.indexOf(h), 1); } };
  const fuente = fs.readFileSync(rutaScript ?? path.join(__dirname, '../../server/google-apps-script.gs'), 'utf8');
  const html = { createHtmlOutput: (h: string) => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; } }) };
  const propiedades = new Map<string, string>();                    // propiedades del script (donde se guardan las claves de las IAs)
  const gs = new Function('SpreadsheetApp', 'LockService', 'ContentService', 'DriveApp', 'Utilities', 'HtmlService', 'PropertiesService',
    fuente + '\n;return { doPost, doGet, datosEquipo, calcularAlertas, auditarTodo, generarClavesFaltantes, prepararUsuarios, buscarUsuario, pestanasObsoletas, eliminarPestanas, reiniciarDatos };')(
    { getActiveSpreadsheet: () => libro },
    { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    { createTextOutput: (t: string) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    {
      getFoldersByName: (n: string) => { const l = carpetas.filter((c) => c.nombre === n); let i = 0; return { hasNext: () => i < l.length, next: () => { const c = l[i++]; return { setTrashed: () => { c.papelera = true; }, ...carpetaApi(c) }; } }; },
      createFolder: (n: string) => { const c = { nombre: n, papelera: false }; carpetas.push(c); return carpetaApi(c); },
    },
    { getUuid: () => crypto.randomUUID(), newBlob: (_d: any, _t: string, nombre: string) => ({ nombre }), base64Decode: (x: string) => x }, html,
    { getScriptProperties: () => ({ setProperty: (k: string, v: string) => { propiedades.set(k, v); }, getProperty: (k: string) => propiedades.get(k) ?? null, deleteProperty: (k: string) => { propiedades.delete(k); } }) },
  );
  const llamar = async (_url: string, init: any) => {
    const salida = gs.doPost({ postData: { contents: init.body } });
    return new Response(salida.t, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const hoja = (nombre: string) => hojas.find((h) => h.nombre === nombre);
  return { hojas, llamar, hoja, gs, carpetas, fotosGuardadas, propiedades };
}
