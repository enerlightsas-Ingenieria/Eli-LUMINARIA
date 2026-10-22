# Sincronizar con Google Sheets

1. Crea una hoja de cálculo nueva en Google Sheets (será tu "base de datos" compartida).
2. Menú **Extensiones → Apps Script**. Borra el contenido y pega `server/google-apps-script.gs`.
3. Cambia `TOKEN` por una clave larga y aleatoria (la misma que pondrás en la app).
4. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona** (el token protege el acceso)
5. Autoriza los permisos (Hojas de cálculo y Drive) y copia la URL que termina en `/exec`.
6. En la app: **Ajustes → Sincronización** → pega la URL y el token → *Guardar* → *Sincronizar ahora*.

Cada **proyecto** crea su propia pestaña. Cada luminaria tiene un `UUID`, así que sincronizar de nuevo
**actualiza** la fila en vez de duplicarla. Si activas *Incluir la primera foto*, se guarda en la carpeta
de Drive `ELI-LUMINARIA Fotos` y la hoja muestra el enlace.

Varios técnicos pueden sincronizar a la misma hoja (cada teléfono envía sus propios registros).

## Servidor propio
La app hace un `POST` (JSON) a la URL con `{ token, proyecto:{uuid,nombre,cliente}, luminarias:[...] }` y
espera `{ "ok": true }`. Cualquier backend que cumpla eso sirve (upsert por `uuid`).

## Proxy de IA (recomendado para flotas)
`server/worker.ts` es un Cloudflare Worker que guarda la API key de Anthropic en el servidor.
Despliégalo, define `ANTHROPIC_API_KEY` y `APP_TOKENS`, y en la app pon su URL en *Endpoint* y el token del equipo
en *API key*.
