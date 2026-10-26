import { expect, Page, test } from '@playwright/test';
import { Backend, crearBackend, enlace, MODELOS_GEMINI, telefono, WEB, WORKER } from './backend';

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
  await expect(page.getByRole('form', { name: 'Ingreso' })).toBeVisible();              // sin cuenta, lo primero es ingresar (la pantalla ya está en el teléfono)
  await page.getByLabel('Usuario', { exact: true }).fill('ana');
  await page.getByLabel('Clave', { exact: true }).fill('lo-que-sea-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No hay conexión con el servidor');   // y sin internet lo explica en vez de fallar mudo
});

test('errores: clave que el servidor no reconoce → vuelve al ingreso con aviso; enlace de configuración dañado → mensaje claro', async ({ browser }) => {
  const b = crearBackend();
  const { page } = await telefono(browser, b);
  await page.goto(`${WEB}/#/config?c=ELI1.@@@`);
  await expect(dialogo(page)).toContainText(/inválido|dañado/i);
  await boton(page, 'Entendido');

  // un enlace con una clave que el servidor no reconoce: la app no se queda a medias, vuelve al ingreso y lo explica
  await configurar(page, enlace({ tecnico: 'Ana', token: 'token-que-no-existe', proyectos: ['Barrio A'] }));
  await expect(page.getByRole('form', { name: 'Ingreso' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'ya no está activo' })).toBeVisible();
  expect(b.estado.llamadasIA).toBe(0);
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
  await admin.page.getByLabel('Nombre completo').fill('Carla Gómez');
  await expect(admin.page.getByLabel('Usuario (para entrar)')).toHaveValue('cgomez');           // propuesta: inicial + apellido
  await admin.page.getByRole('button', { name: 'Crear y ver datos de acceso' }).click();
  await expect(admin.page.getByTestId('acceso-usuario')).toHaveText('cgomez');
  const claveCarla = (await admin.page.getByTestId('acceso-clave').textContent())!;
  const url = await admin.page.getByLabel('Enlace de acceso').inputValue();
  expect(url).toContain('#/config?c=ELI1.');
  expect(url).not.toContain('tokSup');                                  // el enlace lleva la clave de Carla, no la del administrador
  expect(b.gs.hoja('_Usuarios')!.filas.some((f: any[]) => f[0] === 'Carla Gómez' && f[5] === 'cgomez' && f[1] === 'tecnico' && /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/.test(f[2]))).toBe(true);

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
  expect(filas(b, 'General')[0]).toMatchObject({ Técnico: 'Carla Gómez', Usuario: 'cgomez', Fabricante: 'Schréder', Tecnología: 'Otra: Plasma' });
  expect(Object.keys(filas(b, 'General')[0])).not.toContain('Marca');

  // el administrador la hace supervisora: ahora ve el panel y también puede capturar
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await admin.page.getByRole('button', { name: /Carla Gómez/ }).click();
  await admin.page.getByRole('tab', { name: 'Supervisor' }).click();
  await admin.page.getByRole('button', { name: 'Guardar y ver datos de acceso' }).click();
  await expect(admin.page.getByRole('dialog', { name: 'Acceso de Carla Gómez' })).toBeVisible();
  await carla.page.reload();                                                  // al abrir de nuevo siempre se pide ingresar
  await expect(carla.page.getByRole('form', { name: 'Ingreso' })).toBeVisible();
  await expect(carla.page.getByLabel('Usuario', { exact: true })).toHaveValue('cgomez');
  await carla.page.getByLabel('Clave', { exact: true }).fill(claveCarla);
  await carla.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(carla.page.getByRole('link', { name: 'Panel' })).toBeVisible({ timeout: 15_000 });
  await expect(carla.page.getByRole('link', { name: 'Registros' })).toBeVisible();
});

