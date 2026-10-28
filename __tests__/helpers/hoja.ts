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
  hideColumns(_col: number) { /* sin efecto en la simulación */ }
  deleteColumn(c: number) {
    this.filas.forEach((f) => f.splice(c - 1, 1)); this.maxColumnas -= 1;
    const nf: Record<number, string> = {}; for (const [k, v] of Object.entries(this.formatos)) { const i = Number(k); if (i !== c) nf[i > c ? i - 1 : i] = v; } this.formatos = nf;
  }
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

/** `carpetaFotos`: usa la carpeta de fotos por ID (una por proyecto) como en producción; por defecto las pruebas antiguas usan la carpeta suelta.
 *  `envioCrea`: las pruebas antiguas crean proyectos con solo enviar datos (el script de producción NO lo hace: CREAR_AL_ENVIAR = false). */
export function crearServidor(rutaScript?: string, opciones: { envioCrea?: boolean; carpetaFotos?: boolean } = {}) {
  const hojas: Hoja[] = [];
  const fotosGuardadas: string[] = [];                            // archivos que el script mandó a Drive
  // Drive simulado por ID (la carpeta "fotos" de producción y lo que cuelga de ella)
  interface Arch { id: string; nombre: string; papelera: boolean; padre?: Carp }
  interface Carp { id: string; nombre: string; papelera: boolean; carpetas: Carp[]; archivos: Arch[] }
  const raices = new Map<string, Carp>(); const todosArchivos = new Map<string, Arch>(); let seq = 0;
  const iter = <T>(l: T[]) => { let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; };
  const archivoApi = (a: Arch): any => ({ getParents: () => iter(a.padre ? [carpetaArbol(a.padre)] : []), moveTo: (destino: any) => { if (a.padre) a.padre.archivos = a.padre.archivos.filter((x) => x !== a); const d: Carp = destino._c; d.archivos.push(a); a.padre = d; }, getId: () => a.id, getName: () => a.nombre, setName: (n: string) => { a.nombre = n; }, setTrashed: (v: boolean) => { a.papelera = v; }, getUrl: () => 'https://drive.google.com/file/d/' + a.id + '/view' });
  const carpetaArbol = (c: Carp): any => ({
    _c: c, getId: () => c.id, getName: () => c.nombre, setName: (n: string) => { c.nombre = n; }, setTrashed: (v: boolean) => { c.papelera = v; },
    getFoldersByName: (n: string) => iter(c.carpetas.filter((x) => !x.papelera && x.nombre === n).map(carpetaArbol)),
    getFolders: () => iter(c.carpetas.filter((x) => !x.papelera).map(carpetaArbol)),
    getFiles: () => iter(c.archivos.filter((x) => !x.papelera).map(archivoApi)),
    createFolder: (n: string) => { const h: Carp = { id: 'c' + ++seq, nombre: n, papelera: false, carpetas: [], archivos: [] }; c.carpetas.push(h); return carpetaArbol(h); },
    createFile: (b: { nombre: string }) => { const a: Arch = { id: 'archivo' + String(++seq).padStart(25, '0'), nombre: b.nombre, papelera: false, padre: c }; c.archivos.push(a); todosArchivos.set(a.id, a); fotosGuardadas.push(b.nombre); return archivoApi(a); },
  });
  const carpetaApi = (_c: any) => ({ getFilesByName: () => ({ hasNext: () => false }), createFile: (b: { nombre: string }) => { fotosGuardadas.push(b.nombre); return { getUrl: () => 'https://drive.test/' + b.nombre }; } });
  const carpetas: { nombre: string; papelera: boolean }[] = [];   // carpetas de Drive simuladas (las de fotos)
  const libro = { getSheets: () => hojas, insertSheet: (n: string) => { const h = new Hoja(n); hojas.push(h); return h; }, deleteSheet: (h: Hoja) => { hojas.splice(hojas.indexOf(h), 1); } };
  let fuente = fs.readFileSync(rutaScript ?? path.join(__dirname, '../../server/google-apps-script.gs'), 'utf8');
  if (!opciones.carpetaFotos) fuente = fuente.replace(/var CARPETA_FOTOS_ID = '[^']*';/, "var CARPETA_FOTOS_ID = '';");
  if ((opciones.envioCrea ?? true) === true) fuente = fuente.replace('var CREAR_AL_ENVIAR = false;', 'var CREAR_AL_ENVIAR = true;');
  const html = { createHtmlOutput: (h: string) => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; } }) };
  const propiedades = new Map<string, string>();                    // propiedades del script (donde se guardan las claves de las IAs)
  const gs = new Function('SpreadsheetApp', 'LockService', 'ContentService', 'DriveApp', 'Utilities', 'HtmlService', 'PropertiesService',
    fuente + '\n;return { doPost, doGet, datosEquipo, calcularAlertas, auditarTodo, migrarFotos, generarClavesFaltantes, prepararUsuarios, buscarUsuario, pestanasObsoletas, eliminarPestanas, reiniciarDatos };')(
    { getActiveSpreadsheet: () => libro },
    { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    { createTextOutput: (t: string) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    {
      getFoldersByName: (n: string) => { const l = carpetas.filter((c) => c.nombre === n); let i = 0; return { hasNext: () => i < l.length, next: () => { const c = l[i++]; return { setTrashed: () => { c.papelera = true; }, ...carpetaApi(c) }; } }; },
      createFolder: (n: string) => { const c = { nombre: n, papelera: false }; carpetas.push(c); return carpetaApi(c); },
      getFolderById: (id: string) => { let r = raices.get(id); if (!r) { r = { id, nombre: 'fotos', papelera: false, carpetas: [], archivos: [] }; raices.set(id, r); } return carpetaArbol(r); },
      getFileById: (id: string) => { const a = todosArchivos.get(id); if (!a) throw new Error('File not found'); return archivoApi(a); },
    },
    { getUuid: () => crypto.randomUUID(), newBlob: (_d: any, _t: string, nombre: string) => ({ nombre }), base64Decode: (x: string) => x }, html,
    { getScriptProperties: () => ({ setProperty: (k: string, v: string) => { propiedades.set(k, v); }, getProperty: (k: string) => propiedades.get(k) ?? null, deleteProperty: (k: string) => { propiedades.delete(k); } }) },
  );
  const llamar = async (_url: string, init: any) => {
    const salida = gs.doPost({ postData: { contents: init.body } });
    return new Response(salida.t, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const hoja = (nombre: string) => hojas.find((h) => h.nombre === nombre);
  const arbol = () => [...raices.values()];
  return { hojas, llamar, hoja, gs, carpetas, fotosGuardadas, propiedades, arbol, archivos: todosArchivos };
}
