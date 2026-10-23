import { expect, Page, test } from '@playwright/test';
import { Backend, crearBackend, enlace, telefono, WEB, WORKER } from './backend';

const dialogo = (page: Page) => page.getByRole('alertdialog');
const boton = async (page: Page, nombre: string) => dialogo(page).getByRole('button', { name: nombre, exact: true }).click();

/** Abre un enlace de configuración y acepta el aviso (como haría el técnico al tocar el enlace). */
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

/** Nueva luminaria → foto con la cámara simulada → (IA | manual) → pantalla de edición. */
async function capturar(page: Page, modo: 'ia' | 'manual' = 'ia') {
  await page.getByRole('button', { name: 'Nueva luminaria' }).click();
  await expect(page.getByTestId('gps')).toContainText('Precisión', { timeout: 15_000 });
  await page.getByTestId('ranura-0').click();
  const disparar = page.getByRole('button', { name: 'Tomar foto' });
  await expect(disparar).toBeEnabled({ timeout: 15_000 });
  await disparar.click();
  await expect(page.getByTestId('ranura-0').locator('img')).toBeVisible();
  const siguiente = page.getByRole('button', { name: modo === 'ia' ? 'Analizar con IA' : 'Llenar manualmente' });
  await expect(siguiente).toBeEnabled({ timeout: 15_000 });
  await siguiente.click();
  await expect(page.getByLabel('Latitud', { exact: true })).toBeVisible({ timeout: 30_000 });
}

const guardar = (page: Page) => page.getByRole('button', { name: 'Guardar', exact: true }).click();

/** Filas de una pestaña del backend como objetos {encabezado: valor}. */
function filas(b: Backend, hoja: string): Record<string, any>[] {
  const h = b.gs.hoja(hoja);
  if (!h || h.filas.length < 2) return [];
  return h.filas.slice(1).map((f) => Object.fromEntries(h.filas[0].map((c: string, i: number) => [c, f[i]])));
}

