# Puesta en marcha: de cero a piloto

Tiempo estimado: 1–2 horas la primera vez. Orden recomendado.

## 0. Claves y accesos que vas a manejar
| Qué | Dónde vive | Quién la usa |
|---|---|---|
| API key de Anthropic | Solo en el proxy (Cloudflare) | Nadie más |
| Clave del técnico | Pestaña `_Usuarios` de la hoja (ver `docs/usuarios.md`) + el enlace de cada persona | Cada persona (revocable) |
| `TOKEN` del equipo | Script de Google + enlace de configuración | Todos los teléfonos |
| `TOKEN_ADMIN` | Solo en el script de Google | **Solo tú** (mapa en vivo) |

Genera cada token con `openssl rand -base64 24`. No reutilices unos por otros.

## 1. Servidor (≈ 30 min)
1. **Proxy de IA** → `docs/flota.md` §Puesta en marcha (paso 1).
2. **Hoja de Google + script** → `docs/google-sheets.md`: pega `server/google-apps-script.gs`, define `TOKEN` y `TOKEN_ADMIN`,
   implementa como aplicación web, y añade el activador por tiempo `auditarTodo` (cada 15 min).
3. **Comprueba la hoja:** abre `<URL /exec>?vista=equipo&token=<TOKEN_ADMIN>`; debe cargar el mapa vacío ("Aún no hay técnicos con jornada").

## 1b. Versión web (opcional, sin tiendas)
Si prefieres que se use desde el navegador, añade los secretos `SYNC_URL`, `SYNC_TOKEN`, `ADMIN_TOKENS` y `SYNC_TOKEN_ADMIN` al proxy, compila `web/` y publícala en un hosting estático con https: `docs/web.md`. Los enlaces de configuración web (`--worker --web`) funcionan al tocarlos, incluso desde WhatsApp.

## 2. Compilar la app móvil (≈ 30 min + espera de las compilaciones)
```bash
npm install && npm run typecheck && npm test
npm i -g eas-cli && eas login
eas build -p android --profile preview     # APK para instalar directo
eas build -p ios --profile production      # IPA → TestFlight (requiere cuenta Apple Developer)
```
Si ningún técnico usa iPhone, omite la compilación de iOS.

## 3. Configurar los teléfonos
Un enlace por técnico (ver `docs/flota.md` y, para contratistas, `docs/terceros.md`):
```bash
node server/make-config.js --org "Mi Empresa" --tecnico "Juan Pérez" \
  --endpoint https://eli-luminaria-proxy.TU-CUENTA.workers.dev --token TOKEN_DE_JUAN \
  --sync-url https://script.google.com/macros/s/XXXX/exec --sync-token TOKEN_DEL_EQUIPO \
  --proyecto "Barrio A" [--terceros --precision 20]
```
> **Ojo:** WhatsApp y muchos correos **no convierten** `eliluminaria://…` en un enlace tocable. Si pasa, envía el **código** (`ELI1.…`) y
> que el técnico lo pegue en **Ajustes → Código de configuración → Importar**. Funciona igual.

## 4. Piloto con 2–3 técnicos (1 con iPhone y 1 con Android, si es posible)
Marca cada punto. Lo que **no** está probado todavía en dispositivos reales está señalado con ⚠.

**Instalación y configuración**
- [ ] Instalan la app; importan el código; ven la lista de lo que aceptan; los proyectos se crean solos.
- [ ] El nombre del técnico aparece en **Ajustes**.

**Captura (con señal)**
- [ ] Foto general + placa + fotocelda → "Analizar con IA" rellena marca, potencia, pines… (anota los aciertos/errores).
- [ ] La coordenada y su precisión son razonables; la dirección aparece.
- [ ] Guardar → aparece en la hoja (pestaña del proyecto) con técnico, coordenada y enlace al mapa.

**Sin señal**
- [ ] Modo avión: capturan, llenan con las opciones rápidas / "Copiar datos del último registro" y guardan.
- [ ] Al volver la señal se envía solo (la etiqueta "Pendiente" desaparece) y no se duplica en la hoja.
- [ ] ⚠ Con señal muy débil, "Omitir y llenar manualmente" aparece y funciona.

**Equipo**
- [ ] Dos técnicos en el mismo proyecto: tirar de la lista hacia abajo muestra lo del otro (también en el mapa).
- [ ] Editar y eliminar un registro se refleja en el otro teléfono; en la hoja la fila eliminada queda con `Eliminada = SÍ`.

**Jornada y mapa en vivo**
- [ ] Iniciar jornada (aviso la primera vez) → en pocos segundos aparece en el mapa en vivo.
- [ ] ⚠ Bloquear el teléfono 20 min → pasa a "Sin señal"; al volver a la app se recupera.
- [ ] Pausar y terminar: desaparece su posición del mapa; `_Jornadas` muestra las horas.

**Modo terceros** *(solo en los teléfonos configurados con `--terceros`)*
- [ ] Sin jornada, no deja capturar. No hay opción de galería. Las coordenadas no se pueden editar.
- [ ] ⚠ Dentro de un edificio (GPS pobre) bloquea con el mensaje de precisión y reintenta solo al salir.
- [ ] ⚠ Android: activar "ubicación simulada" en opciones de desarrollador → bloquea la captura.
- [ ] Desde un teléfono **sin** modo terceros, captura con una foto de galería y sin jornada → en la hoja aparecen `GALERIA` y `SIN_JORNADA`.

**Plataforma**
- [ ] ⚠ **Android:** al escribir en el formulario de edición, el teclado no tapa el campo que se escribe (el punto que más me preocupa).
- [ ] ⚠ iPhone: los campos numéricos se pueden cerrar arrastrando el formulario.
- [ ] El mapa de la app carga (necesita internet); "Abrir en mapa" abre la app de mapas del teléfono.
- [ ] Exportar CSV abre bien en Excel (acentos); GeoJSON abre en QGIS; KML en Google Earth.

**Seguridad**
- [ ] Quita el token de un técnico de `APP_TOKENS` → su "Analizar con IA" falla con "API key inválida (401)" y el resto del equipo sigue.
- [ ] Un token de equipo incorrecto: la sincronización falla con "Token inválido" y no se pierde nada local.

## 5. Después del piloto
Anota: ¿±20 m es demasiado estricto? ¿5 min entre latidos? ¿Qué campos falla la IA? Todo es ajustable
(`--precision`, `INTERVALO_MS`, `MINUTOS_SIN_SENAL`, umbrales de alertas) y me los puedes pasar para ajustarlos.

## Mantenimiento
- **Actualizar la app:** nueva compilación con `eas build`; los datos locales se migran solos (esquema versionado).
- **Actualizar el script de Google:** pegar y **volver a implementar** (Nueva versión). Los cambios de columnas se avisan en el changelog del commit.
- **Respaldo:** la hoja de Google es la copia central; exporta el libro de vez en cuando (Archivo → Descargar).
