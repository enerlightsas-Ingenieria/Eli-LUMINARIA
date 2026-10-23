import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  // Rutas relativas: la app funciona igual en la raíz de un dominio o en una subcarpeta (GitHub Pages, etc.)
  base: './',
  plugins: [react()],
  resolve: { alias: { '@compartido': fileURLToPath(new URL('../src', import.meta.url)) } },
  define: {
    __VERSION__: JSON.stringify(version),
    // identifica la compilación: el service worker descarta cachés de versiones anteriores
    __BUILD__: JSON.stringify(Date.now().toString(36)),
  },
  build: { sourcemap: false, target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['./tests/setup.ts'] },
});
