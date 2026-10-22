import { Caracteristicas, caracteristicasVacias, Confianza } from '../types';
import { cargarAjustes } from './settings';

export interface ResultadoAnalisis {
  caracteristicas: Caracteristicas;
  confianza: Confianza;
}

const PROMPT = `Eres un técnico experto en alumbrado público e iluminación exterior/interior.
Analiza la foto de una luminaria y extrae sus características básicas.

Reglas:
- Lee cualquier etiqueta, placa o texto visible (marca, modelo, potencia, tensión, IP, lm, K).
- Si un dato NO se puede ver ni deducir con razonable certeza, devuelve cadena vacía "". No inventes.
- Si deduces un dato sólo por la forma/aspecto (p. ej. tecnología por el tipo de lámpara o carcasa), añade "(est.)" al final.
- Fotocelda: indica si hay (NEMA/twist-lock, integrada, externa) o no, y cuenta los pines/contactos visibles del receptáculo (3, 5 o 7) en "pinesFotocelda".
- Responde en español, valores cortos y sin unidades dentro de los campos numéricos (potencia en W, tensión en V, K, lm).
- Usa la herramienta registrar_luminaria para responder.`;

const campo = (description: string) => ({ type: 'string', description });

const TOOL = {
  name: 'registrar_luminaria',
  description: 'Registra las características identificadas de la luminaria.',
  input_schema: {
    type: 'object',
    properties: {
      marca: campo('Marca comercial'),
      fabricante: campo('Fabricante (puede coincidir con la marca)'),
      modelo: campo('Modelo o referencia'),
      tipoLuminaria: campo('Alumbrado público, proyector, farol, panel, bala, hermética, etc.'),
      tecnologia: campo('LED, sodio alta presión, sodio baja presión, mercurio, metal halide, fluorescente, inducción, incandescente'),
      potenciaW: campo('Potencia en vatios'),
      tensionV: campo('Tensión nominal en voltios'),
      fotocelda: campo('Presencia y tipo de fotocelda'),
      pinesFotocelda: campo('Número de pines de la fotocelda/receptáculo: 3, 5 o 7'),
      temperaturaColorK: campo('Temperatura de color en kelvin'),
      flujoLuminosoLm: campo('Flujo luminoso en lúmenes'),
      ip: campo('Grado de protección IP'),
      montaje: campo('Poste, brazo, pared, techo, suspendida, etc.'),
      estado: campo('Estado visual: bueno, deteriorado, apagada, vandalizada...'),
      observaciones: campo('Notas útiles: altura estimada, brazo, color, daños, texto leído'),
      confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Confianza global en la identificación' },
    },
    required: [
      'marca', 'fabricante', 'modelo', 'tipoLuminaria', 'tecnologia', 'potenciaW', 'tensionV', 'fotocelda',
      'pinesFotocelda', 'temperaturaColorK', 'flujoLuminosoLm', 'ip', 'montaje', 'estado', 'observaciones', 'confianza',
    ],
  },
};

export class ErrorAnalisis extends Error {}

/** Envía la foto (JPEG base64) a Claude con visión y devuelve las características estructuradas. */
export async function analizarFoto(base64Jpeg: string): Promise<ResultadoAnalisis> {
  const ajustes = await cargarAjustes();
  if (!ajustes.apiKey && ajustes.endpoint.includes('api.anthropic.com')) {
    throw new ErrorAnalisis('Falta la API key. Configúrala en Ajustes o llena los datos manualmente.');
  }

  const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (ajustes.apiKey) headers['x-api-key'] = ajustes.apiKey;

  let res: Response;
  try {
    res = await fetch(ajustes.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: ajustes.modelo,
        max_tokens: 1024,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
  } catch {
    throw new ErrorAnalisis('Sin conexión con el servicio de análisis. Puedes completar los datos manualmente.');
  }

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    if (res.status === 401) throw new ErrorAnalisis('API key inválida (401). Revisa Ajustes.');
    if (res.status === 429) throw new ErrorAnalisis('Límite de uso alcanzado (429). Intenta de nuevo en un momento.');
    throw new ErrorAnalisis(`Error del servicio (${res.status}). ${detalle.slice(0, 160)}`);
  }

  const json = await res.json();
  const bloque = (json.content ?? []).find((b: any) => b.type === 'tool_use');
  if (!bloque) throw new ErrorAnalisis('La IA no devolvió datos estructurados.');

  const base = caracteristicasVacias();
  const out: Caracteristicas = { ...base };
  for (const k of Object.keys(base) as (keyof Caracteristicas)[]) {
    const v = bloque.input?.[k];
    out[k] = typeof v === 'string' ? v.trim() : v != null ? String(v) : '';
  }
  const c = bloque.input?.confianza;
  return { caracteristicas: out, confianza: c === 'alta' || c === 'media' || c === 'baja' ? c : 'baja' };
}
