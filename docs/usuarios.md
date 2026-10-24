# Usuarios y roles

Hay tres roles. El **administrador** los crea desde la propia app (Ajustes → Administración → Usuarios); no hace falta tocar Cloudflare ni la hoja.

| Rol | Qué puede hacer |
|---|---|
| **Técnico** | Captura, edita y sincroniza sus registros; ve el mapa y sus proyectos. |
| **Supervisor** | Todo lo del técnico **y además** ve el panel del equipo (quién trabaja, dónde, calidad de lo capturado). |
| **Administrador** | Todo lo del supervisor **y además** crea personas, cambia su rol, las da de baja y les entrega su enlace. |

## Primer administrador (una sola vez)
El primer administrador sale de `ADMIN_TOKENS` en Cloudflare (por ejemplo `admin:UNA-CLAVE-LARGA`). Con esa clave abres tu propio enlace, y desde ahí creas a todos los demás desde la app. Después puedes dejar ese secreto como llave de emergencia.

Para activar la administración:
1. Pega el script nuevo (`server/google-apps-script.gs`) en Apps Script conservando tus `TOKEN` y `TOKEN_ADMIN`, y vuelve a implementar (Implementar → Administrar implementaciones → editar → **Nueva versión**; la URL no cambia).
2. Publica el proxy: `npx wrangler deploy server/worker.ts --name eli-luminaria-proxy --compatibility-date 2026-01-01`.
3. Publica la web: `cd web; npm run build; npx wrangler pages deploy dist --project-name eli-luminaria --branch main`.

## Cómo entra la gente: usuario y clave
Nada de enlaces: cada persona abre la dirección de la web (por ejemplo `https://eli-luminaria.pages.dev`), escribe su **usuario** y su **clave**, y entra.
- El **usuario es su nombre** tal como lo creó el administrador. No importan mayúsculas, acentos ni espacios de más (`dario ruiz` = `Darío Ruiz`).
- La app queda lista sola: servidor, cuenta, rol, modo contratista y los proyectos que ya existen en la hoja.
- La primera vez necesita internet. Después trabaja sin conexión.
- Tras 8 intentos fallidos seguidos desde la misma conexión, el ingreso se bloquea unos minutos.
- El enlace directo sigue existiendo como alternativa (útil para dejar un teléfono listo con un toque).

## Día a día
- **Nueva persona:** Ajustes → *Administración (usuarios e IA)* → *Usuarios* → **+** → nombre y rol. La clave puede escribirla el administrador (8 o más caracteres, sin espacios) o, si la deja vacía, el sistema genera una fácil de teclear (`k7mq2-xp9vl`). Pulsa **Crear y ver datos de acceso** y luego **Compartir** (WhatsApp o correo): el mensaje trae dirección, usuario y clave.
- **Contratista:** marca *Contratista (modo terceros)*: exige jornada, cámara y GPS preciso. Lo decide el administrador; la persona no puede quitarlo.
- **Cambiar de rol o clave:** toca la persona, cambia lo que necesites y guarda. El rol se aplica la próxima vez que abra la app con conexión; una clave nueva, al instante.
- **Baja:** desmarca *Con acceso*. Deja de poder ingresar, sincronizar y usar la IA (en un minuto como máximo para quien ya tiene la sesión abierta).
- **Clave olvidada o filtrada:** *Generar clave nueva*. La anterior deja de servir.
- **Salir:** Ajustes → *Cerrar sesión* (los registros guardados en el teléfono se conservan).
- No puedes quitarte a ti mismo el rol de administrador ni darte de baja.

## Inteligencia artificial
En Administración → *Inteligencia artificial* (pantalla aparte) se elige qué IA va primero (Gemini o Claude) y se prueba que funcione. Ver `docs/ia.md`.

## Dónde se guarda
En la pestaña `_Usuarios` de tu hoja de Google (nombre, rol, clave, activo, contratista). La IA elegida está en `_Config`. También puedes editarla a mano (menú **ELI-LUMINARIA → Generar claves faltantes**).

## Seguridad
- Los datos de acceso (y el enlace directo) llevan la clave: envíalos en privado, nunca en un grupo.
- Solo los administradores pueden ver la lista con las claves. La hoja debe compartirse solo con quien administre.
- Los técnicos y supervisores nunca ven el token del script de Google ni la clave de la IA: viven en el servidor.
- El proxy recuerda cada clave `USUARIOS_CACHE_SEG` segundos (60 por defecto).
- `APP_TOKENS` (técnicos en secretos) sigue funcionando si ya lo usabas.
- La administración de usuarios es solo de la web; la app móvil nativa no la incluye.

## Limpiar la hoja de Google
En la hoja: menú **ELI-LUMINARIA → Limpiar pestañas obsoletas**. Muestra la lista y solo borra si aceptas. Propone únicamente:
- pestañas `… (anterior)` (quedaron archivadas al cambiar el diseño de columnas),
- hojas en blanco de Google (`Hoja 1`),
- proyectos sin ningún registro (se recrean solos al sincronizar).

Nunca toca `_Usuarios`, `_Config`, `_Equipo`, `_Jornadas` ni proyectos con registros.

## Empezar de cero
1. **Hoja de Google:** menú **ELI-LUMINARIA → Reiniciar TODO desde cero**. Pide tres confirmaciones (la última, escribir `BORRAR`). Borra todos los proyectos, el monitoreo de jornadas y manda la carpeta de fotos a la papelera de Drive (recuperable 30 días). Pregunta si borrar también la lista de usuarios.
2. **Cada teléfono o navegador:** Ajustes → **Borrar todos los datos de este dispositivo**. Si no se hace, el teléfono conserva sus registros viejos. Después se abre de nuevo el enlace de acceso de esa persona.

## Dirección del servidor en la web publicada
La web trae el servidor de tu empresa en el archivo `web/public/servidor.json` (`{"proxy": "https://…workers.dev"}`). Si cambias de servidor, edítalo y vuelve a publicar la web. Si el archivo falta, la pantalla de ingreso pide la dirección a mano.
