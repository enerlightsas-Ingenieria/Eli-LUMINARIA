/**
 * Prueba la capa de datos REAL (src/services/db.ts) contra SQLite de Node (node:sqlite),
 * incluida la migración desde el prototipo v0 (sin proyectos ni uuid).
 */
import { DatabaseSync } from 'node:sqlite';

let mockMotor: DatabaseSync;
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    execAsync: async (sql: string) => { mockMotor.exec(sql); },
    getFirstAsync: async (sql: string, p: any[] = []) => mockMotor.prepare(sql).get(...p),
    getAllAsync: async (sql: string, p: any[] = []) => mockMotor.prepare(sql).all(...p),
    runAsync: async (sql: string, p: any[] = []) => {
      const r = mockMotor.prepare(sql).run(...p);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
  }),
}));

const cargarDb = () => { let m: typeof import('../src/services/db'); jest.isolateModules(() => { m = require('../src/services/db'); }); return m!; };
const borrador = (proyectoId: number, o: any = {}) => ({
  ...require('../src/types').caracteristicasVacias(), uuid: require('crypto').randomUUID(), proyectoId,
  creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '', fotos: ['file:///a.jpg'], latitud: 4.7, longitud: -74.07,
  precisionM: 6, direccion: 'Cra 7', codigo: 'P-1', confianza: 'alta', marca: 'Philips', tecnologia: 'LED', ...o,
});

describe('db', () => {
  beforeEach(() => { mockMotor = new DatabaseSync(':memory:'); });

  it('instalación nueva: crea el proyecto "General" y guarda/lee/actualiza/borra', async () => {
    const db = cargarDb();
    const ps = await db.listarProyectos();
    expect(ps).toHaveLength(1); expect(ps[0].nombre).toBe('General');

    const id = await db.guardarLuminaria(borrador(ps[0].id));
    let ls = await db.listarLuminarias(ps[0].id);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ marca: 'Philips', fotos: ['file:///a.jpg'], sincronizado: false, latitud: 4.7 });

    await db.marcarSincronizadas([ls[0].uuid]);
    expect(await db.pendientesDeSync(ps[0].id)).toHaveLength(0);

    await db.guardarLuminaria({ ...ls[0], id, marca: 'Schréder' }); // editar reabre pendiente
    ls = await db.listarLuminarias(ps[0].id);
    expect(ls[0].marca).toBe('Schréder'); expect(ls[0].sincronizado).toBe(false);
    expect(await db.pendientesDeSync(ps[0].id)).toHaveLength(1);

    await db.borrarLuminaria(ls[0]);
    expect(await db.listarLuminarias(ps[0].id)).toHaveLength(0);
  });

  it('proyectos: separa datos, cuenta y borra en cascada devolviendo las fotos', async () => {
    const db = cargarDb();
    const [general] = await db.listarProyectos();
    const otro = await db.crearProyecto('Barrio Norte', 'Alcaldía');
    await db.guardarLuminaria(borrador(general.id));
    await db.guardarLuminaria(borrador(otro, { fotos: ['file:///x.jpg', 'file:///y.jpg'] }));
    const ps = await db.listarProyectos();
    expect(ps.map((p) => p.cantidad)).toEqual([1, 1]);
    expect(await db.listarLuminarias(general.id)).toHaveLength(1);
    expect(await db.borrarProyecto(otro)).toEqual(['file:///x.jpg', 'file:///y.jpg']);
    expect(await db.listarLuminarias(otro)).toHaveLength(0);
    expect(await db.listarLuminarias(general.id)).toHaveLength(1);
  });

  it('kv guarda y sobrescribe', async () => {
    const db = cargarDb();
    await db.guardarKv('a', '1'); await db.guardarKv('a', '2');
    expect(await db.leerKv('a')).toBe('2'); expect(await db.leerKv('zz')).toBeNull();
  });

  it('migra el prototipo v0 (foto única, sin uuid) sin perder datos', async () => {
    mockMotor.exec(`CREATE TABLE luminarias (id INTEGER PRIMARY KEY AUTOINCREMENT, creadoEn TEXT NOT NULL, fotoUri TEXT NOT NULL,
      latitud REAL, longitud REAL, precisionM REAL, direccion TEXT, confianza TEXT, marca TEXT, fabricante TEXT, modelo TEXT,
      tipoLuminaria TEXT, tecnologia TEXT, potenciaW TEXT, tensionV TEXT, fotocelda TEXT, pinesFotocelda TEXT,
      temperaturaColorK TEXT, flujoLuminosoLm TEXT, ip TEXT, montaje TEXT, estado TEXT, observaciones TEXT);
      INSERT INTO luminarias (creadoEn,fotoUri,latitud,longitud,marca,potenciaW,pinesFotocelda) VALUES ('2025-12-01','file:///v0.jpg',4.5,-74.1,'Lumenpulse','150','7');`);
    const db = cargarDb();
    const [p] = await db.listarProyectos();
    const ls = await db.listarLuminarias(p.id);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ marca: 'Lumenpulse', potenciaW: '150', pinesFotocelda: '7', fotos: ['file:///v0.jpg'], latitud: 4.5, longitud: -74.1 });
    expect(ls[0].uuid).toHaveLength(36);
    expect(mockMotor.prepare("SELECT name FROM sqlite_master WHERE name='luminarias_v0'").get()).toBeUndefined();
  });
});
