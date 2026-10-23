# Despliegue para una flota de técnicos

## Arquitectura
```
Teléfono del técnico ──(foto, token propio)──▶ Proxy Cloudflare ──▶ Claude (visión)
  (Android o iOS)    │  SQLite local (offline)         └ guarda la API key; revoca por técnico
                     └──(datos, token de equipo)◀──▶ Google Apps Script ◀──▶ Google Sheets (+ fotos en Drive)
```
La sincronización es **de ida y vuelta**: cada teléfono sube lo suyo y baja lo que hicieron los demás técnicos
(registros nuevos, ediciones y eliminaciones). Android e iOS usan exactamente el mismo flujo.
La API key de Anthropic **nunca** llega a los teléfonos. Los técnicos trabajan sin cobertura; cuando vuelve la
conexión la app sincroniza sola (al guardar, al volver a abrirla y cada vez que cambia lo pendiente).

## Puesta en marcha (una vez, ~30 min)
1. **Proxy de IA** — `server/worker.ts`
   ```bash
   npx wrangler deploy server/worker.ts --name eli-luminaria-proxy --compatibility-date 2026-01-01
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put APP_TOKENS        # juan:tokenDeJuan,ana:tokenDeAna   (uno por técnico)
   ```
   Genera cada token con `openssl rand -base64 24`. El proxy sólo acepta peticiones con la forma exacta de la app
   (la herramienta `registrar_luminaria` con su esquema conocido, `tool_choice` forzado, 1–3 imágenes JPEG, ≤ 5 000 caracteres de
   texto, modelo permitido, `max_tokens` ≤ 1500) y registra el técnico de cada llamada. Aun así, quien tenga un token puede enviar
   fotos y un texto corto: el limitador de tasa (abajo) acota el abuso residual. Si cambias la herramienta en `analyzer.ts`, actualiza
   `PROPIEDADES` en `server/worker.ts` (una prueba comprueba que coinciden). Opcional: añade un binding `LIMITADOR` de Cloudflare Rate Limiting.
2. **Hoja compartida** — sigue `docs/google-sheets.md` (token de equipo en `TOKEN`). Todos los técnicos escriben en
   la misma hoja; la columna **Técnico** dice quién hizo cada registro y los proyectos con el mismo nombre comparten pestaña.
3. **Compila la app** una sola vez para todos (`eas build`, ver README).
4. **Configura cada teléfono con un enlace** (sin teclear claves):
   ```bash
   node server/make-config.js --org "Mi Empresa" --tecnico "Juan Pérez" \
     --endpoint https://eli-luminaria-proxy.TU-CUENTA.workers.dev --token tokenDeJuan \
     --sync-url https://script.google.com/macros/s/XXXX/exec --sync-token TOKEN_DE_EQUIPO \
     --proyecto "Barrio A" --proyecto "Barrio B"
   ```
   Envía el enlace `eliluminaria://config?c=…` por correo/WhatsApp (o conviértelo en QR). Al abrirlo, la app muestra a
   qué servidores apuntará y pide confirmación; luego crea los proyectos. También puede pegarse en Ajustes.

## Trabajo en equipo en el mismo proyecto
- **Cada luminaria tiene un identificador único** (UUID): dos técnicos nunca se pisan ni se duplican filas, aunque
  sincronicen a la vez. El script procesa las peticiones de una en una.
- **El proyecto se une por nombre** sin importar mayúsculas ni espacios repetidos ("Barrio A" = "barrio  a").
  Lo ideal es crear los proyectos con el enlace de configuración para que todos usen el mismo nombre.
- **Lo que hace cada técnico aparece en los teléfonos de los demás** (mapa, lista y alerta de duplicados incluidos).
  Se actualiza al sincronizar, al volver a abrir la app y al tirar de la lista hacia abajo. Las fotos no se descargan:
  quedan en el teléfono de quien las tomó (y en Drive si activas "Incluir la primera foto").
- **Ediciones:** cualquier técnico puede editar un registro de otro. Si dos editan lo mismo, **gana la última
  versión que llegue a la hoja**. Un cambio que aún no se ha enviado no se pisa al descargar.
- **Eliminaciones:** se propagan a todos. En la hoja la fila **no se borra**: queda marcada `Eliminada = SÍ` para auditoría
  (filtra esa columna). Lo eliminado gana sobre una edición simultánea. Borrar un *proyecto* en un teléfono solo lo quita de
  ese teléfono, nunca de la hoja ni de los demás.
- **Sin señal:** el técnico captura (foto + GPS funcionan sin internet), llena los datos con opciones rápidas o
  "Copiar datos del último registro", y todo se envía solo al volver la conexión. La IA necesita internet; el análisis
  se rinde a los 25 s con señal pobre y se puede omitir. Con señal, "Re-analizar con IA" rellena lo pendiente.
