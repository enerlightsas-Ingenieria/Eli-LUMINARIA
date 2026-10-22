# Sincronizar con Google Sheets

1. Crea una hoja de cálculo nueva en Google Sheets (será tu "base de datos" compartida).
2. Menú **Extensiones → Apps Script**. Borra el contenido y pega `server/google-apps-script.gs`.
3. Cambia `TOKEN` por una clave larga y aleatoria (la misma que pondrás en la app).
4. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona** (el token protege el acceso)
5. Autoriza los permisos (Hojas de cálculo y Drive) y copia la URL que termina en `/exec`.
6. En la app: **Ajustes → Sincronización** → pega la URL y el token → *Guardar* → *Sincronizar ahora*.

> **Actualizaciones del script:** cada vez que cambies `server/google-apps-script.gs` hay que **volver a implementar**
> (Implementar → Administrar implementaciones → editar → Nueva versión). Si ya tenías una hoja creada con una versión
> anterior del script, bórrala o crea una pestaña nueva: las columnas cambiaron (Técnico, Eliminada, Recibido).

Cada **proyecto** crea su propia pestaña (sin distinguir mayúsculas ni espacios repetidos). Cada luminaria tiene un `UUID`, así que sincronizar de nuevo
**actualiza** la fila en vez de duplicarla. Si activas *Incluir la primera foto*, se guarda en la carpeta
de Drive `ELI-LUMINARIA Fotos` y la hoja muestra el enlace.

Varios técnicos (Android e iOS) sincronizan a la misma hoja **y reciben lo de los demás**. Las luminarias eliminadas
quedan en la hoja con `Eliminada = SÍ` (no se borra la fila). La columna **Recibido** es la hora del servidor y es la que
ordena los cambios; no dependas de los relojes de los teléfonos. Las columnas de texto se guardan como texto para que
Sheets no convierta modelos como `1-2` en fechas.

## Servidor propio
La app hace `POST` (JSON) a la URL con:
- Subida: `{ token, proyecto:{uuid,nombre,cliente}, luminarias:[...], borradas:[uuid] }` → `{ ok:true }` (upsert por `uuid`;
  lo borrado gana sobre ediciones posteriores).
- Descarga: `{ token, proyecto:{...}, accion:'listar', desde:'<ISO>' }` → `{ ok:true, ahora:'<ISO del servidor>', luminarias:[{uuid, eliminada, ...campos}] }`
  con todo lo recibido desde `desde` (inclusive). La app guarda `ahora` como siguiente cursor.

## Proxy de IA (recomendado para flotas)
`server/worker.ts` es un Cloudflare Worker que guarda la API key de Anthropic en el servidor.
Despliégalo, define `ANTHROPIC_API_KEY` y `APP_TOKENS`, y en la app pon su URL en *Endpoint* y el token del equipo
en *API key*.
