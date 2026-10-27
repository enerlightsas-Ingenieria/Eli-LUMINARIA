import { Caracteristicas, caracteristicasVacias, Confianza, normalizarFotocelda, normalizarMaterialPoste, normalizarMontaje, normalizarTecnologia } from '../types';
import { Ajustes } from './ajustes';

export interface ResultadoAnalisis {
  caracteristicas: Caracteristicas;
  confianza: Confianza;
}

const PROMPT = `Eres un técnico experto en alumbrado público e iluminación exterior/interior (normas ANSI C136, RETILAP, IEC).
Recibes de 1 a 3 fotos de UNA misma luminaria (general, placa/etiqueta, fotocelda). Extrae sus características básicas.

Reglas:
- Lee cualquier etiqueta, placa, grabado o texto visible (fabricante, potencia, IP, país).
- Si un dato NO se puede ver ni deducir con razonable certeza, devuelve cadena vacía "". No inventes cifras.
- Si deduces un dato sólo por la forma/aspecto, añade " (est.)" al final.
- Fotocelda: responde solo "Sí" si se ve una fotocelda (NEMA/twist-lock, integrada o externa) o "No" si claramente no hay. Si no la puedes ver, déjalo vacío.
- Montaje: "Poste" si la luminaria va sobre un poste o en un brazo de poste, "Fachada" si va fijada a una pared o fachada, o "Otro: <cuál>". Si es poste, en "materialPoste" pon el material que se ve: Concreto, Madera, Metálico, Fibra de vidrio, Fibra de vidrio traslúcido u "Otro: <cuál>".
- Tecnología: responde SOLO con una de estas: LED, Sodio, Metal Halide, Mercurio, Fluorescente, Incandescente, Halógena, Inducción, Luz mixta. Si ninguna encaja, responde "Otra: <cuál>". Por aspecto: módulo de LEDs con lentes = LED; lámpara tubular/elipsoidal tras vidrio = sodio, mercurio o metal halide (solo si lo puedes distinguir).
- Responde en español, valores cortos. Campos numéricos sin unidad (W).
- Son luminarias de alumbrado público.
- Usa la herramienta registrar_luminaria para responder.`;

const campo = (description: string) => ({ type: 'string', description });

export const TOOL = {
  name: 'registrar_luminaria',
  description: 'Registra las características identificadas de la luminaria.',
  input_schema: {
    type: 'object',
    properties: {
      fabricante: campo('Fabricante'),
      tecnologia: campo('Una de: LED, Sodio, Metal Halide, Mercurio, Fluorescente, Incandescente, Halógena, Inducción, Luz mixta; si ninguna, "Otra: <cuál>"'),
      potenciaW: campo('Potencia en vatios'),
      fotocelda: campo('"Sí" si tiene fotocelda, "No" si no la tiene'),
      ip: campo('Grado de protección IP'),
      montaje: campo('Poste, Fachada u "Otro: <cuál>"'),
      materialPoste: campo('Solo si el montaje es poste: Concreto, Madera, Metálico, Fibra de vidrio, Fibra de vidrio traslúcido u "Otro: <cuál>"'),
      estado: campo('Estado visual: bueno, deteriorado, apagada o vandalizada'),
      observaciones: campo('Notas útiles: brazo, color, daños, texto leído'),
      confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Confianza global en la identificación' },
    },
    required: [...Object.keys(caracteristicasVacias()).filter((k) => k !== 'numeroTransformador'), 'confianza'],   // el n.º del transformador no se ve en la foto: lo escribe la persona
  },
};

export class ErrorAnalisis extends Error {}

const ETIQUETAS = ['Foto general', 'Foto de la placa / etiqueta', 'Foto de la fotocelda'];

const TIMEOUT_MS = 25000;

async function conTimeout(url: string, init: RequestInit, ms: number, externa?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const cancelar = () => ctl.abort();
  if (externa?.aborted) cancelar(); // el técnico pudo omitir antes de que arrancara la petición
  externa?.addEventListener('abort', cancelar);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); externa?.removeEventListener('abort', cancelar); }
}

/** Envía 1-3 fotos (JPEG base64) a Claude con visión y devuelve las características estructuradas. */
export async function analizarFotosCon(cargarAjustes: () => Promise<Ajustes>, base64Jpegs: string[], cancelar?: AbortSignal): Promise<ResultadoAnalisis> {
  const ajustes = await cargarAjustes();
  if (!ajustes.apiKey && ajustes.endpoint.includes('api.anthropic.com')) {
    throw new ErrorAnalisis('Falta la API key. Configúrala en Ajustes o llena los datos manualmente.');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (ajustes.apiKey) headers['x-api-key'] = ajustes.apiKey;
  // Solo para pruebas personales con la API directa desde un navegador (en flotas se usa el proxy, que guarda la clave en el servidor).
  if (ajustes.endpoint.includes('api.anthropic.com')) headers['anthropic-dangerous-direct-browser-access'] = 'true';

  const content: any[] = [];
  base64Jpegs.slice(0, 3).forEach((data, i) => {
    content.push({ type: 'text', text: ETIQUETAS[i] + ':' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
  });
  content.push({ type: 'text', text: PROMPT });
  const body = JSON.stringify({
    model: ajustes.modelo, max_tokens: 1024, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content }],
  });

  let res: Response | null = null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      res = await conTimeout(ajustes.endpoint, { method: 'POST', headers, body }, TIMEOUT_MS, cancelar);
    } catch {
      // Sin red, señal muy débil o cancelado por el técnico: no se reintenta (evita esperas largas en campo).
      if (cancelar?.aborted) throw new ErrorAnalisis('Análisis omitido. Llena los datos a mano; podrás usar "Re-analizar con IA" cuando tengas señal.');
      throw new ErrorAnalisis('Sin señal suficiente para analizar. Llena los datos a mano; podrás usar "Re-analizar con IA" cuando tengas conexión.');
    }
    if ((res.status === 429 || res.status >= 500) && intento === 0) { // reintento único ante sobrecarga del servicio
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    break;
  }
  if (!res) throw new ErrorAnalisis('Sin respuesta del servicio de análisis.');

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    if (res.status === 401) throw new ErrorAnalisis('API key inválida (401). Revisa Ajustes.');
    if (res.status === 503) throw new ErrorAnalisis('La IA no está configurada en el servidor. Llena los datos a mano.');
    if (res.status === 429) throw new ErrorAnalisis('Límite de uso alcanzado (429). Intenta de nuevo en un momento.');
    throw new ErrorAnalisis(`Error del servicio (${res.status}). ${detalle.slice(0, 400)}`);
  }

  const json = await res.json();
  const bloque = (json.content ?? []).find((b: any) => b.type === 'tool_use');
  if (!bloque) throw new ErrorAnalisis('La IA no devolvió datos estructurados.');

  const out = caracteristicasVacias();
  for (const k of Object.keys(out) as (keyof Caracteristicas)[]) {
    const v = bloque.input?.[k];
    out[k] = typeof v === 'string' ? v.trim() : v != null ? String(v) : '';
  }
  out.tecnologia = normalizarTecnologia(out.tecnologia);
  out.fotocelda = normalizarFotocelda(out.fotocelda); out.montaje = normalizarMontaje(out.montaje);
  out.materialPoste = /^poste\b/i.test(out.montaje) ? normalizarMaterialPoste(out.materialPoste) : '';
  const c = bloque.input?.confianza;
  return { caracteristicas: out, confianza: c === 'alta' || c === 'media' || c === 'baja' ? c : 'baja' };
}