test('administración de la IA: se ven TODOS los modelos (se pueden alcanzar y elegir cualquiera) y el mapa no tapa la barra inferior', async ({ browser }) => {
  const b = crearBackend(undefined, { gemini: true });
  const admin = await telefono(browser, b);
  await configurar(admin.page, enlace({ token: 'tokSup' }));
  await admin.page.getByRole('link', { name: 'Ajustes' }).click();
  await admin.page.getByRole('button', { name: 'Administración (usuarios e IA)' }).click();
  await admin.page.getByRole('button', { name: 'Administrar la inteligencia artificial' }).click();
  await admin.page.getByRole('button', { name: 'Elegir el modelo de Gemini' }).click();

  const grupo = admin.page.getByRole('group', { name: 'Modelos de Gemini' });
  for (const m of MODELOS_GEMINI) {
    const ficha = grupo.getByRole('button', { name: m, exact: true });
    await ficha.scrollIntoViewIfNeeded();                                  // la lista se desplaza hacia abajo: ninguna queda oculta
    await expect(ficha).toBeVisible();
  }
  const ultimo = MODELOS_GEMINI[MODELOS_GEMINI.length - 1];
  await grupo.getByRole('button', { name: ultimo, exact: true }).click();
  await admin.page.getByRole('alertdialog').getByRole('button', { name: 'Entendido' }).click();
  await expect.poll(() => b.gs.hoja('_Config')?.filas.map((f: any[]) => f.join('=')).join('|')).toContain(`gemini_modelo=${ultimo}`);

  // El mapa del Panel nunca debe quedar por encima de la barra de secciones
  await admin.page.goto(WEB + '/#/');
  await expect(admin.page.getByTestId('mapa')).toBeVisible();
  const resultado = await admin.page.evaluate(() => {
    const mapa = document.querySelector('.mapa') as HTMLElement;
    mapa.style.marginTop = '300px';                                       // baja el mapa para que quede justo detrás de la barra, como en el teléfono
    const teselas = document.querySelector('.leaflet-tile-pane') as HTMLElement;   // sin internet no hay mosaicos del mapa: se simula uno grande, como los reales
    teselas.insertAdjacentHTML('beforeend', '<div style="position:absolute;left:-500px;top:-500px;width:3000px;height:3000px"></div>');
    window.scrollTo(0, 0);
    const barra = document.querySelector('.pestanas')!.getBoundingClientRect();
    const x = barra.left + barra.width / 2, y = barra.top + barra.height / 2;
    const m = mapa.getBoundingClientRect();
    return { solapa: m.top < y && m.bottom > y, tapada: !document.elementFromPoint(x, y)?.closest('.pestanas') };
  });
  expect(resultado.solapa).toBe(true);                                    // el mapa sí pasa por detrás de la barra (la prueba no es vacía)
  expect(resultado.tapada).toBe(false);                                   // y la barra queda por encima
  await expect(admin.page.getByRole('link', { name: 'Ajustes' })).toBeVisible();
});

