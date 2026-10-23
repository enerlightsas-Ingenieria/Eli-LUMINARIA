import { test } from '@playwright/test';
import { crearBackend, enlace, telefono } from './backend';

/** Capturas de pantalla de las pantallas principales (solo si se define SHOTS=/carpeta). No hace aserciones. */
test('recorrido visual', async ({ browser }) => {
  const dir = process.env.SHOTS;
  test.skip(!dir, 'SHOTS no definido');
  const b = crearBackend();
  const { page } = await telefono(browser, b);
  const foto = (n: string) => page.screenshot({ path: `${dir}/${n}.png` });
  await page.goto(enlace({ tecnico: 'Ana Gómez', token: 'tokAna', proyectos: ['Barrio La Esperanza'] }));
  await page.getByRole('alertdialog').getByRole('button', { name: 'Importar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Entendido' }).click();
  await page.getByRole('link', { name: 'Proyectos' }).click();
  await page.getByRole('button', { name: 'Proyecto Barrio La Esperanza' }).click();
  await page.getByRole('link', { name: 'Registros' }).click();
  await foto('1-registros-vacio');
  await page.getByRole('button', { name: 'Nueva luminaria' }).click();
  await page.getByTestId('gps').getByText(/Precisión/).waitFor();
  await page.getByTestId('ranura-0').click();
  await page.getByRole('button', { name: 'Tomar foto' }).click();
  await page.getByTestId('ranura-0').locator('img').waitFor();
  await foto('2-capturar');
  await page.getByRole('button', { name: 'Analizar con IA' }).click();
  await page.getByLabel('Latitud', { exact: true }).waitFor();
  await foto('3-editar');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('Philips').waitFor();
  await foto('4-registros');
  await page.getByRole('link', { name: 'Mapa' }).click();
  await page.waitForTimeout(800);
  await foto('5-mapa');
  await page.getByRole('link', { name: 'Proyectos' }).click();
  await foto('6-proyectos');
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await foto('7-ajustes');
});
