import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Lista recursiva de archivos (rutas relativas con "/"). */
export function listarArchivos(dir: string, base = dir): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...listarArchivos(ruta, base));
    else salida.push(relative(base, ruta).split('\\').join('/'));
  }
  return salida.sort();
}

/**
 * Escribe dist/precache.json con TODOS los archivos de la app. El service worker los descarga al instalarse, así la app queda
 * lista para usarse sin conexión desde la primera visita (sin necesidad de recargar).
 */
export function generarPrecache(dir: string, build: string): string[] {
  const excluidos = new Set(['sw.js', 'precache.json']);
  const archivos = listarArchivos(dir).filter((f) => !excluidos.has(f) && !f.endsWith('.map'));
  writeFileSync(join(dir, 'precache.json'), JSON.stringify({ build, archivos: ['./', ...archivos.map((f) => `./${f}`)] }));
  return archivos;
}

export function precachePlugin(build: string): Plugin {
  let salida = 'dist';
  return {
    name: 'eli-precache',
    apply: 'build',
    configResolved(c) { salida = resolve(c.root, c.build.outDir); },
    closeBundle() { generarPrecache(salida, build); },
  };
}
