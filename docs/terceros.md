# Supervisión de técnicos de terceros (modo terceros)

Objetivo: tener **evidencia de que cada luminaria se georreferenció donde y cuando se dice**, sin seguir a la persona todo el día.
Diseñado para minimizar implicaciones legales y fricción en Google Play y App Store: **no usa ubicación en segundo plano**.

## Cómo se configura
Genera el enlace de cada tercero con el modo activado y envíaselo (ver `docs/flota.md`):
```bash
node server/make-config.js --org "Mi Empresa" --tecnico "Juan Pérez" --terceros --precision 20 \
  --endpoint https://… --token … --sync-url https://script.google.com/macros/s/XXXX/exec --sync-token … --proyecto "Barrio A"
```
Al abrir el enlace, la app **le muestra al técnico exactamente qué reglas acepta** antes de importarlas.

## Qué exige la app (modo terceros)
| Regla | Efecto |
|---|---|
| **Jornada activa** | Sin jornada iniciada (o en pausa) no se puede capturar: la pantalla pide iniciarla. El tercero decide *cuándo* trabaja; no hay horario impuesto. |
| **Solo cámara** | Se oculta la galería: la foto se toma en el momento y lugar. |
| **GPS preciso** | Se exige ±N m (por defecto 20; 5–100 con `--precision`). Se mide de nuevo justo al capturar; si es peor, se reintenta solo hasta lograrlo. |
| **Sin ubicación simulada** | Si Android marca la ubicación como simulada (app de GPS falso), se bloquea. *iOS no expone este dato.* |
| **Coordenada no editable** | La registra el GPS; el técnico no puede teclearla. |

## Qué audita el servidor (segundo candado)
Una app modificada podría saltarse las reglas de arriba, así que el script de Google **revisa cada captura** y escribe la columna
**Alertas** en la hoja (y las cuenta por técnico en el mapa en vivo). Son avisos para el supervisor, no veredictos.

| Código | Significa |
|---|---|
| `GALERIA` | La foto no se tomó con la cámara de la app. |
| `SIN_JORNADA` | Se capturó sin jornada activa. |
| `JORNADA_NO_CONFIRMADA` | Trae una jornada que el servidor aún no conoce (suele resolverse sola al sincronizar; ver *Auditoría periódica*). |
| `FUERA_DE_JORNADA` | La hora de captura cae antes del inicio o después del fin de su jornada (margen de 2 min). |
| `UBICACION_SIMULADA` | Android detectó GPS falso. |
| `GPS_IMPRECISO` | Precisión peor que 25 m (`LIMITE_PRECISION_M`). |
| `SALTO_IMPOSIBLE` | Dos capturas del mismo técnico a más de 120 km/h entre sí (con >300 m de distancia). |
| `AGRUPADAS` | 4 o más capturas del mismo técnico en un radio de 3 m dentro de 10 min (posible relleno de datos). |

Todos los umbrales están al inicio del script. Revisa la hoja filtrando la columna **Alertas** ≠ vacío.
**Auditoría periódica (recomendado):** en Apps Script → *Activadores* → añade `auditarTodo` con activador **por tiempo, cada 15 min**,
para que las alertas provisionales (`JORNADA_NO_CONFIRMADA`) se resuelvan cuando llegan las jornadas atrasadas.

## Lo que NO hace (a propósito)
- No rastrea fuera de la jornada ni en segundo plano; con la app cerrada o el teléfono bloqueado no se envía nada.
- No guarda historial de rutas: solo la última posición durante la jornada, que se borra al pausar o terminar.
- No impide por sí sola el fraude de un cliente modificado, de un teléfono con hora cambiada o de un dispositivo con root/jailbreak;
  por eso existe la auditoría del servidor, que revisa coherencia (saltos, ráfagas, jornadas) y no depende solo del teléfono.
- No detecta ubicación simulada en iOS (por lo general requiere herramientas de desarrollo o jailbreak).
- No sustituye la revisión de calidad: ante alertas, pide fotos adicionales o muestrea en campo.

## Implicaciones legales: puntos a cuidar *(no es asesoría legal; valida con tu abogado)*
- **Proporcionalidad:** se mide solo durante el trabajo y solo lo necesario (ubicación al capturar y durante la jornada).
- **Consentimiento e información:** el tercero debe aceptar de forma previa, expresa e informada el tratamiento (en Colombia, Ley 1581 de 2012).
  La app muestra un aviso y las reglas; **incluye además cláusulas en el contrato** (ver abajo).
- **Independencia del contratista:** no impongas horarios ni exijas estar "en línea" para evitar indicios de subordinación; lo que se
  supervisa es el **resultado** (capturas verificables), no su disponibilidad. Revisa este punto específicamente con tu asesor.
- **Retención y acceso:** define cuánto tiempo guardas la hoja y quién tiene el token administrador.

**Cláusulas sugeridas para el contrato:** finalidad (verificar la georreferenciación entregada); datos tratados (foto, hora, ubicación al
capturar, ubicación durante la jornada activa); cuándo se recogen (solo con jornada activa y app abierta); quién accede; plazo de
conservación; derechos del titular y canal para ejercerlos; que el tercero puede pausar/terminar la jornada cuando quiera.

## Tiendas (Android e iOS)
- La app solicita **ubicación solo "mientras se usa"** y cámara; no pide `ACCESS_BACKGROUND_LOCATION` ni modos de fondo en iOS. Esto evita las
  revisiones más estrictas de ambas tiendas.
- Prepara una **política de privacidad** pública y completa el formulario de seguridad de datos de Play ("Data safety": ubicación precisa,
  fotos; finalidad: funcionalidad de la app; se comparten con el servidor de tu empresa) y las etiquetas de privacidad de App Store
  (ubicación precisa y fotos, vinculadas al usuario). Revisa los formularios vigentes de cada tienda al publicar.
- Para equipos pequeños, distribuir por TestFlight / APK interno evita en buena parte la revisión pública.
