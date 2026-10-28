import { beforeEach, describe, expect, it } from 'vitest';
import { normalizarRemota } from '@compartido/lib/fusion';
import { caracteristicasVacias, Luminaria } from '@compartido/types';
import * as db from '../src/servicios/almacen';
import { recorteParaZoom } from '../src/servicios/fotos';

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

  it('editar un proyecto cambia solo sus datos locales: no reabre las luminarias como pendientes (el nombre lo renombra el administrador en el servidor)', async () => {
    const [p] = await db.listarProyectos();
    await db.guardarLuminaria(borrador(p.id));
    const [l] = await db.listarLuminarias(p.id);
    await db.marcarSincronizadas([{ uuid: l.uuid, actualizadoEn: l.actualizadoEn }]);
    await db.editarProyecto(p.id, ' Nuevo nombre ', 'Cliente', '');
    expect((await db.listarProyectos())[0]).toMatchObject({ nombre: 'Nuevo nombre', cliente: 'Cliente' });
    expect(await db.pendientesDeSync(p.id)).toHaveLength(0);
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

describe('zoom digital de la cámara', () => {
  it('el recorte es la zona central: zoom 1 = todo, zoom 2 = la mitad del ancho y del alto', () => {
    expect(recorteParaZoom(1920, 1080, 1)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    expect(recorteParaZoom(1920, 1080, 2)).toEqual({ sx: 480, sy: 270, sw: 960, sh: 540 });
    const r = recorteParaZoom(640, 480, 4);
    expect(r).toEqual({ sx: 240, sy: 180, sw: 160, sh: 120 });
    expect(r.sx + r.sw / 2).toBe(320); expect(r.sy + r.sh / 2).toBe(240);       // siempre centrado
  });
  it('un zoom menor que 1 o inválido no recorta', () => {
    expect(recorteParaZoom(100, 100, 0.5)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
    expect(recorteParaZoom(100, 100, NaN)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
  });
});

describe('conciliar proyectos con la hoja (un proyecto eliminado por el administrador desaparece aquí)', () => {
  it('quita solo lo que la hoja ya conocía y no tiene nada pendiente; lo recién creado y lo pendiente se respetan', async () => {
    const [general] = await db.listarProyectos();
    const a = await db.crearProyecto('Barrio A');           // conocido por la hoja y luego eliminado → se quita
    const b = await db.crearProyecto('Barrio B');           // nuevo, nunca visto en la hoja → se respeta
    const c = await db.crearProyecto('Barrio C');           // eliminado en la hoja pero con un registro sin enviar → se respeta
    await db.guardarLuminaria(borrador(c));
    expect(await db.conciliarProyectos(['General', 'Barrio A', 'Barrio C'])).toBe(0);   // la hoja los lista: se marcan como conocidos
    expect(await db.conciliarProyectos(['General', 'barrio b'])).toBe(1);               // A y C ya no están en la hoja; sin distinguir mayúsculas
    const quedan = (await db.listarProyectos()).map((p) => p.nombre).sort();
    expect(quedan).toEqual(['Barrio B', 'Barrio C', 'General']);
    expect(general.id).toBeTruthy(); expect(a).not.toBe(b);
  });

  it('si se quitan todos, queda un proyecto "General" para poder trabajar', async () => {
    await db.crearProyecto('Solo');
    await db.conciliarProyectos(['General', 'Solo']);
    expect(await db.conciliarProyectos(['Otro'])).toBe(2);
    expect((await db.listarProyectos()).map((p) => p.nombre)).toEqual(['General']);
  });
});

describe('reenviar una vez lo ya enviado para que lleve su miniatura', () => {
  it('marca como pendientes solo las enviadas que tienen foto propia', async () => {
    const [p] = await db.listarProyectos();
    const a = await db.guardarLuminaria(borrador(p.id, { fotos: ['f1'] }));
    const b = await db.guardarLuminaria(borrador(p.id, { fotos: [] }));          // de otra persona: sin foto local
    const c = await db.guardarLuminaria(borrador(p.id, { fotos: ['f3'] }));      // aún sin enviar
    const todas = await db.listarLuminarias(p.id);
    await db.marcarSincronizadas(todas.filter((x) => x.id !== c).map((x) => ({ uuid: x.uuid, actualizadoEn: x.actualizadoEn })));
    expect(await db.marcarParaReenviar()).toBe(1);
    const despues = await db.listarLuminarias(p.id);
    expect(despues.find((l) => l.id === a)!.sincronizado).toBe(false);
    expect(despues.find((l) => l.id === b)!.sincronizado).toBe(true);
    expect(despues.find((l) => l.id === c)!.sincronizado).toBe(false);
  });
});

describe('conciliar proyectos con ids (renombrar, desactivar y eliminar sin duplicados)', () => {
  const r = (id: string, nombre: string, o: any = {}) => ({ id, nombre, cliente: '', notas: '', activo: true, ...o });

  it('un proyecto renombrado en el servidor se renombra aquí (no se crea otro con el nombre viejo); cliente, notas y estado también llegan', async () => {
    await db.crearProyecto('Barrio A');
    expect(await db.conciliarProyectosInfo([r('p1', 'General'), r('p2', 'Barrio A')])).toBeGreaterThan(0);   // se les asigna su id por nombre
    const antes = (await db.listarProyectos()).find((p) => p.idHoja === 'p2')!;
    expect(await db.conciliarProyectosInfo([r('p1', 'General'), r('p2', 'Barrio Nuevo', { cliente: 'Soacha', notas: 'Fase 1' })])).toBe(1);
    const lista = await db.listarProyectos();
    expect(lista.map((p) => p.nombre).sort()).toEqual(['Barrio Nuevo', 'General']);
    expect(lista.find((p) => p.idHoja === 'p2')).toMatchObject({ id: antes.id, nombre: 'Barrio Nuevo', cliente: 'Soacha', notas: 'Fase 1', activo: true });
    expect(await db.conciliarProyectosInfo([r('p1', 'General'), r('p2', 'Barrio Nuevo', { cliente: 'Soacha', notas: 'Fase 1' })])).toBe(0);   // nada que cambiar
  });

  it('desactivar marca el proyecto (no se borra); activarlo lo devuelve', async () => {
    await db.conciliarProyectosInfo([r('p1', 'General')]);
    await db.conciliarProyectosInfo([r('p1', 'General', { activo: false })]);
    expect((await db.listarProyectos())[0]).toMatchObject({ nombre: 'General', activo: false });
    await db.conciliarProyectosInfo([r('p1', 'General')]);
    expect((await db.listarProyectos())[0].activo).toBe(true);
  });

  it('un proyecto que desaparece del servidor se quita si no tiene nada pendiente; uno con registros sin enviar se conserva; los nuevos se crean', async () => {
    await db.conciliarProyectosInfo([r('p1', 'General'), r('p2', 'Zona 2'), r('p3', 'Zona 3')]);
    const z3 = (await db.listarProyectos()).find((p) => p.idHoja === 'p3')!;
    await db.guardarLuminaria(borrador(z3.id));                                   // sin enviar
    expect(await db.conciliarProyectosInfo([r('p1', 'General'), r('p4', 'Zona 4')])).toBe(2);   // se quita Zona 2 y se crea Zona 4
    expect((await db.listarProyectos()).map((p) => p.nombre).sort()).toEqual(['General', 'Zona 3', 'Zona 4']);
  });

  it('si se quitan todos, queda un proyecto General', async () => {
    await db.conciliarProyectosInfo([r('p1', 'General')]);
    await db.conciliarProyectosInfo([r('p9', 'Otro')]);
    expect((await db.listarProyectos()).map((p) => p.nombre)).toEqual(['Otro']);
  });
});
