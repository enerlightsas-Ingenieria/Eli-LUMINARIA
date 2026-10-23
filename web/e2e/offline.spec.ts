import { expect, Page, test } from '@playwright/test';
import { Backend, crearBackend, enlace, telefono, WEB } from './backend';

const dialogo = (page: Page) => page.getByRole('alertdialog');
const boton = (page: Page, nombre: string) => dialogo(page).getByRole('button', { name: nombre, exact: true }).click();

async function configurar(page: Page, link: string) {
  await page.goto(link);
  await expect(dialogo(page)).toContainText('¿Importar configuración?');
  await boton(page, 'Importar');
  await expect(dialogo(page)).toContainText('Configuración aplicada');
  await boton(page, 'Entendido');
}
async function usarProyecto(page: Page, nombre: string) {
  await page.getByRole('link', { name: 'Proyectos' }).click();
  await page.getByRole('button', { name: `Proyecto ${nombre}` }).click();
  await page.getByRole('link', { name: 'Registros' }).click();
}
async function capturarManual(page: Page) {
  await page.getByRole('button', { name: 'Nueva luminaria' }).click();
  await expect(page.getByTestId('gps')).toContainText('Precisión', { timeout: 15_000 });
  await page.getByTestId('ranura-0').click();
  const disparar = page.getByRole('button', { name: 'Tomar foto' });
  await expect(disparar).toBeEnabled({ timeout: 15_000 });
  await disparar.click();
  await page.getByRole('button', { name: 'Llenar manualmente' }).click();
  await expect(page.getByLabel('Latitud', { exact: true })).toBeVisible({ timeout: 30_000 });
}
const guardar = (page: Page) => page.getByRole('button', { name: 'Guardar', exact: true }).click();
function filas(b: Backend, hoja: string): Record<string, any>[] {
  const h = b.gs.hoja(hoja);
  if (!h || h.filas.length < 2) return [];
  return h.filas.slice(1).map((f) => Object.fromEntries(h.filas[0].map((c: string, i: number) => [c, f[i]])));
}

