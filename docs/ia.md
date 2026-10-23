# Identificación con IA: Claude y Gemini

El servidor (proxy de Cloudflare) acepta dos proveedores. La app no distingue cuál respondió.

| Proveedor | Costo | Clave |
|---|---|---|
| **Gemini** (Google) | Tiene capa gratuita con límites de uso | `GEMINI_API_KEY` (aistudio.google.com → *Get API key*) |
| **Claude** (Anthropic) | De pago, por foto | `ANTHROPIC_API_KEY` (console.anthropic.com) |

## Cómo se elige (desde la app)
Por defecto analiza **Gemini**. El administrador cambia la IA principal en **Ajustes → Administración (usuarios e IA) → Inteligencia artificial** (Gemini o Claude). El cambio vale para todos y se aplica en un minuto como máximo.
- La otra IA queda de **respaldo automático**: si la principal falla (sin créditos, límite de uso, caída), responde la otra, siempre que tenga clave en el servidor.
- Si solo cargaste una clave, se usa esa.
- **Probar la IA:** el botón llama a cada proveedor y dice si funciona o por qué falla (por ejemplo, "modelo no encontrado" o "clave inválida"), sin mostrar claves. Es lo primero que hay que usar cuando "no analiza".
- Sin elección guardada manda `ORDEN_IA` (por defecto `gemini,claude`).

## Puesta en marcha sin costo
```powershell
cd C:\Proyectos\ELI-LUMINARIA
npx wrangler secret put GEMINI_API_KEY --name eli-luminaria-proxy
npx wrangler deploy server/worker.ts --name eli-luminaria-proxy --compatibility-date 2026-01-01
```
Pega la clave cuando la pida (no la escribas en chats ni documentos). Sin `ANTHROPIC_API_KEY` el servidor usa solo Gemini.

## Modelo de Gemini
Google cambia y retira modelos con frecuencia (una cuenta nueva puede no tener acceso a los viejos y recibir "404"). Por eso:
- **Por defecto es automático:** si el modelo de siempre no existe para tu cuenta, el servidor consulta la lista de modelos que tu clave puede usar, elige el flash estable más nuevo, reintenta y lo recuerda una hora.
- **Elegirlo a mano:** Ajustes → Administración → Inteligencia artificial → **Elegir el modelo de Gemini**. Verás la lista real de tu cuenta; toca uno (o *Automático*). Si fijas uno y deja de existir, la IA falla y el aviso lo dice, en vez de cambiarlo a escondidas.
- `GEMINI_MODEL` (secreto opcional) fija un modelo para todos si no hay uno elegido en la app.
- **Probar la IA** muestra qué modelo funcionó.

## Cosas que debes saber de la capa gratuita
- **Privacidad:** con la capa gratuita, Google puede usar lo que envías (las fotos) para mejorar sus productos. Las fotos son de luminarias en la vía pública; no se envía la ubicación ni el nombre del técnico. Si eso no es aceptable, activa la facturación en Google (la capa de pago no usa los datos para entrenar) o usa solo Claude.
- **Límites:** pocas solicitudes por minuto y por día. Si se agotan, la app avisa y el técnico llena a mano; con Claude de respaldo, sigue funcionando.
- **Precisión:** compáralo con Claude con las mismas 20 fotos antes de decidir cuál va primero.

## Control de costos
- En Ajustes cada persona puede apagar la IA (sin ningún gasto).
- Fija un límite mensual de gasto en la consola de Anthropic.
