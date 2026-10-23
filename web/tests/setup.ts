import 'fake-indexeddb/auto';

// localStorage mínimo para el entorno de pruebas (node)
const memoria = new Map<string, string>();
(globalThis as any).localStorage ??= {
  getItem: (k: string) => (memoria.has(k) ? memoria.get(k)! : null),
  setItem: (k: string, v: string) => { memoria.set(k, String(v)); },
  removeItem: (k: string) => { memoria.delete(k); },
  clear: () => memoria.clear(),
};
