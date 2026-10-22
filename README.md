# ELI-LUMINARIA

App móvil (Android / iOS) para inventariar luminarias a partir de una foto. Identifica con IA (Claude visión)
las características básicas y las guarda en una tabla junto con la **coordenada GPS**.

## Qué identifica
Marca · fabricante · modelo · tipo de luminaria · tecnología (LED, sodio, mercurio, metal halide…) · potencia (W) ·
tensión · fotocelda (tipo y **nº de pines: 3/5/7**) · temperatura de color · flujo luminoso · IP · montaje · estado ·
observaciones · nivel de confianza. Lo que no se ve en la foto se deja vacío (no se inventa); los valores deducidos
sólo por aspecto se marcan "(est.)". Todo es editable antes de guardar.

## Flujo
1. **Nueva** → cámara o galería.
2. La app toma la coordenada (GPS, o el EXIF de la foto si viene de galería) y la dirección aproximada.
3. La foto se reduce y se envía a Claude → formulario prellenado.
4. Revisas/corriges → **Guardar** (SQLite local, offline).
5. **Exportar CSV** (UTF‑8 con BOM, abre bien en Excel) con latitud, longitud, enlace a mapa y todos los datos.

## Ejecutar
```bash
npm install
npx expo start        # escanea el QR con Expo Go, o: npm run android / npm run ios
```
En **Ajustes** pega tu API key de Anthropic (se guarda en el almacén seguro del teléfono). Sin clave, la app
funciona en modo manual.

## Generar APK / instalable
```bash
npm i -g eas-cli && eas login
eas build -p android --profile preview   # APK instalable
eas build -p ios --profile production
```

## Notas
- **Seguridad:** para uso en producción/flota, apunta el campo *Endpoint* a tu propio proxy que guarde la clave
  en servidor; no distribuyas la API key en los teléfonos.
- La IA es una ayuda: la confianza depende de la foto (etiqueta/placa legible, receptáculo de fotocelda visible).
  Para mejores resultados toma una foto general y otra cercana a la placa.
- Estructura: `src/services` (analyzer IA, db SQLite, captura cámara/GPS, exporter CSV, settings), `src/screens`, `App.tsx`.
