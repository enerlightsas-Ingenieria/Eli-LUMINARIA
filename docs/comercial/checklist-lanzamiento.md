# Checklist antes del primer cliente

## Proveedores externos: pasar a condiciones comerciales
- [ ] **IA (fotos de luminarias):** la capa gratuita de Gemini permite que Google use los datos para mejorar sus productos. Con clientes reales usa la **capa de pago** (o Claude). Revisa las condiciones de cada proveedor sobre retención de datos.
- [ ] **Direcciones:** el servicio público de OpenStreetMap (Nominatim) no es para uso comercial intensivo. Configura `GOOGLE_GEOCODING_KEY` en el proxy de cada cliente (facturación activa en Google Cloud; restringe la clave a la API de Geocodificación).
- [ ] **Mapas:** los fondos por defecto (OpenStreetMap y Esri) son para pruebas. Contrata un proveedor (MapTiler, Mapbox u otro), pon sus direcciones con clave en `servidor.json` (`--mapa-calles`, `--mapa-satelite`) y restringe la clave al dominio del cliente.
- [ ] **Cloudflare:** revisa límites del plan gratuito (solicitudes por día) y pasa al plan de pago si el volumen lo pide.
- [ ] **Google (Hojas, Drive, Apps Script):** hay cuotas diarias; una cuenta de Workspace tiene más holgura que una cuenta personal.

## Producto
- [ ] Pruebas completas en un celular Android y uno iPhone, con y sin señal.
- [ ] Copia de seguridad: programa una copia periódica de la hoja y de la carpeta de fotos de cada cliente (Drive: *Hacer una copia*, o exportar a .xlsx cada semana).
- [ ] Límites de escala: la hoja de Google funciona bien para equipos pequeños y medianos. Define con el cliente el tamaño máximo (usuarios simultáneos y registros por proyecto). Para clientes grandes, planea migrar a una base de datos.
- [ ] Soporte: canal (WhatsApp/correo), horario, tiempos de respuesta y quién atiende cuando tú no estás.
- [ ] Monitoreo: revisa de vez en cuando los registros de errores del proxy en Cloudflare.

## Legal y financiero (con tus asesores)
- [ ] Contrato de licencia revisado por abogado ([contrato-licencia-modelo.md](contrato-licencia-modelo.md)).
- [ ] Política de tratamiento de datos y autorización de los técnicos ([politica-datos-modelo.md](politica-datos-modelo.md)); revisa si aplica el RNBD.
- [ ] Registro del software ante la Dirección Nacional de Derecho de Autor a nombre de ENERLIGHT SAS.
- [ ] Marca "ELI-LUMINARIA": verifica disponibilidad y registro ante la SIC.
- [ ] Facturación electrónica, IVA y plan de cuentas para ingresos por suscripción.
- [ ] Seguro de responsabilidad civil / ciberseguridad si lo exigen tus clientes.

## Comercial
- [ ] Lista de precios (implementación, suscripción, soporte, horas extra) y política de descuentos.
- [ ] Demo con datos de ejemplo y material de una página.
- [ ] Un cliente piloto con contrato corto y criterios de éxito.
- [ ] Calendario de renovaciones (60/30 días antes del vencimiento).
