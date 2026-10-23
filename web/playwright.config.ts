import { defineConfig } from '@playwright/test';

/**
 * Pruebas de navegador de extremo a extremo: la web compilada (vite preview) habla con el proxy REAL (server/worker.ts)
 * y el script REAL de Google (server/google-apps-script.gs) sobre una hoja simulada. Cámara y GPS son simulados por Chromium.
 * Uso:  npm run build && PW_CHROMIUM=/ruta/a/chromium npm run e2e   (sin PW_CHROMIUM usa el Chromium de Playwright)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
});
