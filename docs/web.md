# Versión web (PWA)

La misma aplicación, **dentro del navegador del teléfono o del computador**: sin tiendas, sin instalar APK y **sin costo de cuentas de desarrollador**.
Usa los mismos datos, la misma hoja de Google y las mismas reglas (jornadas, modo terceros, auditoría) que la app móvil; técnicos con la web
y técnicos con la app móvil pueden trabajar en el mismo proyecto a la vez.

## Cómo está organizado el repositorio
```
src/core/    ← NÚCLEO compartido (sin nada de móvil ni de web): sincronización, jornada, análisis con IA, ajustes
src/lib/     ← reglas puras compartidas: geografía, formatos CSV/GeoJSON/KML, estadísticas, fusión, políticas, configuración
src/types.ts
src/…        ← app MÓVIL (Expo) — usa el núcleo mediante envoltorios finos
web/         ← app WEB (Vite + React + TypeScript) — usa el mismo núcleo
server/      ← proxy de Cloudflare (IA + sincronización + panel) y script de Google
```
Una regla de negocio (p. ej. cómo se fusionan los datos de varios técnicos) existe **una sola vez**. Las pruebas del núcleo cubren las dos apps.

## Cómo funciona en el navegador
| Función | En la web |
|---|---|
| Datos sin conexión | IndexedDB (fotos incluidas). La página abre sin internet una vez cargada (service worker). |
| Cámara | Cámara **dentro de la página** (`getUserMedia`): la foto se toma en el momento, no sale de la galería. |
| GPS | GPS del navegador, con precisión visible. Funciona con la página abierta. |
| IA y sincronización | Todo pasa por el **proxy** (`/` y `/sync`): el navegador no conoce la clave de la IA ni el token del script de Google. |
| Enlace de configuración | `https://tu-app/#/config?c=ELI1.…` — **se abre con un toque, también desde WhatsApp**. |
| Panel del equipo | Cuenta de **supervisor** (`--supervisor`): ve quién trabaja, dónde, y la calidad de lo capturado. |
| Jornada | Igual que en el móvil; mantiene la pantalla encendida durante la jornada activa (si el navegador lo permite). |

## Puesta en marcha
1. **Proxy:** ya descrito en `docs/flota.md`; añade estos secretos para la web:
   ```bash
   npx wrangler secret put SYNC_URL          # URL /exec del script de Google
   npx wrangler secret put SYNC_TOKEN        # = TOKEN del script
   npx wrangler secret put ADMIN_TOKENS      # "supervisora:tokenS"  (quienes ven el panel)
   npx wrangler secret put SYNC_TOKEN_ADMIN  # = TOKEN_ADMIN del script
   # opcional: ORIGENES_PERMITIDOS = "https://app.tuempresa.com"
   ```
   Importante: el **nombre** del token en `APP_TOKENS` (p. ej. `ana:tok…`) es quien figura en el panel como presente; usa el mismo nombre
   que el técnico tiene en su perfil (se comparan sin mayúsculas ni acentos).
2. **Compilar la web:**
   ```bash
   cd web && npm ci && npm run build        # genera web/dist (archivos estáticos)
   ```
3. **Publicarla** en cualquier hosting estático con **https** (obligatorio para cámara y GPS): Cloudflare Pages
   (`npx wrangler pages deploy web/dist`), GitHub Pages, Netlify, Vercel… Gratis para este uso. Las rutas son relativas: funciona en la raíz
   de un dominio o en una subcarpeta.
4. **Un enlace por persona:**
   ```bash
   node server/make-config.js --worker https://eli-proxy.TU-CUENTA.workers.dev --web https://app.tuempresa.com \
     --tecnico "Juan Pérez" --token TOKEN_DE_JUAN --proyecto "Barrio A" [--terceros --precision 20]
   node server/make-config.js --worker … --web … --supervisor --token TOKEN_ADMIN_DE_LA_SUPERVISORA   # panel
   ```
   Imprime el enlace web. Se abre con un toque; la app muestra a qué servidores apuntará y pide confirmación.
5. **Instalar en el teléfono** (recomendado): Android/Chrome → menú ⋮ → *Instalar app*; iPhone/Safari → Compartir → *Añadir a pantalla de inicio*.
   La pantalla **Ayuda** de la propia app lo explica.

## Cómo usarla SIN conexión (paso a paso)
1. **Prepárala una sola vez, con internet:** abre la página (o el ícono instalado) y espera el aviso **✅ Lista para trabajar sin conexión**. Tarda unos segundos;
   también lo ves siempre en *Ajustes → Uso sin conexión*. Repite cuando salga una versión nueva (la app avisa: *"Hay una versión nueva · Actualizar"*).