test('ingreso con usuario y clave (sin enlaces): el administrador crea la cuenta, la persona entra, ve los proyectos y puede salir', async ({ browser }) => {
  const b = crearBackend();
  await b.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'listar', proyecto: { nombre: 'Barrio A' }, desde: '' }) });   // proyecto que ya existe en la hoja

  const admin = await telefono(browser, b);
  await configurar(admin.page, enlace({ token: 'tokSup' }));
  await admin.page.getByRole('link', { name: 'Ajustes' }).click();
  await admin.page.getByRole('button', { name: 'Administración (usuarios e IA)' }).click();
  await admin.page.getByRole('button', { name: 'Administrar usuarios' }).click();
  await admin.page.getByRole('button', { name: 'Nuevo usuario' }).click();
  await admin.page.getByLabel('Nombre completo').fill('Darío Ruiz');
  await admin.page.getByLabel('Clave (opcional)').fill('clave-dario-1');
  await admin.page.getByLabel(/Contratista/).check();
  await admin.page.getByRole('button', { name: 'Crear y ver datos de acceso' }).click();
  await expect(admin.page.getByTestId('acceso-usuario')).toHaveText('druiz');
  await expect(admin.page.getByTestId('acceso-clave')).toHaveText('clave-dario-1');
  await expect(admin.page.getByTestId('acceso-direccion')).toContainText(WEB);

  // Darío abre la web SIN enlace: ve el ingreso (no hay nada que configurar a mano)
  const dario = await telefono(browser, b);
  await dario.ctx.route(`${WEB}/servidor.json`, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ proxy: WORKER }) }));
  await dario.page.goto(WEB + '/');
  await expect(dario.page.getByRole('form', { name: 'Ingreso' })).toBeVisible();
  await expect(dario.page.getByRole('link', { name: 'Registros' })).toHaveCount(0);       // sin cuenta no hay menú ni datos

  await dario.page.getByLabel('Usuario', { exact: true }).fill('DRuiz');                  // sin distinguir mayúsculas
  await dario.page.getByLabel('Clave', { exact: true }).fill('clave-equivocada');
  await dario.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(dario.page.getByRole('alert')).toContainText('Usuario o clave incorrectos');

  await dario.page.getByLabel('Clave', { exact: true }).fill('clave-dario-1');
  await dario.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(dario.page.getByRole('link', { name: 'Registros' })).toBeVisible({ timeout: 15_000 });
  await dario.page.getByRole('link', { name: 'Ajustes' }).click();
  await expect(dario.page.getByTestId('cuenta')).toContainText('Darío Ruiz · Técnico');
  await expect(dario.page.getByText(/Modo terceros activo/)).toBeVisible();                // lo decidió el administrador
  await expect(dario.page.getByRole('button', { name: 'Administración (usuarios e IA)' })).toHaveCount(0);
  await dario.page.getByRole('link', { name: 'Proyectos' }).click();
  await expect(dario.page.getByRole('button', { name: /Proyecto Barrio A/ })).toBeVisible();   // el proyecto de la hoja llegó solo

  // Salir devuelve al ingreso; los datos de la cuenta se borran de este teléfono
  await dario.page.getByRole('link', { name: 'Ajustes' }).click();
  await dario.page.getByRole('button', { name: 'Salir de mi cuenta' }).click();
  await dialogo(dario.page).getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(dario.page.getByRole('form', { name: 'Ingreso' })).toBeVisible();

  // el administrador lo da de baja: con la misma clave ya no puede entrar
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await admin.page.getByRole('button', { name: /Darío Ruiz, Técnico/ }).click();
  await admin.page.getByLabel(/Con acceso/).uncheck();
  await admin.page.getByRole('button', { name: 'Guardar y ver datos de acceso' }).click();
  await expect(admin.page.getByRole('button', { name: /Darío Ruiz, Técnico, de baja/ })).toBeVisible();
  await dario.page.getByLabel('Clave', { exact: true }).fill('clave-dario-1');            // el usuario ya viene escrito (se acuerda del último)
  await dario.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(dario.page.getByRole('alert')).toContainText('Usuario o clave incorrectos');
});

