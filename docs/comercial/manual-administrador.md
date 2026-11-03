# Manual del administrador — ELI-LUMINARIA

## 1. Qué es
Aplicación web (se instala en el celular como una app) para levantar el inventario de luminarias de alumbrado público: el técnico toma una foto, la inteligencia artificial propone las características, el GPS registra el lugar y todo se guarda en una hoja de Google compartida por el equipo.

## 2. Roles
| Rol | Qué hace |
|---|---|
| **Técnico** | Captura luminarias, ve los proyectos asignados, sincroniza |
| **Supervisor** | Lo del técnico, más el panel del equipo y el mapa; ve solo los proyectos y técnicos que supervisa |
| **Administrador** | Crea usuarios y proyectos, decide la IA, las fotos y las asignaciones |

## 3. Primer ingreso
1. Abre la dirección que te entregaron y entra con tu usuario y clave.
2. Instala la app: *Compartir → Añadir a pantalla de inicio* (iPhone) o *Instalar aplicación* (Android). Así funciona también sin señal.
3. Cambia la clave inicial creando tu propia cuenta de administrador (Administración → Usuarios).

## 4. Usuarios (Administración → Usuarios)
- **Nuevo usuario:** nombre completo, usuario, rol y, si quieres, teléfono (para WhatsApp). La clave la genera el sistema o la escribes tú (mínimo 8 caracteres, sin espacios). Entrégala en privado.
- **Proyectos asignados:** a un técnico marca los proyectos donde trabaja. Solo verá esos. Sin marcar ninguno ve todos.
- **Supervisor:** marca los proyectos que supervisa y, si quieres, técnicos concretos. Verá los registros de sus proyectos y a los técnicos asignados a ellos.
- **Dar de baja:** desmarca "Con acceso". La persona deja de poder entrar; sus registros se conservan. Quedan en "Ver usuarios dados de baja", donde puedes **Reactivar** o **Eliminar definitivamente**.
- **Contratista (modo terceros):** exige jornada activa, solo cámara y GPS preciso; la coordenada no se edita a mano.

## 5. Proyectos (pestaña Proyectos)
- Solo el administrador crea, renombra, desactiva y elimina proyectos.
- **Desactivar** oculta el proyecto a todos y detiene su sincronización; los datos se conservan. **Activar** lo devuelve.
- **Eliminar** borra el proyecto: su pestaña de la hoja, sus filas y sus fotos de Drive. Pide dos confirmaciones y no se puede deshacer.
- Cambiar el nombre, cliente o notas actualiza a todo el equipo.

## 6. Fotos (Administración → Fotos)
- Se guarda la primera foto de cada luminaria en Drive, en una carpeta por proyecto, con un nombre como `Proyecto - Barrio - Código - Poste - coordenada`.
- "Ordenar fotos anteriores en Drive" mueve y renombra las fotos subidas antes de activar esta organización.

## 7. Inteligencia artificial (Administración → Inteligencia artificial)
Elige cuál IA va primero y cuál es el respaldo, guarda las claves de cada proveedor y prueba que funcionen. Usa cuentas de **pago** para datos de clientes.

## 8. Trabajo diario
- **Nueva luminaria:** foto(s) → "Analizar con IA" o "Llenar manualmente" → revisar datos → guardar.
- **Ubicación:** "Actualizar ubicación (GPS)" toma la mejor lectura; "Ajustar en el mapa" permite mover el punto. En el mapa, tocar una luminaria permite **Mover** su posición.
- **Dirección:** se propone sola; "Armar dirección" escribe `Calle 35 No. 86 - 92`.
- **Sincronizar:** automático cada minuto y medio con señal; también el botón de la nube. Lo capturado sin señal se envía al volver.
- **Exportar:** CSV (Excel), GeoJSON (QGIS/ArcGIS) o KML (Google Earth) desde Registros o Proyectos.

## 9. Licencia
Si aparece una franja de aviso (por vencer, en gracia o vencida) contacta a tu proveedor para renovar. Después de vencida y pasado el período de gracia no se pueden enviar datos nuevos ni usar la IA; se puede seguir consultando y exportando.

## 10. Problemas frecuentes
| Síntoma | Qué hacer |
|---|---|
| "Usuario o clave incorrectos" | Revisa mayúsculas y espacios; pide al administrador una clave nueva |
| No carga el mapa | Sin señal el fondo no carga, pero los puntos sí se ven |
| "Sin coordenada" | Activa el GPS y permite la ubicación del navegador; pulsa actualizar |
| No llegan los registros de otro técnico | Pulsa Sincronizar; confirma que ambos tienen asignado el proyecto |
| "Servidor ocupado" | Espera un minuto y reintenta; si se repite, avisa a soporte |
| Franja de licencia | Contacta a tu proveedor |
