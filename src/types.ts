export type Confianza = 'alta' | 'media' | 'baja';

/** Características que la IA intenta extraer de la foto (todas opcionales). */
export interface Caracteristicas {
  fabricante: string;
  modelo: string;
  tecnologia: string;
  potenciaW: string;
  tensionV: string;
  fotocelda: string;
  pinesFotocelda: string;
  temperaturaColorK: string;
  ip: string;
  montaje: string;
  estado: string;
  observaciones: string;
}

export interface Proyecto {
  id: number;
  uuid: string;
  nombre: string;
  cliente: string;
  notas: string;
  creadoEn: string;
}

export interface Luminaria extends Caracteristicas {
  id: number;
  uuid: string;
  proyectoId: number;
  creadoEn: string;
  actualizadoEn: string;
  fotos: string[];
  latitud: number | null;
  longitud: number | null;
  precisionM: number | null;
  direccion: string;
  /** Código del poste (opcional; el que use la empresa). */
  codigoPoste: string;
  /** Código de la luminaria (opcional; el que use la empresa). */
  codigo: string;
  /** Técnico que hizo el registro (para flotas). */
  tecnico: string;
  /** Usuario (cuenta) con el que se registró; lo sella el servidor. */
  usuario?: string;
  confianza: Confianza | '';
  /** Cómo se obtuvo la foto: con la cámara de la app o desde la galería. */
  origen: 'camara' | 'galeria' | '';
  /** Android detectó una app de ubicación simulada al capturar. */
  ubicacionSimulada: boolean;
  /** Jornada durante la que se capturó (vacío si no había jornada activa). */
  jornadaId: string;
  sincronizado: boolean;
}

export type LuminariaBorrador = Omit<Luminaria, 'id' | 'sincronizado'> & { id?: number };

/** Tecnologías de lámpara. "Otra" se completa a mano como "Otra: <cuál>". */
export const TECNOLOGIAS = ['LED', 'Sodio', 'Metal Halide', 'Mercurio', 'Fluorescente', 'Incandescente', 'Halógena', 'Inducción', 'Luz mixta', 'Otra (¿cuál?)'];
export const PREFIJO_OTRA = 'Otra: ';
/** Una opción "abierta" (Otra) se marca activa con cualquier texto que empiece por "otra". */
export const esOpcionAbierta = (opcion: string) => /^otra\b/i.test(opcion);

/** Lleva lo que diga la IA (o un dato antiguo) a una de las tecnologías de la lista; lo que no encaje queda como "Otra: …". */
export function normalizarTecnologia(valor: string): string {
  const v = valor.trim();
  if (!v) return '';
  if (/^otra\b/i.test(v)) return /^otra\s*:\s*\S/i.test(v) ? PREFIJO_OTRA + v.replace(/^otra\s*:\s*/i, '') : 'Otra';
  const quitar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  const k = quitar(v);
  const directo = TECNOLOGIAS.slice(0, -1).find((t) => quitar(t) === k);
  if (directo) return directo;
  if (k.startsWith('sodio')) return 'Sodio';
  if (k.startsWith('led')) return 'LED';
  if (k.startsWith('halogenuro') || k.startsWith('metalhal')) return 'Metal Halide';
  if (k.startsWith('halogen')) return 'Halógena';
  if (k.startsWith('mixta') || k.startsWith('luzmixta')) return 'Luz mixta';
  if (k.startsWith('mercurio')) return 'Mercurio';
  return PREFIJO_OTRA + v;
}

export const CAMPOS: { key: keyof Caracteristicas; label: string; hint?: string; multiline?: boolean; numeric?: boolean; opciones?: string[] }[] = [
  { key: 'fabricante', label: 'Fabricante', hint: 'Ej. Philips, Schréder, Lumenpulse' },
  { key: 'modelo', label: 'Modelo / referencia' },
  { key: 'tecnologia', opciones: TECNOLOGIAS, label: 'Tecnología', hint: 'Si es otra, escribe cuál' },
  { key: 'potenciaW', opciones: ['30','50','70','100','150','250','400'], label: 'Potencia (W)', numeric: true },
  { key: 'tensionV', opciones: ['120','208','220','240','277'], label: 'Tensión (V)', numeric: true },
  { key: 'fotocelda', opciones: ['Sin fotocelda','NEMA / twist-lock','Integrada','Externa'], label: 'Fotocelda', hint: 'Sin fotocelda, NEMA/twist-lock, integrada, externa' },
  { key: 'pinesFotocelda', opciones: ['3','5','7'], label: 'Pines de la fotocelda', hint: '3, 5 o 7 pines', numeric: true },
  { key: 'temperaturaColorK', opciones: ['3000','4000','5000','6500'], label: 'Temperatura de color (K)', numeric: true },
  { key: 'ip', opciones: ['IP54','IP65','IP66','IP67'], label: 'Grado IP' },
  { key: 'montaje', opciones: ['Poste','Brazo','Suspendida'], label: 'Montaje', hint: 'Poste, brazo, suspendida' },
  { key: 'estado', opciones: ['Bueno','Deteriorado','Apagada','Vandalizada'], label: 'Estado visual', hint: 'Bueno, deteriorado, apagada, vandalizada' },
  { key: 'observaciones', label: 'Observaciones', multiline: true },
];

export const caracteristicasVacias = (): Caracteristicas => ({
  fabricante: '', modelo: '', tecnologia: '', potenciaW: '', tensionV: '', fotocelda: '', pinesFotocelda: '',
  temperaturaColorK: '', ip: '', montaje: '', estado: '', observaciones: '',
});