2. **En campo, sin señal:** abre la app desde su ícono. Aparece la banda **📴 Sin conexión**. Puedes **configurarla, capturar, tomar fotos, llenar datos
   (con las opciones rápidas), guardar y editar**. Todo queda en el dispositivo como **Pendiente**; el GPS funciona sin internet.
3. **Al volver la señal:** se envía **solo**, sin que toques nada. Si capturaste sin IA, la lista muestra *"N luminarias sin analizar con IA"* y **tú decides cuándo**
   pulsar *Analizar ahora* (cada análisis consume crédito de la API; no se hace automáticamente). No pisa lo que escribiste a mano.

| | Sin internet |
|---|---|
| Abrir la app, capturar, fotos, GPS, llenar y guardar, editar, buscar, exportar CSV/GeoJSON/KML, jornadas (se registran y se envían después) | ✅ funciona |
| Análisis con IA, sincronización con la hoja, panel del supervisor, **fondo** del mapa | ❌ necesita internet (las luminarias sí se dibujan como puntos) |

**Para que nunca pierdas datos:** en **iPhone** instala la app en la pantalla de inicio (Safari puede borrar páginas sin usar ~7 días); en cualquier teléfono,
sincroniza en cuanto tengas señal y usa *Exportar* como respaldo. Los datos pendientes **sobreviven a cerrar la app y a reiniciar el teléfono**.

## Costos (la web está pensada para no pagar nada fijo)
| Pieza | Costo |
|---|---|
| Alojar la web (Cloudflare Pages / GitHub Pages / Netlify, con su subdominio gratis) | **$0** — planes gratuitos (revisa sus límites actuales; para 2–5 técnicos sobran) |
| Proxy (Cloudflare Workers) | **$0** en el plan gratuito |
| Hoja de Google + script + Drive | **$0** |
| Cuentas de Google Play / Apple | **No se necesitan** (la web no pasa por tiendas) |
| **Análisis con IA** | **Único costo variable**: se paga por uso a Anthropic |

**Cómo controlar el gasto de IA (o dejarlo en cero):**
- *Ajustes → "Usar análisis con IA"*: **apagado = 100 % manual, sin ningún costo de IA** (desaparecen los botones de IA).
- El análisis en lote es **manual** (tú pulsas *Analizar ahora*); nunca se dispara solo al volver la señal.
- Con 1 foto por luminaria cuesta menos que con 3 (general + placa + fotocelda): usa las 3 solo cuando haga falta.
- En *Ajustes → Modelo* puedes probar uno más económico (p. ej. `claude-haiku-5-5`); compara su precisión en el piloto.
- En el proxy: revoca el token de quien no lo necesite y, si quieres, añade el limitador de tasa (`LIMITADOR`). Si la consola de Anthropic lo ofrece, fija un **límite de gasto mensual**.

## Lo que debes saber (honesto)
- **Probado:** extremo a extremo en **Chromium** (cámara y GPS simulados) contra el proxy real y el script real: configuración por enlace, captura con
  IA, sincronización, dos técnicos, sin conexión, jornada + panel, modo terceros, PWA sin conexión (`cd web && npm run e2e`).
  **No probado en dispositivos reales ni en Safari/iPhone**: haz el piloto, sobre todo con un iPhone.
- **iPhone:** instala la app en la pantalla de inicio. Safari puede **borrar los datos locales de páginas sin usar durante ~7 días** si no está instalada;
  una app instalada y la sincronización al día evitan perder nada. Es posible que iOS vuelva a pedir el permiso de ubicación.
- **El navegador no puede** detectar ubicación simulada ni usar el GPS en segundo plano. En modo terceros esas verificaciones las hace la **auditoría del servidor**
  (saltos imposibles, ráfagas, fuera de jornada…). Con la web, la jornada exige **mantener la página abierta** (la pantalla se queda encendida).
- Las fotos elegidas con el selector del sistema (cuando no hay cámara en la página) se marcan como *galería* y el servidor las audita.
- No hay búsqueda automática de dirección: escríbela o déjala vacía (no se envían coordenadas a servicios de terceros).

## Desarrollo
```bash
cd web
npm install
npm run dev            # servidor local (http://localhost:5173)
npm test               # pruebas del almacén (IndexedDB simulada)
npm run build && npm run e2e   # pruebas de navegador (PW_CHROMIUM=/ruta/chromium si no usas el de Playwright)
```