test('cámara: pellizcar o usar la barra acerca la IMAGEN (no la página) y la foto sale recortada con ese zoom', async ({ browser }) => {
  const b = crearBackend();
  const { page } = await telefono(browser, b);
  await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await usarProyecto(page, 'Barrio A');
  await page.getByRole('button', { name: 'Nueva luminaria' }).click();
  await page.getByTestId('ranura-0').click();
  const camara = page.getByRole('dialog', { name: /Cámara/ });
  await expect(page.getByRole('button', { name: 'Tomar foto' })).toBeEnabled({ timeout: 15_000 });

  // el gesto de pellizco pertenece a la cámara: la página no puede hacer zoom por su cuenta
  expect(await camara.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  expect(await page.getByTestId('visor').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');

  // pellizco con dos dedos: se separan al doble de distancia → zoom ×2
  await page.getByTestId('visor').evaluate((el) => {
    const r = el.getBoundingClientRect(), y = r.top + r.height / 2;
    const ev = (tipo: string, id: number, x: number) => el.dispatchEvent(new PointerEvent(tipo, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    ev('pointerdown', 1, r.left + 100); ev('pointerdown', 2, r.left + 200);
    ev('pointermove', 2, r.left + 300);
    ev('pointerup', 2, r.left + 300); ev('pointerup', 1, r.left + 100);
  });
  await expect(page.getByTestId('zoom-valor')).toHaveText('2.0×');
  expect(await page.locator('.camara video').evaluate((v) => getComputedStyle(v).transform)).toMatch(/matrix\(2,/);   // se acerca la imagen de la cámara

  // barra de zoom: acerca y aleja
  await page.getByRole('slider', { name: 'Zoom' }).fill('4');
  await expect(page.getByTestId('zoom-valor')).toHaveText('4.0×');
  await page.getByRole('button', { name: 'Alejar' }).click();
  await expect(page.getByTestId('zoom-valor')).toHaveText('3.5×');
  await page.getByRole('slider', { name: 'Zoom' }).fill('1');
  await expect(page.getByTestId('zoom-valor')).toHaveCount(0);                              // en 1× no hay indicador

  // la foto sale con el zoom elegido: más pequeña (recortada del centro), no la imagen completa
  const anchoVideo = await page.locator('.camara video').evaluate((v: HTMLVideoElement) => v.videoWidth);
  await page.getByRole('slider', { name: 'Zoom' }).fill('4');
  await page.getByRole('button', { name: 'Tomar foto' }).click();
  const img = page.getByTestId('ranura-0').locator('img');
  await expect(img).toBeVisible();
  const ancho = await img.evaluate(async (i: HTMLImageElement) => (await createImageBitmap(await (await fetch(i.src)).blob())).width);
  expect(ancho).toBeLessThanOrEqual(Math.ceil(anchoVideo / 4) + 1);
  expect(ancho).toBeGreaterThan(anchoVideo / 8);
});

test('seguridad: a los 15 minutos sin usar la app se bloquea y pide la clave; usarla reinicia el conteo; no se puede esquivar con la dirección', async ({ browser }) => {
  const b = crearBackend();
  const { page } = await telefono(browser, b);
  await page.clock.install();
  await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await expect(page.getByRole('button', { name: 'Nueva luminaria' })).toBeVisible();

  // usar la app reinicia el conteo: 14 min + toque + 14 min = no se bloquea
  await page.clock.runFor('14:00');
  await page.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
  await page.clock.runFor('14:00');
  await expect(page.getByRole('form', { name: 'Pantalla bloqueada' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nueva luminaria' })).toBeVisible();

  // 16 minutos sin tocar nada → bloqueada
  await page.clock.runFor('16:00');
  const bloqueo = page.getByRole('form', { name: 'Pantalla bloqueada' });
  await expect(bloqueo).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva luminaria' })).toHaveCount(0);        // no se ve nada de la app
  await expect(page.getByRole('link', { name: 'Registros' })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/ajustes'; });                                // intentar saltarse el bloqueo con la dirección
  await expect(bloqueo).toBeVisible();
  await page.evaluate(() => { location.hash = '#/ayuda'; });
  await expect(bloqueo).toBeVisible();
  await page.evaluate(() => { location.hash = '#/'; });

  await page.getByLabel('Clave', { exact: true }).fill('mala-clave');
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(page.getByRole('alert')).toContainText('Clave incorrecta');
  await expect(bloqueo).toBeVisible();

  await page.getByLabel('Clave', { exact: true }).fill('tokAna');
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(bloqueo).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nueva luminaria' })).toBeVisible();          // vuelve donde estaba
});

test('seguridad: el botón Salir cierra la sesión, la clave no queda guardada en el teléfono y al volver se pide ingresar', async ({ browser }) => {
  const b = crearBackend();
  const { page } = await telefono(browser, b);
  await configurar(page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await usarProyecto(page, 'Barrio A');

  // la clave nunca se escribe en el almacenamiento del navegador
  const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(guardado).not.toContain('tokAna');

  await page.getByRole('button', { name: 'Salir', exact: true }).click();                     // botón visible en la pantalla principal
  await dialogo(page).getByRole('button', { name: 'Salir', exact: true }).click();
  const ingreso = page.getByRole('form', { name: 'Ingreso' });
  await expect(ingreso).toBeVisible();
  await expect(page.getByLabel('Usuario', { exact: true })).toHaveValue('Ana');               // recuerda el usuario, nunca la clave
  await expect(page.getByLabel('Clave', { exact: true })).toHaveValue('');
  await page.evaluate(() => { location.hash = '#/ajustes'; });
  await expect(ingreso).toBeVisible();                                                         // sin sesión no hay otra pantalla

  await page.getByLabel('Clave', { exact: true }).fill('tokAna');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva luminaria' })).toBeVisible({ timeout: 15_000 });
});

test('el administrador se ve como superusuario, la primera foto se guarda en Drive con el usuario sellado por el servidor, y se puede desactivar', async ({ browser }) => {
  const b = crearBackend();
  const admin = await telefono(browser, b);
  await configurar(admin.page, enlace({ token: 'tokSup' }));
  await admin.page.getByRole('link', { name: 'Ajustes' }).click();
  await admin.page.getByRole('button', { name: 'Administración (usuarios e IA)' }).click();
  await admin.page.getByRole('button', { name: 'Administrar usuarios' }).click();
  await expect(admin.page.getByTestId('superusuarios')).toContainText('Sup');
  await expect(admin.page.getByTestId('superusuarios')).toContainText('Superusuario');
  expect(await admin.page.getByTestId('superusuarios').textContent()).not.toContain('tokSup');   // nunca la clave

  await admin.page.getByRole('button', { name: 'Volver' }).click();
  await admin.page.getByRole('button', { name: 'Administrar las fotos' }).click();
  const interruptor = admin.page.getByLabel(/Guardar la primera foto/);
  await expect(interruptor).toBeChecked();                                                      // activado por defecto
  await interruptor.uncheck();
  await expect.poll(() => b.gs.hoja('_Config')?.filas.map((f: any[]) => f.join('=')).join('|')).toContain('fotos=no');
  await interruptor.check();
  await expect.poll(() => b.gs.hoja('_Config')?.filas.map((f: any[]) => f.join('=')).join('|')).toContain('fotos=si');

  // un técnico captura con foto y no hizo nada especial: la foto queda en Drive y la fila lleva su usuario
  const ana = await telefono(browser, b);
  await configurar(ana.page, enlace({ tecnico: 'Ana', token: 'tokAna', proyectos: ['Barrio A'] }));
  await usarProyecto(ana.page, 'Barrio A');
  await capturar(ana.page, 'manual');
  await ana.page.getByLabel('Fabricante', { exact: true }).fill('Philips');
  await guardar(ana.page);
  await expect.poll(() => filas(b, 'Barrio A').length, { timeout: 20_000 }).toBe(1);
  expect(filas(b, 'Barrio A')[0]).toMatchObject({ Técnico: 'Ana', Usuario: 'Ana' });
  expect(String(filas(b, 'Barrio A')[0].Foto)).toMatch(/^https:\/\/drive\.test\/.+\.jpg$/);
  expect(b.gs.fotosGuardadas).toHaveLength(1);
});

test('WhatsApp: el administrador envía los datos de acceso al teléfono de la persona; el técnico contacta a su supervisor con el mensaje escrito', async ({ browser }) => {
  const b = crearBackend();
  const admin = await telefono(browser, b);
  await configurar(admin.page, enlace({ token: 'tokSup' }));
  await admin.page.getByRole('link', { name: 'Ajustes' }).click();
  await admin.page.getByRole('button', { name: 'Administración (usuarios e IA)' }).click();
  await admin.page.getByRole('button', { name: 'Administrar usuarios' }).click();

  const crear = async (nombre: string, rolNombre: string | null, tel: string) => {
    await admin.page.getByRole('button', { name: 'Nuevo usuario' }).click();
    await admin.page.getByLabel('Nombre completo').fill(nombre);
    await admin.page.getByLabel('Teléfono (WhatsApp)').fill(tel);
    if (rolNombre) await admin.page.getByRole('tab', { name: rolNombre }).click();
    await admin.page.getByRole('button', { name: 'Crear y ver datos de acceso' }).click();
  };

  await crear('Sara Mejía', 'Supervisor', '+57 311 222 3344');
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await crear('Dina Torres', null, '300 123 4567');                                    // técnica, con celular sin código de país
  const claveDina = (await admin.page.getByTestId('acceso-clave').textContent())!;
  const wa = await admin.page.getByRole('link', { name: /Enviar por WhatsApp a Dina Torres/ }).getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/);                         // el 57 se agrega solo
  const texto = decodeURIComponent(wa!.split('?text=')[1]);
  expect(texto).toContain('Usuario: dtorres'); expect(texto).toContain(`Clave: ${claveDina}`);
  expect(await admin.page.getByRole('link', { name: /Enviar por WhatsApp a Dina Torres/ }).getAttribute('target')).toBe('_blank');

  // el teléfono quedó guardado en la hoja (columna 7) y en la lista
  expect(b.gs.hoja('_Usuarios')!.filas.some((f: any[]) => f[5] === 'dtorres' && f[6] === '300 123 4567')).toBe(true);

  // Dina (técnica) abre Contactos: ve a su supervisora, no a otras personas, y el mensaje sale con su nombre
  const dina = await telefono(browser, b);
  await dina.ctx.route(`${WEB}/servidor.json`, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ proxy: WORKER, codigoPais: '57' }) }));
  await dina.page.goto(WEB + '/');
  await dina.page.getByLabel('Usuario', { exact: true }).fill('dtorres');
  await dina.page.getByLabel('Clave', { exact: true }).fill(claveDina);
  await dina.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(dina.page.getByRole('link', { name: 'Ajustes' })).toBeVisible({ timeout: 15_000 });
  await dina.page.getByRole('link', { name: 'Ajustes' }).click();
  await dina.page.getByRole('button', { name: 'Contactos y WhatsApp' }).click();
  await expect(dina.page.getByRole('region', { name: /Sara Mejía/ }).or(dina.page.locator('[aria-label^="Sara Mejía"]'))).toBeVisible();
  await expect(dina.page.locator('[aria-label^="Dina Torres"]')).toHaveCount(0);
  const hrefSara = await dina.page.locator('[aria-label^="Sara Mejía"]').getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
  expect(hrefSara).toMatch(/^https:\/\/wa\.me\/573112223344\?text=/);
  expect(decodeURIComponent(hrefSara!.split('?text=')[1])).toContain('Hola, soy Dina Torres (ELI-LUMINARIA');
  await expect(dina.page.locator('[aria-label^="Sara Mejía"]').getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:+573112223344');

  // el mensaje se puede editar antes de enviar
  await dina.page.getByLabel('Mensaje').fill('Necesito ayuda con una luminaria');
  expect(decodeURIComponent((await dina.page.locator('[aria-label^="Sara Mejía"]').getByRole('link', { name: 'WhatsApp' }).getAttribute('href'))!.split('?text=')[1])).toBe('Necesito ayuda con una luminaria');
});
