import { crearSincronizador } from '../src/core/sync';

/** Si el servidor dice que el proyecto ya no existe (lo eliminó el administrador), el teléfono lo quita y no vuelve a intentarlo. */
describe('sincronizar un proyecto que el administrador eliminó', () => {
  const proyecto: any = { id: 1, uuid: 'pu', idHoja: 'p1', nombre: 'Barrio A', cliente: '', notas: '', creadoEn: '' };
  const montar = (error: string) => {
    const quitados: any[] = [];
    const post = jest.fn(async (_a: any, _c: any): Promise<any> => { throw new Error(error); });
    const s = crearSincronizador({
      almacen: {
        pendientesDeSync: async () => [], marcarSincronizadas: async () => {}, borradasPendientes: async () => [], limpiarBorradas: async () => {},
        fusionarRemotas: async () => ({ nuevas: 0, actualizadas: 0, borradas: 0 }), leerKv: async () => null, guardarKv: async () => {}, listarProyectos: async () => [proyecto],
      },
      cargarAjustes: async () => ({ syncUrl: 'https://x/sync', autoSync: true, syncFotos: true } as any),
      leerFoto: async () => '', post, alEliminarProyecto: async (p) => { quitados.push(p.id); },
    });
    return { s, quitados, post };
  };

  it('lo quita de este dispositivo y avisa con un mensaje claro (sin el código interno)', async () => {
    const { s, quitados, post } = montar('PROYECTO_NO_EXISTE · El proyecto no existe o fue eliminado por el administrador. Pídele que lo cree.');
    await expect(s.sincronizar(proyecto)).rejects.toThrow('"Barrio A" fue eliminado por el administrador y se quitó de este dispositivo');
    expect(quitados).toEqual([1]);
    expect(post.mock.calls[0][1]).toMatchObject({ accion: 'listar', proyecto: { id: 'p1', nombre: 'Barrio A' } });   // el id viaja siempre
  });

  it('cualquier otro error no borra nada', async () => {
    const { s, quitados } = montar('Servidor ocupado o error: Lock timeout');
    await expect(s.sincronizar(proyecto)).rejects.toThrow(/Lock timeout/);
    expect(quitados).toEqual([]);
  });
});
