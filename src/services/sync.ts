import { crearSincronizador } from '../core/sync';
import * as db from './db';
import { leerBase64 } from './fotos';
import { postServidor } from './servidor';
import { cargarAjustes } from './settings';

export { resumenSync } from '../core/sync';
export type { ResultadoSync } from '../core/sync';

// Las dependencias se resuelven en cada llamada (no al cargar el módulo) para que las pruebas puedan sustituirlas.
const sync = crearSincronizador({
  almacen: {
    pendientesDeSync: (id) => db.pendientesDeSync(id),
    marcarSincronizadas: (i) => db.marcarSincronizadas(i),
    borradasPendientes: (id) => db.borradasPendientes(id),
    limpiarBorradas: (u) => db.limpiarBorradas(u),
    fusionarRemotas: (id, r) => db.fusionarRemotas(id, r),
    leerKv: (k) => db.leerKv(k),
    guardarKv: (k, v) => db.guardarKv(k, v),
    listarProyectos: () => db.listarProyectos(),
  },
  cargarAjustes: () => cargarAjustes(),
  leerFoto: (u) => leerBase64(u),
  post: (a, c, t) => postServidor(a, c, t),
});

export const { sincronizar, sincronizarTodo } = sync;
