import { beforeEach, describe, expect, it } from 'vitest';
import { normalizarRemota } from '@compartido/lib/fusion';
import { caracteristicasVacias, Luminaria } from '@compartido/types';
import * as db from '../src/servicios/almacen';

const borrador = (proyectoId: number, o: any = {}) => ({
  ...caracteristicasVacias(), uuid: crypto.randomUUID(), proyectoId, creadoEn: '2026-01-01T00:00:00Z', actualizadoEn: '', fotos: ['f1'],
  latitud: 4.7, longitud: -74.07, precisionM: 6, direccion: 'Cra 7', codigo: 'P-1', tecnico: 'Ana', confianza: 'alta' as const,
  origen: 'camara' as const, ubicacionSimulada: false, jornadaId: '', fabricante: 'Philips', tecnologia: 'LED', ...o,
});

beforeEach(async () => {
  await db.reiniciarConexion();
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('eli-luminaria'); r.onsuccess = () => res(); r.onerror = () => res(); r.onblocked = () => res(); });
});

describe('borrar todo lo local', () => {
  it('deja el dispositivo como nuevo: sin registros ni ajustes; vuelve a crear solo el proyecto General', async () => {
    const ps = await db.listarProyectos();
    await db.crearProyecto('Barrio A');
    await db.guardarLuminaria(borrador(ps[0].id));
    localStorage.setItem('eli.ajustes.v1', JSON.stringify({ apiKey: 'secreta' }));
    expect((await db.listarProyectos()).length).toBe(2);

    await db.borrarTodoLocal();

    expect(localStorage.getItem('eli.ajustes.v1')).toBeNull();
    const nuevos = await db.listarProyectos();
    expect(nuevos.map((p) => p.nombre)).toEqual(['General']);
    expect(await db.listarLuminarias(nuevos[0].id)).toHaveLength(0);
  });
});

