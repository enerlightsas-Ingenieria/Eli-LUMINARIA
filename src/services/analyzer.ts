import { analizarFotosCon } from '../core/analizador';
import { cargarAjustes } from './settings';

export { ErrorAnalisis, TOOL } from '../core/analizador';
export type { ResultadoAnalisis } from '../core/analizador';

export const analizarFotos = (base64Jpegs: string[], cancelar?: AbortSignal) => analizarFotosCon(() => cargarAjustes(), base64Jpegs, cancelar);
