# Despliegue para una flota de técnicos

## Arquitectura
```
Teléfono del técnico ──(foto, token propio)──▶ Proxy Cloudflare ──▶ Claude (visión)
        │  SQLite local (offline)                  └ guarda la API key; revoca por técnico
        └──(datos, token de equipo)──▶ Google Apps Script ──▶ Google Sheets (+ fotos en Drive)
```
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
   (1 mensaje, ≤ 3 imágenes, herramienta `registrar_luminaria`, modelo permitido, `max_tokens` ≤ 1500) y registra
   el técnico de cada llamada. Opcional: añade un binding `LIMITADOR` de Cloudflare Rate Limiting.
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
- No hay panel central de control de flota (quién sincronizó qué y cuándo): la hoja y los logs del proxy son la fuente.
- Nada de esto se ha probado todavía con dispositivos reales: haz un piloto con 2–3 técnicos antes de desplegar a todos.