test('técnico: configura por enlace, captura con IA, guarda y se sincroniza a la hoja', async ({ browser }) => {
  const b = crearBackend();
  const { page } = await telefono(browser, b);
  await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await usarProyecto(page, 'Barrio A');

  await capturar(page, 'ia');
  expect(b.estado.llamadasIA).toBe(1);                                              // pasó por el proxy real y su validación estricta
  const imagenes = b.estado.ultimaPeticionIA.messages[0].content.filter((c: any) => c.type === 'image');
  expect(imagenes).toHaveLength(1);
  expect(imagenes[0].source.media_type).toBe('image/jpeg');
  expect(imagenes[0].source.data.length).toBeGreaterThan(500);                      // una foto real de la cámara simulada

  await expect(page.getByLabel('Fabricante', { exact: true })).toHaveValue('Philips');   // la IA rellenó el formulario
  await expect(page.getByLabel('Pines de la fotocelda', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('Latitud', { exact: true })).toHaveValue('4.711');
  await expect(page.getByLabel('Longitud', { exact: true })).toHaveValue('-74.0721');
  await page.getByLabel('Código de la luminaria', { exact: true }).fill('P-001');
  await guardar(page);

  await expect(page.getByText('P-001 · Philips')).toBeVisible();
  await expect.poll(() => filas(b, 'Barrio A').length, { timeout: 20_000 }).toBe(1);   // sincronización automática (3 s después de guardar)
  const fila = filas(b, 'Barrio A')[0];
  expect(fila).toMatchObject({ Fabricante: 'Philips', 'Código de la luminaria': 'P-001', Técnico: 'Ana', Tecnología: 'LED', 'Pines fotocelda': 7, Latitud: 4.711, Longitud: -74.0721, 'Origen de la foto': 'camara' });
  await expect(page.getByText('Pendiente', { exact: true })).toHaveCount(0);                          // ya no figura como pendiente
});

test('dos técnicos: lo que hace uno aparece en el otro; las ediciones y borrados se propagan', async ({ browser }) => {
  const b = crearBackend();
  const ana = await telefono(browser, b); const beto = await telefono(browser, b);
  await configurar(ana.page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await configurar(beto.page, enlace({ tecnico: 'Beto', token: 'tokBeto', proyectos: ['Barrio A'] }));
  await usarProyecto(ana.page, 'Barrio A'); await usarProyecto(beto.page, 'Barrio A');

  await capturar(ana.page, 'ia'); await guardar(ana.page);
  await expect.poll(() => filas(b, 'Barrio A').length, { timeout: 20_000 }).toBe(1);

  // Beto sincroniza a mano y ve el trabajo de Ana
  await beto.page.getByRole('button', { name: 'Sincronizar', exact: true }).click();
  await expect(dialogo(beto.page)).toContainText('recibida(s) del equipo');
  await boton(beto.page, 'Entendido');
  await expect(beto.page.getByText('Por Ana')).toBeVisible();
  await expect(beto.page.getByText('Philips')).toBeVisible();

  // Ana elimina el registro → se propaga a Beto, y en la hoja queda marcado (no se borra la fila)
  await ana.page.getByText('Philips').click();
  await ana.page.getByRole('button', { name: 'Eliminar' }).click();
  await boton(ana.page, 'Eliminar');
  await ana.page.getByRole('button', { name: 'Sincronizar', exact: true }).click();
  await boton(ana.page, 'Entendido');
  expect(filas(b, 'Barrio A')[0]['Eliminada']).toBe('SÍ');
  await beto.page.getByRole('button', { name: 'Sincronizar', exact: true }).click();
  await expect(dialogo(beto.page)).toContainText('eliminación');
  await boton(beto.page, 'Entendido');
  await expect(beto.page.getByText('Philips')).toHaveCount(0);
});

test('sin conexión: captura manual con opciones rápidas y se envía sola al volver la señal', async ({ browser }) => {
  const b = crearBackend();
  const { ctx, page } = await telefono(browser, b);
  await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await usarProyecto(page, 'Barrio A');

  await ctx.setOffline(true);
  await capturar(page, 'manual');
  await page.getByLabel('Fabricante', { exact: true }).fill('Schréder');
  await page.getByRole('group', { name: 'Opciones para Tecnología' }).getByRole('button', { name: 'LED', exact: true }).click();
  await page.getByRole('group', { name: 'Opciones para Pines de la fotocelda' }).getByRole('button', { name: '7', exact: true }).click();
  await expect(page.getByLabel('Tecnología', { exact: true })).toHaveValue('LED');
  await guardar(page);
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  expect(b.estado.llamadasIA).toBe(0);                                              // offline: no se intentó la IA
  expect(filas(b, 'Barrio A')).toHaveLength(0);

  await ctx.setOffline(false);                                                       // vuelve la señal
  await expect.poll(() => filas(b, 'Barrio A').length, { timeout: 20_000 }).toBe(1);
  expect(filas(b, 'Barrio A')[0]).toMatchObject({ Fabricante: 'Schréder', Tecnología: 'LED', 'Pines fotocelda': 7 });
  await expect(page.getByText('Pendiente', { exact: true })).toHaveCount(0);
});

test('jornada: el supervisor ve en su panel quién trabaja, dónde, y cuándo pausa o termina', async ({ browser }) => {
  const b = crearBackend();
  const ana = await telefono(browser, b); const sup = await telefono(browser, b);
  await configurar(ana.page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await usarProyecto(ana.page, 'Barrio A');

  await ana.page.getByRole('button', { name: 'Iniciar jornada' }).click();
  await expect(dialogo(ana.page)).toContainText('Aviso de ubicación');                // pide consentimiento la primera vez
  await boton(ana.page, 'Acepto');
  await expect(ana.page.getByTestId('tarjeta-jornada')).toContainText('Jornada activa');
  await expect.poll(() => filas(b, '_Equipo').length, { timeout: 15_000 }).toBe(1);
  expect(filas(b, '_Equipo')[0]).toMatchObject({ Técnico: 'Ana', Estado: 'En jornada', Plataforma: 'web', Latitud: 4.711, Longitud: -74.0721 });  // el nombre lo pone el proxy según el token

  await configurar(sup.page, enlace({ token: 'tokSup', supervisor: true }));
  await expect(sup.page.getByRole('heading', { name: 'Equipo' })).toBeVisible();
  await expect(sup.page.getByTestId('lista-equipo')).toContainText('Ana');
  await expect(sup.page.getByTestId('lista-equipo')).toContainText('En jornada');
  await expect(sup.page.getByText('1 en jornada')).toBeVisible();
  await expect(sup.page.locator('.leaflet-tooltip', { hasText: 'Ana' })).toHaveCount(1);   // marcador con su nombre

  await ana.page.getByRole('button', { name: 'Pausar' }).click();
  await expect(ana.page.getByTestId('tarjeta-jornada')).toContainText('Jornada en pausa');
  await expect.poll(() => filas(b, '_Equipo')[0].Estado).toBe('Pausada');                // el servidor ya lo sabe
  await sup.page.getByRole('button', { name: 'Actualizar' }).click();
  await expect(sup.page.getByTestId('lista-equipo')).toContainText('Pausada');
  await expect(sup.page.locator('.leaflet-tooltip', { hasText: 'Ana' })).toHaveCount(0);   // en pausa no hay ubicación

  await ana.page.getByRole('button', { name: 'Terminar' }).click();
  await boton(ana.page, 'Terminar');
  await expect.poll(() => filas(b, '_Equipo')[0].Estado).toBe('Terminada');
  await sup.page.getByRole('button', { name: 'Actualizar' }).click();
  await expect(sup.page.getByTestId('lista-equipo')).toContainText('Terminada');
  const jornadas = filas(b, '_Jornadas');
  expect(jornadas).toHaveLength(1);
  expect(jornadas[0].Fin).toBeInstanceOf(Date);

  // un técnico NO puede abrir el panel con su token (separación de funciones), y la respuesta de error llega al navegador (CORS)
  const estadoPanel = await ana.page.evaluate(async (u) => (await fetch(`${u}/equipo`, { method: 'POST', headers: { 'x-api-key': 'tokAna', 'content-type': 'text/plain' }, body: '{}' })).status, WORKER);
  expect(estadoPanel).toBe(401);
});

test('modo terceros: exige jornada, solo cámara, GPS preciso y coordenadas bloqueadas; el servidor lo audita limpio', async ({ browser }) => {
  const b = crearBackend();
  const { ctx, page } = await telefono(browser, b);
  await configurar(page, enlace({ tecnico: 'Carla', token: 'tokAna', proyectos: ['Barrio A'], terceros: true, precision: '20' }));
  await usarProyecto(page, 'Barrio A');

  await page.getByRole('button', { name: 'Nueva luminaria' }).click();
  await expect(page.getByText('Inicia tu jornada para capturar')).toBeVisible();   // sin jornada no se captura
  await page.getByRole('button', { name: 'Iniciar jornada' }).click();
  await boton(page, 'Acepto');
  await expect(page.getByTestId('ranura-0')).toBeVisible();

  // GPS impreciso (±60 m): bloquea y avisa; al mejorar la señal se desbloquea solo
  await ctx.setGeolocation({ latitude: 4.711, longitude: -74.0721, accuracy: 60 });
  await page.getByRole('button', { name: 'Actualizar GPS' }).click();
  await expect(page.getByText(/Precisión GPS ±60 m/)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('ranura-0').click();
  await expect(page.getByRole('button', { name: 'Galería' })).toHaveCount(0);        // sin galería en modo terceros
  const disparar = page.getByRole('button', { name: 'Tomar foto' });
  await expect(disparar).toBeEnabled({ timeout: 15_000 });
  await disparar.click();
  await expect(page.getByRole('button', { name: 'Analizar con IA' })).toBeDisabled();
  await ctx.setGeolocation({ latitude: 4.711, longitude: -74.0721, accuracy: 8 });
  await expect(page.getByRole('button', { name: 'Analizar con IA' })).toBeEnabled({ timeout: 20_000 });   // reintento automático del GPS
  await page.getByRole('button', { name: 'Analizar con IA' }).click();

  await expect(page.getByLabel('Latitud', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Latitud', { exact: true })).not.toBeEditable();      // la coordenada no se teclea
  await expect(page.getByLabel('Longitud', { exact: true })).not.toBeEditable();
  await guardar(page);
  await expect.poll(() => filas(b, 'Barrio A').length, { timeout: 20_000 }).toBe(1);
  const f = filas(b, 'Barrio A')[0];
  expect(f['Origen de la foto']).toBe('camara');
  expect(String(f['ID jornada']).length).toBeGreaterThan(10);
  expect(f['Alertas']).toBe('');                                                      // la auditoría del servidor no ve nada raro
});

test('PWA: desde la PRIMERA visita queda lista y abre sin conexión (sin recargar antes)', async ({ browser }) => {
  const b = crearBackend();
  const { ctx, page } = await telefono(browser, b);
  await page.goto(WEB);
  await expect(page.getByTestId('banda-lista')).toBeVisible({ timeout: 20_000 });      // "Lista para trabajar sin conexión"
  await ctx.setOffline(true);
  await page.reload();                                                                  // navegación completa sin internet: la sirve el service worker
  await expect(page.getByRole('heading', { name: 'ELI-LUMINARIA' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva luminaria' })).toBeVisible();
});

test('errores: token de IA inválido → aviso y sigue a mano; enlace de configuración dañado → mensaje claro', async ({ browser }) => {
  const b = crearBackend();
  const { page } = await telefono(browser, b);
  await page.goto(`${WEB}/#/config?c=ELI1.@@@`);
  await expect(dialogo(page)).toContainText(/inválido|dañado/i);
  await boton(page, 'Entendido');

  await configurar(page, enlace({ tecnico: 'Ana', token: 'token-que-no-existe', proyectos: ['Barrio A'] }));
  await usarProyecto(page, 'Barrio A');
  await capturar(page, 'ia');
  await expect(page.getByRole('status').filter({ hasText: '401' })).toBeVisible();   // avisa del token inválido…
  await page.getByLabel('Fabricante', { exact: true }).fill('Manual');                     // …y se puede seguir a mano
  await guardar(page);
  await expect(page.getByText('Manual')).toBeVisible();
  expect(b.estado.llamadasIA).toBe(0);                                                // el proxy rechazó antes de llegar a la IA
});

test('administración: el administrador crea un técnico en la app, le entrega su enlace y esa persona entra con su rol y trabaja', async ({ browser }) => {
  const b = crearBackend();
  const admin = await telefono(browser, b);
  await configurar(admin.page, enlace({ token: 'tokSup' }));          // la clave inicial del administrador (ADMIN_TOKENS)
  await admin.page.getByRole('link', { name: 'Ajustes' }).click();
  await expect(admin.page.getByTestId('cuenta')).toContainText('Administrador');
  await admin.page.getByRole('button', { name: 'Administración (usuarios e IA)' }).click();

  // dos pantallas independientes: Inteligencia artificial y Usuarios
  await expect(admin.page.getByRole('button', { name: 'Administrar usuarios' })).toBeVisible();
  await admin.page.getByRole('button', { name: 'Administrar la inteligencia artificial' }).click();
  await expect(admin.page.getByRole('button', { name: 'Nuevo usuario' })).toHaveCount(0);     // aquí no hay usuarios

  // IA: el administrador ve qué claves hay, prueba cada proveedor y elige cuál va primero
  await expect(admin.page.getByText('Gemini ❌ falta')).toBeVisible();                       // en esta prueba solo hay clave de Claude
  await admin.page.getByRole('button', { name: 'Probar la IA' }).click();
  await expect(admin.page.getByText('Claude: ✅ funciona')).toBeVisible();
  await expect(admin.page.getByText(/Gemini: ❌.*Sin clave configurada/)).toBeVisible();
  await admin.page.getByRole('tab', { name: 'Claude' }).click();
  await expect.poll(() => b.gs.hoja('_Config')?.filas[1]?.join('=')).toBe('ia=claude');

  await admin.page.getByRole('button', { name: 'Volver' }).click();
  await admin.page.getByRole('button', { name: 'Administrar usuarios' }).click();
  await expect(admin.page.getByText('Elegir el modelo de Gemini')).toHaveCount(0);            // aquí no hay IA
  await admin.page.getByRole('button', { name: 'Nuevo usuario' }).click();
  await admin.page.getByLabel('Nombre', { exact: true }).fill('Carla Gómez');
  await admin.page.getByRole('button', { name: 'Crear y ver enlace' }).click();
  const url = await admin.page.getByLabel('Enlace de acceso').inputValue();
  expect(url).toContain('#/config?c=ELI1.');
  expect(url).not.toContain('tokSup');                                  // el enlace lleva la clave de Carla, no la del administrador
  expect(b.gs.hoja('_Usuarios')!.filas.some((f: any[]) => f[0] === 'Carla Gómez' && f[1] === 'tecnico' && /^[0-9a-f]{20}$/.test(f[2]))).toBe(true);

  // Carla abre su enlace en su teléfono: queda como técnico, sin panel ni administración, y captura
  const carla = await telefono(browser, b);
  await configurar(carla.page, url.replace(WEB, WEB));
  await carla.page.getByRole('link', { name: 'Ajustes' }).click();
  await expect(carla.page.getByTestId('cuenta')).toContainText('Carla Gómez · Técnico');
  await expect(carla.page.getByRole('button', { name: 'Administración (usuarios e IA)' })).toHaveCount(0);
  await expect(carla.page.getByRole('link', { name: 'Panel' })).toHaveCount(0);
  await carla.page.getByRole('link', { name: 'Registros' }).click();
  await capturar(carla.page, 'manual');
  await carla.page.getByLabel('Fabricante', { exact: true }).fill('Schréder');
  await carla.page.getByRole('button', { name: 'LED', exact: true }).click();
  await carla.page.getByRole('button', { name: 'Otra (¿cuál?)' }).click();
  await expect(carla.page.getByLabel('Tecnología', { exact: true })).toHaveValue('Otra: ');
  await carla.page.getByLabel('Tecnología', { exact: true }).fill('Otra: Plasma');
  await guardar(carla.page);
  await expect.poll(() => filas(b, 'General').length, { timeout: 20_000 }).toBe(1);
  expect(filas(b, 'General')[0]).toMatchObject({ Técnico: 'Carla Gómez', Fabricante: 'Schréder', Tecnología: 'Otra: Plasma' });
  expect(Object.keys(filas(b, 'General')[0])).not.toContain('Marca');

  // el administrador la hace supervisora: ahora ve el panel y también puede capturar
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await admin.page.getByRole('button', { name: /Carla Gómez/ }).click();
  await admin.page.getByRole('tab', { name: 'Supervisor' }).click();
  await admin.page.getByRole('button', { name: 'Guardar y ver enlace' }).click();
  await expect(admin.page.getByRole('dialog', { name: 'Acceso de Carla Gómez' })).toBeVisible();
  await carla.page.reload();
  await expect(carla.page.getByRole('link', { name: 'Panel' })).toBeVisible({ timeout: 15_000 });
  await expect(carla.page.getByRole('link', { name: 'Registros' })).toBeVisible();
});
