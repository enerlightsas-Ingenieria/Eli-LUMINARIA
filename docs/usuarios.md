# Usuarios y roles

Hay tres roles. El **administrador** los crea desde la propia app (Ajustes → Administración de usuarios); no hace falta tocar Cloudflare ni la hoja.

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

## Día a día
- **Nueva persona:** Ajustes → *Administración de usuarios* → **+** → nombre y rol → *Crear y ver enlace*. Pulsa **Compartir** (WhatsApp, correo) o *Copiar enlace*. La persona lo abre en su teléfono y queda lista; su nombre y su rol vienen del servidor.
- **Contratista:** marca *Contratista (modo terceros)* al crearlo; su enlace exige jornada, cámara y GPS preciso.
- **Cambiar de rol:** toca la persona, elige el rol y *Guardar*. Se aplica la próxima vez que abra la app con conexión.
- **Baja:** desmarca *Con acceso*. Deja de poder sincronizar y usar la IA de inmediato (en un minuto como máximo).
- **Clave filtrada o teléfono perdido:** toca la persona → *Generar clave nueva*. La anterior deja de servir.
- No puedes quitarte a ti mismo el rol de administrador ni darte de baja.

## Dónde se guarda
En la pestaña `_Usuarios` de tu hoja de Google (nombre, rol, clave, activo). También puedes editarla a mano (menú **ELI-LUMINARIA → Generar claves faltantes**).

## Seguridad
- El enlace de cada persona contiene su clave: envíalo en privado, nunca en un grupo.
- Solo los administradores pueden ver la lista con las claves. La hoja debe compartirse solo con quien administre.
- Los técnicos y supervisores nunca ven el token del script de Google ni la clave de la IA: viven en el servidor.
- El proxy recuerda cada clave `USUARIOS_CACHE_SEG` segundos (60 por defecto).
- `APP_TOKENS` (técnicos en secretos) sigue funcionando si ya lo usabas.
- La administración de usuarios es solo de la web; la app móvil nativa no la incluye.
