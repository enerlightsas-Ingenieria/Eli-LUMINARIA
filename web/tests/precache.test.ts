import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generarPrecache, listarArchivos } from '../plugins/precache';

describe('precarga para uso sin conexión', () => {
  const crear = () => {
    const d = mkdtempSync(join(tmpdir(), 'eli-'));
    mkdirSync(join(d, 'assets')); mkdirSync(join(d, 'icons'));
    for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'assets/app-123.js', 'assets/app-456.css', 'assets/app-123.js.map', 'icons/icon-192.png']) writeFileSync(join(d, f), 'x');
    return d;
  };

  it('lista todos los archivos de la app, incluida la página raíz', () => {
    const d = crear();
    const archivos = generarPrecache(d, 'b1');
    const j = JSON.parse(readFileSync(join(d, 'precache.json'), 'utf8'));
    expect(j.build).toBe('b1');
    expect(j.archivos).toEqual(['./', './assets/app-123.js', './assets/app-456.css', './icons/icon-192.png', './index.html', './manifest.webmanifest']);
    expect(archivos).toHaveLength(5);
  });

  it('no incluye el service worker, la propia lista ni los mapas de depuración', () => {
    const d = crear();
    generarPrecache(d, 'b1');
    const j = JSON.parse(readFileSync(join(d, 'precache.json'), 'utf8'));
    expect(j.archivos.join(' ')).not.toMatch(/sw\.js|precache\.json|\.map/);
  });

  it('una segunda corrida no se lista a sí misma (idempotente)', () => {
    const d = crear();
    generarPrecache(d, 'b1');
    expect(generarPrecache(d, 'b2')).toEqual(['assets/app-123.js', 'assets/app-456.css', 'icons/icon-192.png', 'index.html', 'manifest.webmanifest']);
    expect(listarArchivos(d)).toContain('precache.json');
  });
});