test.describe('uso sin conexión (web)', () => {
  test('desde la primera visita: configurar, capturar y guardar SIN internet; sobrevive a recargas; se envía al volver', async ({ browser }) => {
    const b = crearBackend();
    const { ctx, page } = await telefono(browser, b);
    await page.goto(WEB);
    await expect(page.getByTestId('banda-lista')).toBeVisible({ timeout: 20_000 });

    await ctx.setOffline(true);
    await page.reload();                                                                        // navegación completa sin red
    await expect(page.getByTestId('banda-sin-conexion')).toBeVisible();
    await expect(page.getByTestId('banda-sin-conexion')).toContainText('Sin conexión');

    await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] })); // la configuración también se importa sin internet
    await usarProyecto(page, 'Barrio A');
    await capturarManual(page);
    await page.getByLabel('Marca', { exact: true }).fill('Schréder');
    await page.getByRole('group', { name: 'Opciones para Tecnología' }).getByRole('button', { name: 'LED', exact: true }).click();
    await guardar(page);
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
    await expect(page.getByTestId('banda-sin-conexion')).toContainText('1 pendiente');

    await page.reload();                                                                        // los datos viven en el dispositivo
    await expect(page.getByText('Schréder')).toBeVisible();
    await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
    expect(filas(b, 'Barrio A')).toHaveLength(0);                                               // nada salió sin conexión
    expect(b.estado.llamadasIA).toBe(0);                                                        // y no se intentó la IA

    await ctx.setOffline(false);                                                                // vuelve la señal
    await expect(page.getByTestId('banda-sin-conexion')).toHaveCount(0);
    await expect.poll(() => filas(b, 'Barrio A').length, { timeout: 20_000 }).toBe(1);
    expect(filas(b, 'Barrio A')[0]).toMatchObject({ Marca: 'Schréder', Tecnología: 'LED', Técnico: 'Ana' });
    await expect(page.getByText('Pendiente', { exact: true })).toHaveCount(0);
  });

  test('lo capturado sin IA se analiza en lote cuando el usuario decide, sin pisar lo escrito a mano', async ({ browser }) => {
    const b = crearBackend();
    const { ctx, page } = await telefono(browser, b);
    await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
    await usarProyecto(page, 'Barrio A');

    await ctx.setOffline(true);
    await capturarManual(page); await guardar(page);                                            // luminaria 1: sin datos
    await capturarManual(page); await page.getByLabel('Marca', { exact: true }).fill('Escrita a mano'); await guardar(page);  // luminaria 2: con datos
    await expect(dialogo(page)).toContainText('Posible duplicado');                                // misma coordenada que la anterior: la app avisa
    await boton(page, 'Guardar igual');
    await expect(page.getByText('Escrita a mano')).toBeVisible();

    await expect(page.getByTestId('lote-ia')).toContainText('1 luminaria sin analizar con IA');
    await expect(page.getByRole('button', { name: 'Necesitas conexión' })).toBeDisabled();       // sin internet no se puede
    expect(b.estado.llamadasIA).toBe(0);

    await ctx.setOffline(false);                                                                // con internet NO se analiza sola: decide el usuario (costo)
    await page.waitForTimeout(800);
    expect(b.estado.llamadasIA).toBe(0);
    await page.getByRole('button', { name: 'Analizar ahora' }).click();
    await expect(dialogo(page)).toContainText('Análisis terminado');
    await expect(dialogo(page)).toContainText('1 luminaria(s) analizada(s)');
    await boton(page, 'Entendido');

    expect(b.estado.llamadasIA).toBe(1);                                                        // solo la que lo necesitaba
    await expect(page.getByText('#1 · Philips')).toBeVisible();
    await expect(page.getByText('Escrita a mano')).toBeVisible();                               // lo del técnico, intacto
    await expect(page.getByTestId('lote-ia')).toHaveCount(0);
    await expect.poll(() => filas(b, 'Barrio A').map((f) => f.Marca).sort(), { timeout: 20_000 }).toEqual(['Escrita a mano', 'Philips']);
  });

  test('IA apagada (control de costos): no aparece ningún botón de IA y no se hace ninguna llamada', async ({ browser }) => {
    const b = crearBackend();
    const { page } = await telefono(browser, b);
    await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
    await usarProyecto(page, 'Barrio A');

    await page.getByRole('link', { name: 'Ajustes' }).click();
    await expect(page.getByTestId('estado-offline')).toContainText('Lista', { timeout: 20_000 });
    await page.getByLabel(/Usar análisis con IA/).uncheck();
    await page.getByRole('button', { name: 'Guardar ajustes' }).click();
    await boton(page, 'Entendido');
    await page.getByRole('link', { name: 'Registros' }).click();

    await page.getByRole('button', { name: 'Nueva luminaria' }).click();
    await expect(page.getByRole('button', { name: 'Llenar manualmente' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analizar con IA' })).toHaveCount(0);
    await page.getByTestId('ranura-0').click();
    await page.getByRole('button', { name: 'Tomar foto' }).click();
    await page.getByRole('button', { name: 'Llenar manualmente' }).click();
    await expect(page.getByLabel('Latitud', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Re-analizar con IA' })).toHaveCount(0);
    await guardar(page);
    await expect(page.getByTestId('lote-ia')).toHaveCount(0);                                   // y tampoco ofrece analizar en lote
    expect(b.estado.llamadasIA).toBe(0);
  });

  test('el mapa avisa sin conexión pero sigue mostrando los puntos', async ({ browser }) => {
    const b = crearBackend();
    const { ctx, page } = await telefono(browser, b);
    await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
    await usarProyecto(page, 'Barrio A');
    await capturarManual(page); await guardar(page);
    await ctx.setOffline(true);
    await page.getByRole('link', { name: 'Mapa' }).click();
    await expect(page.getByTestId('mapa-sin-conexion')).toBeVisible();
    await expect(page.locator('.leaflet-interactive')).toHaveCount(1);                          // la luminaria sigue dibujada
  });
});
