# ELI-LUMINARIA

App móvil (**Android e iOS**, Expo / React Native + TypeScript) para inventariar luminarias a partir de una foto.
Identifica con IA (Claude visión) las características básicas y las guarda en una tabla junto con la **coordenada GPS**.

## Funciones
- **Captura guiada con 1–3 fotos** (general, placa/etiqueta, fotocelda) → la IA combina las tres para acertar más.
- **Identifica:** fabricante · modelo · tecnología (LED, sodio, metal halide, mercurio, fluorescente, incandescente, halógena,
  inducción, luz mixta u otra) · potencia · tensión · fotocelda y **nº de pines (3/5/7)** · temperatura de color · IP · montaje ·
  estado · observaciones · confianza. Lo que no se ve queda vacío (no inventa); lo deducido por aspecto se marca “(est.)”.
- **GPS** con precisión visible; usa el EXIF si la foto viene de galería; dirección aproximada.
- **Proyectos**: agrupa levantamientos por zona/cliente, con resumen (kW instalados, por tecnología, por pines de fotocelda).
- **Mapa** (OpenStreetMap + satélite, sin claves de API) con marcadores por tecnología y botón “centrar en mí”.
- **Alerta de duplicados** (otra luminaria a < 8 m) y “Guardar y capturar otra” para trabajo en campo.
- **Flotas:** técnico registrado en cada luminaria, configuración de teléfonos por enlace/QR, sincronización automática y proxy de IA con token por técnico (ver `docs/flota.md`).
- **Sincronización de ida y vuelta** con **Google Sheets** (+ fotos en Drive) o tu servidor: varios técnicos, Android e iOS a la vez,
  ven lo que hacen los demás; ediciones y eliminaciones se propagan sin duplicar ni resucitar registros.
- **Monitoreo del equipo:** el técnico inicia/pausa/termina su jornada (con aviso de consentimiento); tú ves en un mapa en vivo quién
  trabaja, quién está sin señal y dónde, más el historial de horas en la hoja. Solo última posición, sin rutas, y nada fuera de la jornada.
- **Técnicos de terceros (modo terceros):** capturas solo con jornada activa, solo cámara, GPS preciso y coordenada no editable; el servidor
  audita cada registro (galería, GPS falso, saltos imposibles, ráfagas, fuera de jornada) y muestra las alertas al supervisor. Sin rastreo en
  segundo plano. Ver `docs/terceros.md`.
- **Sin señal:** foto + GPS offline, opciones rápidas para llenar a mano, “copiar del último registro”, análisis IA que se rinde
  a los 25 s o se omite, y “Re-analizar con IA” cuando vuelve la conexión.
- **Exportar** CSV (Excel), **GeoJSON** (QGIS/ArcGIS) y **KML** (Google Earth).
- **Offline-first** (SQLite local), tema claro/oscuro/automático, accesibilidad (etiquetas, roles), háptica.

## Dos apps, un mismo núcleo
- **App móvil** (Android/iOS, Expo): raíz del repositorio.
- **App web instalable (PWA)**: carpeta `web/` — sin tiendas, sin cuentas de desarrollador y **sin costos fijos**; funciona **sin conexión** y se usa desde el navegador del teléfono. Ver `docs/web.md` (incluye cómo usarla offline y cómo controlar el gasto de IA).
- **Núcleo compartido** en `src/core` y `src/lib`: sincronización, jornada, IA, reglas y formatos existen una sola vez.

## Empezar
**Guía paso a paso (servidor, compilación, teléfonos y lista de verificación del piloto): `docs/puesta-en-marcha.md`.**

## Ejecutar
```bash
npm install
npx expo start            # QR con Expo Go, o: npm run android / npm run ios
npm run typecheck && npm test
```
En **Ajustes** pega tu API key de Anthropic (se guarda en el llavero/Keystore). Sin clave, funciona en modo manual.

## Instalables (Android APK/AAB e iOS IPA)
```bash
npm i -g eas-cli && eas login
eas build -p android --profile preview      # APK para instalar directo
eas build -p android --profile production   # AAB para Google Play
eas build -p ios --profile production       # IPA para TestFlight / App Store (requiere cuenta Apple Developer)
```
Bundle ID / package: `co.enerlight.eliluminaria` (cámbialo en `app.json` si usas otro).

## Seguridad y producción
- No repartas la API key en los teléfonos de una flota: despliega `server/worker.ts` (proxy Cloudflare) y apunta
  *Endpoint* a él; el “API key” de la app pasa a ser un token del equipo.
- La URL de Apps Script queda protegida por un token secreto (ver `docs/google-sheets.md`).
- Los CSV neutralizan inyección de fórmulas (`=`, `+`, `@`).

## Estructura
`App.tsx` (navegación/tema) · `src/screens` · `src/services` (analyzer IA, db SQLite + migraciones, captura, sync, exporter, fotos, settings)
· `src/lib` (geo, formatos, estadísticas, HTML del mapa — lógica pura con pruebas) · `server/` · `docs/` · `__tests__/`.
