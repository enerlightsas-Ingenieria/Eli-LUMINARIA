# Usuarios y roles (pestaña `_Usuarios`)

El administrador crea a las personas en la hoja de Google. No hace falta editar secretos de Cloudflare ni volver a publicar nada.

## Una sola vez
1. Pega el script nuevo (`server/google-apps-script.gs`) en Apps Script, guarda y **vuelve a implementar** (Implementar → Administrar implementaciones → editar → Nueva versión), manteniendo la misma URL.
2. Recarga la hoja de Google: aparece el menú **ELI-LUMINARIA**. Elige **Preparar pestaña Usuarios**.
3. Autoriza los permisos si Google los pide.

## Crear, cambiar y dar de baja personas
La pestaña `_Usuarios` tiene cuatro columnas:

| Nombre | Rol | Clave | Activo |
|---|---|---|---|
| Ana Pérez | tecnico | (se genera) | si |
| Sofía Ruiz | supervisor | (se genera) | si |

- **Nuevo técnico o supervisor:** añade una fila con nombre y rol, y usa el menú **ELI-LUMINARIA → Generar claves faltantes**.
- **Baja:** pon `no` en *Activo*. Deja de entrar en un minuto como máximo.
- **Rol:** `supervisor` ve el panel del equipo y también puede capturar. Cualquier otro valor se trata como técnico.
- **Clave perdida o filtrada:** borra la celda de *Clave* y vuelve a generar. La anterior deja de servir.

## Darle acceso a la persona
Genera su enlace con su clave y envíaselo en privado:

```
node server/make-config.js --worker https://TU-PROXY.workers.dev --web https://TU-APP.pages.dev --tecnico "Ana Pérez" --token LA-CLAVE-DE-ANA --proyecto "General"
```
Para un supervisor añade `--supervisor`.

## Notas de seguridad
- La hoja contiene las claves: compártela solo con quien administre. Quien edite la hoja puede crear usuarios.
- El nombre que figura en el panel y en los latidos sale de esta pestaña, no de lo que diga el teléfono.
- `APP_TOKENS` y `ADMIN_TOKENS` siguen funcionando si los tienes cargados; puedes dejarlos vacíos.
- El proxy recuerda cada clave `USUARIOS_CACHE_SEG` segundos (60 por defecto) para no consultar la hoja en cada petición.