- La numeración `#12` es **local de cada teléfono**; para referirse a una luminaria entre técnicos usa el **Código del activo**.

## Monitoreo del equipo: quién trabaja y dónde
Cada técnico usa el botón **Iniciar jornada** (en la lista de luminarias). Mientras la jornada esté activa y la app abierta, la app
envía cada 5 minutos su ubicación aproximada, la hora y cuántas luminarias lleva.

- **Tú lo ves** en el mapa en vivo (`?vista=equipo&token=<TOKEN_ADMIN>`, ver `docs/google-sheets.md`) y en las pestañas
  `_Equipo` (estado actual de cada técnico) y `_Jornadas` (historial de horas).
- **Estados:** *En jornada*, *Sin señal* (activa pero sin latidos por más de 15 min: sin cobertura, teléfono bloqueado o app cerrada),
  *Pausada* y *Terminada*.
- **El técnico controla y ve todo:** acepta un aviso la primera vez, ve siempre una tarjeta "Jornada activa", puede **pausar**
  (almuerzo) o **terminar**; en pausa y al terminar la app **ni consulta el GPS** y se borra su última posición del servidor.
  Una jornada olvidada se cierra sola a las 14 h.
- **Solo con la app abierta (no en segundo plano):** si el técnico bloquea el teléfono o abre otra app, los latidos se detienen y
  verás *Sin señal*; se reanudan al volver a la app. Es la contrapartida de no pedir el permiso de ubicación en segundo plano
  (menos batería, menos fricción con Google Play y App Store). Pídeles que mantengan la app abierta durante la jornada.
- **Aviso legal:** informa a los técnicos y obtén su aceptación por escrito según la normativa laboral y de protección de datos
  de tu país (en Colombia, habeas data / Ley 1581). La app solo mide durante la jornada, pero la política es tuya.

## Técnicos de terceros
Para contratistas que trabajan en el horario que ellos eligen, usa el **modo terceros** (`--terceros` en `make-config.js`): verifica cada captura
sin seguirlos fuera de su jornada. Detalle, alertas, cláusulas y notas de tiendas en `docs/terceros.md`.

## Android e iOS a la vez
- Misma app, mismos datos y misma hoja. Un técnico con iPhone y otro con Android ven los mismos registros.
- **Fotos de galería:** iOS suele conservar el GPS de la foto; **Android normalmente lo elimina**. La app lo detecta y usa tu
  ubicación actual avisándote. Para coordenadas fiables, capturar con la cámara de la app.
- Menús y avisos están hechos para ambos sistemas (Android recorta los diálogos a 3 botones; la app usa menús propios).

## Distribución
- **Android:** `eas build -p android --profile preview` da un APK que se instala por enlace; para control central usa
  Google Play (publicación privada) o tu MDM (Intune, Workspace ONE, Google Endpoint).
- **iOS:** TestFlight (hasta 10 000 testers) o App Store privada / Apple Business Manager. Requiere cuenta Apple Developer.

## Operación
| Situación | Qué hacer |
|---|---|
| Técnico se va / teléfono perdido | Quita su `nombre:token` de `APP_TOKENS` (`wrangler secret put`): deja de poder usar la IA al instante. |
| Rotar el token de la hoja | Cambia `TOKEN` en el script, redepliega y envía un enlace nuevo a la flota. |
| Dos técnicos en la misma luminaria | La app avisa si hay otra a < 8 m en *su* teléfono; en la hoja, filtra por coordenadas/código. |
| Auditar consumo de IA | `wrangler tail` o los logs del Worker (técnico, estado, modelo; **no** guarda imágenes). |

## Privacidad y límites (léelo antes de salir a campo)
- Las fotos y la ubicación pasan por tu proxy a Anthropic para el análisis y a tu Google Sheets/Drive al sincronizar.
  Informa a tus técnicos y revisa la política de tu cliente (alumbrado público suele ser información no sensible, pero valida).
- El token de la hoja es **compartido** por el equipo: protege el acceso pero no distingue técnicos al escribir
  (el nombre del técnico lo declara la app). Si necesitas autenticación individual y roles, hay que añadir un backend propio
  (la app ya habla con cualquier servidor que cumpla el contrato descrito en `docs/google-sheets.md`).
- El panel de flota es el mapa en vivo y las pestañas `_Equipo` / `_Jornadas`; el consumo de IA se audita en los logs del proxy.
- Google Apps Script tiene cuotas diarias y un límite de ejecuciones simultáneas; para decenas de técnicos sincronizando
  muy seguido, considera un backend propio (la app habla con cualquiera que cumpla el contrato de `docs/google-sheets.md`).
- Nada de esto se ha probado todavía con dispositivos reales: haz un piloto con 2–3 técnicos antes de desplegar a todos.