describe('almacén web (IndexedDB)', () => {
  it('primera ejecución: crea el proyecto "General"; guardar, leer, actualizar y borrar', async () => {
    const ps = await db.listarProyectos();
    expect(ps).toHaveLength(1); expect(ps[0].nombre).toBe('General');

    const id = await db.guardarLuminaria(borrador(ps[0].id));
    let ls = await db.listarLuminarias(ps[0].id);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ fabricante: 'Philips', fotos: ['f1'], sincronizado: false, latitud: 4.7, id });

    await db.marcarSincronizadas([{ uuid: ls[0].uuid, actualizadoEn: ls[0].actualizadoEn }]);
    expect(await db.pendientesDeSync(ps[0].id)).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 2));                                   // distinto actualizadoEn
    await db.guardarLuminaria({ ...ls[0], id, fabricante: 'Schréder' });               // editar reabre pendiente
    ls = await db.listarLuminarias(ps[0].id);
    expect(ls[0].fabricante).toBe('Schréder'); expect(ls[0].sincronizado).toBe(false);
    expect(ls).toHaveLength(1);                                                   // actualiza, no duplica

    await db.borrarLuminaria(ls[0]);
    expect(await db.listarLuminarias(ps[0].id)).toHaveLength(0);
    expect(await db.borradasPendientes(ps[0].id)).toEqual([ls[0].uuid]);
    await db.limpiarBorradas([ls[0].uuid]);
    expect(await db.borradasPendientes(ps[0].id)).toEqual([]);
  });

  it('una edición hecha mientras se subía NO se marca como enviada', async () => {
    const [p] = await db.listarProyectos();
    const id = await db.guardarLuminaria(borrador(p.id));
    const [antes] = await db.listarLuminarias(p.id);
    await new Promise((r) => setTimeout(r, 2));
    await db.guardarLuminaria({ ...antes, id, fabricante: 'Editada durante el envío' });
    await db.marcarSincronizadas([{ uuid: antes.uuid, actualizadoEn: antes.actualizadoEn }]);   // llega la confirmación del envío viejo
    expect((await db.pendientesDeSync(p.id))).toHaveLength(1);
  });

  it('proyectos: separa datos, cuenta y borra en cascada devolviendo las fotos', async () => {
    const [general] = await db.listarProyectos();
    const otro = await db.crearProyecto('Barrio Norte', 'Alcaldía');
    await db.guardarLuminaria(borrador(general.id));
    await db.guardarLuminaria(borrador(otro, { fotos: ['x', 'y'] }));
    expect((await db.listarProyectos()).map((p) => p.cantidad)).toEqual([1, 1]);
    expect((await db.borrarProyecto(otro)).sort()).toEqual(['x', 'y']);
    expect(await db.listarLuminarias(otro)).toHaveLength(0);
    expect(await db.listarLuminarias(general.id)).toHaveLength(1);
  });

  it('editar un proyecto reabre sus luminarias como pendientes (el nombre viaja al servidor)', async () => {
    const [p] = await db.listarProyectos();
    await db.guardarLuminaria(borrador(p.id));
    const [l] = await db.listarLuminarias(p.id);
    await db.marcarSincronizadas([{ uuid: l.uuid, actualizadoEn: l.actualizadoEn }]);
    await db.editarProyecto(p.id, ' Nuevo nombre ', 'Cliente', '');
    expect((await db.listarProyectos())[0]).toMatchObject({ nombre: 'Nuevo nombre', cliente: 'Cliente' });
    expect(await db.pendientesDeSync(p.id)).toHaveLength(1);
  });

  it('kv guarda y sobrescribe', async () => {
    await db.guardarKv('a', '1'); await db.guardarKv('a', '2');
    expect(await db.leerKv('a')).toBe('2'); expect(await db.leerKv('zz')).toBeNull();
  });

  it('cuenta lo hecho por un técnico en un intervalo (contador de la jornada)', async () => {
    const [p] = await db.listarProyectos();
    for (const [t, c] of [['Ana', '2026-03-10T08:00:00Z'], ['Ana', '2026-03-10T09:30:00Z'], ['Ana', '2026-03-10T12:00:00Z'], ['Beto', '2026-03-10T09:00:00Z']]) {
      await db.guardarLuminaria(borrador(p.id, { tecnico: t, creadoEn: c }));
    }
    expect(await db.contarDesde('Ana', '2026-03-10T09:00:00Z')).toBe(2);
    expect(await db.contarEntre('Ana', '2026-03-10T08:00:00Z', '2026-03-10T10:00:00Z')).toBe(2);
    expect(await db.contarDesde('Beto', '2026-03-10T00:00:00Z')).toBe(1);
  });

  it('booleanos y campos de evidencia sobreviven al guardado', async () => {
    const [p] = await db.listarProyectos();
    await db.guardarLuminaria(borrador(p.id, { ubicacionSimulada: true, origen: 'galeria', jornadaId: 'j9' }));
    expect((await db.listarLuminarias(p.id))[0]).toMatchObject({ ubicacionSimulada: true, origen: 'galeria', jornadaId: 'j9' });
  });

  describe('fusión con lo que traen los demás técnicos', () => {
    const remota = (o: any = {}) => normalizarRemota({ uuid: 'r1', fabricante: 'Remota', tecnico: 'Beto', latitud: 4.8, longitud: -74.1, creadoEn: '2026-03-01T10:00:00Z', ...o })!;

    it('inserta lo nuevo (ya sincronizado) y actualiza lo existente conservando sus fotos', async () => {
      const [p] = await db.listarProyectos();
      expect(await db.fusionarRemotas(p.id, [remota()])).toEqual({ nuevas: 1, actualizadas: 0, borradas: 0 });
      let [l] = await db.listarLuminarias(p.id);
      expect(l).toMatchObject({ fabricante: 'Remota', sincronizado: true, fotos: [], tecnico: 'Beto' });
      await db.guardarLuminaria({ ...l, fotos: ['mi-foto'] });                                  // el técnico agrega una foto
      await db.marcarSincronizadas([{ uuid: 'r1', actualizadoEn: (await db.listarLuminarias(p.id))[0].actualizadoEn }]);
      expect(await db.fusionarRemotas(p.id, [remota({ fabricante: 'Editada por Beto' })])).toMatchObject({ actualizadas: 1 });
      [l] = await db.listarLuminarias(p.id);
      expect(l).toMatchObject({ fabricante: 'Editada por Beto', fotos: ['mi-foto'], sincronizado: true });
    });

    it('no pisa mis cambios pendientes; lo eliminado gana; lo que borré yo no resucita', async () => {
      const [p] = await db.listarProyectos();
      await db.fusionarRemotas(p.id, [remota()]);
      let [l] = await db.listarLuminarias(p.id);
      await db.guardarLuminaria({ ...l, fabricante: 'Mi edición' });                                 // pendiente
      expect(await db.fusionarRemotas(p.id, [remota({ fabricante: 'Otra' })])).toMatchObject({ actualizadas: 0 });
      expect((await db.listarLuminarias(p.id))[0].fabricante).toBe('Mi edición');
      expect(await db.fusionarRemotas(p.id, [remota({ eliminada: 'SÍ' })])).toMatchObject({ borradas: 1 });
      expect(await db.listarLuminarias(p.id)).toHaveLength(0);

      await db.fusionarRemotas(p.id, [remota({ uuid: 'r2' })]);
      [l] = await db.listarLuminarias(p.id);
      await db.borrarLuminaria(l);                                                              // la borro yo y aún no se envía
      expect(await db.fusionarRemotas(p.id, [remota({ uuid: 'r2' })])).toEqual({ nuevas: 0, actualizadas: 0, borradas: 0 });
      expect(await db.listarLuminarias(p.id)).toHaveLength(0);
    });
  });

  it('fotos: guardar, leer y borrar blobs', async () => {
    const id = await db.guardarFoto(new Blob(['hola'], { type: 'image/jpeg' }));
    expect(await (await db.obtenerFoto(id))!.text()).toBe('hola');
    await db.borrarFotos([id]);
    expect(await db.obtenerFoto(id)).toBeUndefined();
  });
});
