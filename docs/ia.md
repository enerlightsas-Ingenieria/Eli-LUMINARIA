# Identificación con IA: varias opciones

La app envía la foto de la luminaria a una IA que la **mira** y devuelve fabricante, modelo, tecnología, potencia, etc. El servidor (proxy de Cloudflare) guarda las claves y habla con la IA; la app nunca ve una clave.

Hace falta que el modelo **acepte imágenes** y pueda devolver datos estructurados. Por eso la lista incluye solo servicios que lo permiten.

## Qué IAs están disponibles
| IA | Costo | Notas |
|---|---|---|
| **Gemini** (Google) | Capa gratuita con límites | Entiende fotos. aistudio.google.com → Get API key |
| **Claude** (Anthropic) | De pago por foto | Muy buena leyendo placas. console.anthropic.com |
| **Groq** | Capa gratuita con límites | Modelos Llama 4 con visión. console.groq.com |
| **OpenRouter** | Modelos `:free` sin costo (límites bajos) | Reúne muchos modelos, incluidos de Qwen y Llama. openrouter.ai |
| **Mistral** | Plan gratuito de pruebas con límites | Pixtral / Mistral Small con visión. console.mistral.ai |
| **Qwen** (Alibaba) | Cuota inicial; luego de pago | Modelos Qwen-VL. Alibaba Cloud Model Studio |
| **Kimi** (Moonshot) | De pago (a veces crédito inicial) | Modelos con visión. platform.moonshot.ai |
| **ChatGPT** (OpenAI) | De pago por uso | platform.openai.com |
| **Otra compatible con OpenAI** | Según el servicio | Cualquier servicio con la API de ChatGPT que acepte imágenes (Together, Fireworks, un servidor propio…). Se indica su dirección. |

Los límites y planes gratuitos cambian; confirma en la página de cada proveedor.

**Lo que no se puede usar, y por qué**
- **DeepSeek:** su API oficial no recibe imágenes. Solo serviría mediante "Otra compatible" si algún servicio ofrece un modelo DeepSeek con visión.
- **Perplexity:** es un buscador con IA; su API no sirve para analizar una foto y devolver datos de la luminaria.
- **Copilot:** no ofrece una API pública para esto. Si quieres modelos de ChatGPT sin pagar, OpenRouter (modelos `:free`) es el camino más cercano.

## Cómo se configura (todo desde la app, sin terminal)
Ajustes → **Administración** → **Inteligencia artificial**. Hay una tarjeta por IA:
1. **Poner clave:** consigue la clave en la página que indica la tarjeta, pégala y pulsa *Probar y guardar*. El servidor la prueba con una foto de verdad antes de guardarla; si el proveedor la rechaza, no se guarda. La clave se guarda en las propiedades de tu script de Google (no en la hoja: no aparece en ninguna celda) y **no se vuelve a mostrar**.
2. **Usar como principal:** elige cuál analiza primero.
3. **Elegir modelo:** muestra los modelos que ofrece ese proveedor, con los de visión primero. Al elegir uno se prueba antes de guardar; si no sirve (por ejemplo, de voz o solo texto), no se guarda. *Automático* deja que el sistema escoja.
4. **Probar:** una prueba real (imagen + herramienta) por IA, o *Probar todas las IAs* arriba. Dice qué modelo funcionó o por qué falló.
5. **Quitar clave:** solo las que se pegaron desde la app (las fijadas en Cloudflare se quitan allá).

También sigue funcionando poner claves como secretos de Cloudflare (`wrangler secret put GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `QWEN_API_KEY`, `KIMI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`). Si una IA tiene ambas, manda la de Cloudflare.

## Respaldo automático
Si la principal falla (sin créditos, límite de uso, caída, modelo saturado), el sistema prueba la siguiente que tenga clave, en este orden: Gemini, Claude, Groq, OpenRouter, Mistral, Qwen, Kimi, ChatGPT, Otra. Intenta hasta 4 y el aviso de error dice cuál falló y por qué (sin claves).

## Modelos que cambian
Los proveedores retiran y renombran modelos. Si el modelo de una IA deja de existir para tu cuenta, el servidor consulta la lista de modelos de ese proveedor, elige uno de visión, reintenta y lo recuerda una hora. Si el administrador **fijó** un modelo y deja de existir, falla con un aviso en vez de cambiarlo a escondidas.

## Privacidad
Con las capas gratuitas, algunos proveedores (Google, por ejemplo) pueden usar lo que envías —las fotos— para mejorar sus productos. Las fotos son de luminarias en la vía pública; no se envía la ubicación ni el nombre del técnico. Si eso no es aceptable, usa un plan de pago o Claude.

## Control de costos
- Cada persona puede apagar la IA en Ajustes (cero gasto).
- Fija límites de gasto en la consola de cada proveedor de pago.
