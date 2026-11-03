# Modelo comercial

## 1. Qué se vende
**Licencia de uso con suscripción (SaaS por cliente).** El cliente no compra el código: contrata el derecho de usar la aplicación por un plazo, con alojamiento, soporte y actualizaciones.

| Opción | Qué recibe el cliente | Control | Cuándo |
|---|---|---|---|
| Licencia + suscripción (recomendada) | Uso por plazo, soporte, mejoras | Total: puedes suspender el servicio | Casi siempre |
| Venta del software (cesión de derechos) | Propiedad | Ninguno después de cobrar | Solo si decides salir del negocio |
| Código en custodia (escrow) | Acceso al código solo si ENERLIGHT desaparece o incumple gravemente | Total | Si una entidad exige garantía de continuidad |

La cesión de derechos de autor exige formalidades; consulta a tu abogado antes de ofrecerla.

## 2. Cómo cobrar
1. **Implementación (una vez):** instalación, configuración, carga de usuarios y proyectos, capacitación.
2. **Suscripción (mensual o anual, anticipada):** elige UN criterio fácil de medir: usuarios activos, proyectos activos o luminarias registradas por año.
3. **Soporte y mejoras:** incluye un nivel (por ejemplo, horario de oficina y respuesta en 1 día hábil); lo demás, por horas o por proyecto.
4. **Costos que pasan al cliente:** IA y direcciones de pago si el volumen es alto, almacenamiento extra de Drive.

**Cómo fijar el precio:** suma tus costos por cliente al mes (Cloudflare, Google Workspace/Drive si aplica, IA, geocodificación, mapas, tu tiempo de soporte), agrega tu margen y contrasta con lo que le ahorra al cliente cada luminaria levantada frente a hacerlo en papel o Excel. Prueba el precio con un cliente piloto antes de publicarlo.

## 3. Cómo se entrega
**Una instalación por cliente, en tus cuentas** (guía paso a paso: [instalacion-cliente.md](instalacion-cliente.md)):
- Proxy y web en **tu** cuenta de Cloudflare, con nombre propio por cliente (`eli-<cliente>-proxy`, `eli-<cliente>`).
- Hoja de Google y carpeta de fotos en la cuenta del cliente (sus datos son suyos) o en la tuya, según lo pactado.
- Tokens y claves distintos para cada cliente (los genera `node server/nuevo-cliente.js`).
- Dominio propio opcional (`app.cliente.gov.co` apuntando a su web).

## 4. Control si no pagan
- La licencia se controla en **tu proxy** (`LICENCIA_VENCE`): 15 días antes la app avisa; al vencer hay 15 días de gracia con aviso; pasada la gracia se bloquea enviar datos y usar la IA. Se puede seguir entrando, consultando y **exportando** lo ya guardado.
- Renovar: `node server/nuevo-cliente.js --renovar <cliente> --vence AAAA-MM-DD` y ejecutar `1-proxy.ps1`. Suspender ya: poner una fecha pasada y ejecutar el mismo script.
- No entregues código, cuentas de Cloudflare ni los secretos del proxy: ahí está tu control.
- En el contrato: pago anticipado, mora, suspensión, exportación de datos al terminar. No retengas los datos del cliente como presión.

## 5. Proceso de venta sugerido
1. Demo de 30 minutos con datos de ejemplo.
2. Piloto pagado y corto (4–8 semanas, 2–3 técnicos, un proyecto) con criterios de éxito escritos.
3. Propuesta con alcance, precio, plazo, soporte y condiciones de pago.
4. Contrato de licencia + política de datos firmada.
5. Instalación, capacitación y seguimiento a los 15 y 30 días.
6. Renovación: recordatorio 60 días antes, factura 30 días antes.

## 6. Entidades públicas
Suelen contratar por procesos formales (SECOP, RUP, pólizas, estudios previos). Averigua con un abogado qué modalidad aplica a tu valor antes de ofertar. Prepárate para preguntas de seguridad (dónde están los datos, copias de respaldo, acceso), portabilidad de datos y continuidad del servicio.

## 7. Cumplimiento
- **Propiedad:** que ENERLIGHT SAS sea la titular del software; registra la obra ante la Dirección Nacional de Derecho de Autor.
- **Datos personales (Ley 1581 de 2012):** la aplicación guarda nombres, teléfonos y ubicación. Define quién es responsable y quién encargado, publica la política de tratamiento y obtén la autorización de los técnicos ([politica-datos-modelo.md](politica-datos-modelo.md)). Verifica si debes inscribir bases de datos en el RNBD.
- **Facturación:** factura electrónica ante la DIAN e IVA según corresponda; consulta a tu contador.
- **Proveedores externos:** revisa que sus condiciones permitan uso comercial (ver [checklist-lanzamiento.md](checklist-lanzamiento.md)).
