# Instalar un cliente nuevo (y renovar o suspender su licencia)

Una instalación por cliente: su propio proxy, su propia web, su propia hoja, sus propios tokens.

## 1. Preparar los archivos del cliente
```
node server/nuevo-cliente.js --nombre "Alcaldía de Soacha" --vence 2027-01-31 --contacto "ventas@enerlight.co"
```
Opciones útiles: `--slug`, `--admin "Nombre del administrador inicial"`, `--subdominio` (el de tu cuenta de Cloudflare), `--gracia 15`, `--pais 57`,
`--mapa-calles`, `--mapa-satelite`, `--mapa-atribucion` (fondos de mapa de pago).

Crea la carpeta `clientes/<cliente>/` (está en `.gitignore`: **tiene claves**; guárdala en un gestor de contraseñas):

| Archivo | Contenido |
|---|---|
| `LEEME.txt` | Paso a paso de esa instalación |
| `apps-script.txt` | TOKEN, TOKEN_ADMIN y CARPETA_FOTOS_ID para las *Propiedades del script* |
| `secretos.json` | Secretos del proxy (`wrangler secret bulk`) |
| `cliente.json` | Nombre, vencimiento de la licencia, contacto, nombres del proxy y la web |
| `servidor.json` | Dirección del proxy de ese cliente (va dentro de su web) |
| `1-proxy.ps1`, `2-web.ps1` | Publican el proxy y la web |
| `entrega.txt` | Lo que se le entrega al cliente (dirección, usuario y clave del administrador) |

## 2. Resumen de los pasos (el detalle está en `LEEME.txt`)
1. **Hoja y script de Google:** hoja nueva → Apps Script → pegar `server/google-apps-script.gs` → crear las *Propiedades del script* (`TOKEN`, `TOKEN_ADMIN`, `CARPETA_FOTOS_ID`) → publicar como aplicación web → copiar la URL `/exec`.
2. **Proxy:** `.\clientes\<cliente>\1-proxy.ps1`, luego `npx wrangler secret bulk clientes/<cliente>/secretos.json --name eli-<cliente>-proxy`, y los secretos `SYNC_URL`, `GEMINI_API_KEY` (de pago) y, si aplica, `GOOGLE_GEOCODING_KEY`.
3. **Web:** una vez `npx wrangler pages project create eli-<cliente> --production-branch main`, luego `.\clientes\<cliente>\2-web.ps1`.
4. **Probar** con el administrador de `entrega.txt`: crear un proyecto y un técnico, capturar una luminaria con foto, sincronizar, revisar hoja y carpeta de fotos.
5. **Entregar** `entrega.txt` en privado y capacitar.

## 3. Actualizar el software de un cliente
El código es el mismo para todos. Para publicar una versión nueva a un cliente:
1. Hoja del cliente → Apps Script → pegar el `google-apps-script.gs` nuevo → *Implementar → Gestionar implementaciones → editar → Nueva versión*. (Los tokens y la carpeta de fotos están en *Propiedades del script*, no hay que volver a editarlos.)
2. `.\clientes\<cliente>\1-proxy.ps1` y `.\clientes\<cliente>\2-web.ps1`.

## 4. Renovar la licencia
```
node server/nuevo-cliente.js --renovar <cliente> --vence 2028-01-31
.\clientes\<cliente>\1-proxy.ps1
```
Al instante la app deja de mostrar el aviso y vuelve a permitir enviar datos.

## 5. Suspender por falta de pago
Pon una fecha pasada (por ejemplo la de ayer) con `--renovar <cliente> --vence AAAA-MM-DD`, ejecuta `1-proxy.ps1` y, si además venció la gracia, quedan bloqueados el envío de datos y la IA. Siguen funcionando el ingreso, la consulta y la exportación. Para cortar todo (último recurso, con aviso previo según contrato): borra el proxy del cliente en Cloudflare.

## 6. Qué ve el cliente
- 15 días antes: franja amarilla "La licencia vence el …".
- Después del vencimiento: franja con los días de gracia que quedan.
- Pasada la gracia: franja roja; lo que se capture queda guardado en el teléfono como pendiente y se envía al renovar.
