export type Confianza = 'alta' | 'media' | 'baja';

/** Características que la IA intenta extraer de la foto (todas opcionales). */
export interface Caracteristicas {
  marca: string;
  fabricante: string;
  modelo: string;
  tipoLuminaria: string;
  tecnologia: string;
  potenciaW: string;
  tensionV: string;
  fotocelda: string;
  pinesFotocelda: string;
  temperaturaColorK: string;
  flujoLuminosoLm: string;
  ip: string;
  montaje: string;
  alturaM: string;
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
  /** Identificador propio del activo (n.º de poste, código de la empresa). */
  codigo: string;
  /** Técnico que hizo el registro (para flotas). */
  tecnico: string;
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

export const CAMPOS: { key: keyof Caracteristicas; label: string; hint?: string; multiline?: boolean; numeric?: boolean; opciones?: string[] }[] = [
  { key: 'marca', label: 'Marca', hint: 'Ej. Philips, Schréder, Lumenpulse' },
  { key: 'fabricante', label: 'Fabricante' },
  { key: 'modelo', label: 'Modelo / referencia' },
  { key: 'tipoLuminaria', opciones: ['Alumbrado público','Proyector','Farol','Panel','Hermética','Bala / downlight'], label: 'Tipo de luminaria', hint: 'Alumbrado público, proyector, farol, panel...' },
  { key: 'tecnologia', opciones: ['LED','Sodio alta presión','Sodio baja presión','Mercurio','Metal halide','Fluorescente','Inducción'], label: 'Tecnología', hint: 'LED, sodio alta presión, mercurio, metal halide...' },
  { key: 'potenciaW', opciones: ['30','50','70','100','150','250','400'], label: 'Potencia (W)', numeric: true },
  { key: 'tensionV', opciones: ['120','208','220','240','277'], label: 'Tensión (V)', numeric: true },
  { key: 'fotocelda', opciones: ['Sin fotocelda','NEMA / twist-lock','Integrada','Externa'], label: 'Fotocelda', hint: 'Sin fotocelda, NEMA/twist-lock, integrada, externa' },
  { key: 'pinesFotocelda', opciones: ['3','5','7'], label: 'Pines de la fotocelda', hint: '3, 5 o 7 pines', numeric: true },
  { key: 'temperaturaColorK', opciones: ['3000','4000','5000','6500'], label: 'Temperatura de color (K)', numeric: true },
  { key: 'flujoLuminosoLm', label: 'Flujo luminoso (lm)', numeric: true },
  { key: 'ip', opciones: ['IP54','IP65','IP66','IP67'], label: 'Grado IP' },
  { key: 'montaje', opciones: ['Poste','Brazo','Pared','Suspendida','Techo'], label: 'Montaje', hint: 'Poste, brazo, pared, suspendida...' },
  { key: 'alturaM', label: 'Altura de montaje (m)', hint: 'Estimada', numeric: true },
  { key: 'estado', opciones: ['Bueno','Deteriorado','Apagada','Vandalizada','Sin luminaria'], label: 'Estado visual', hint: 'Bueno, deteriorado, apagada, sin luminaria...' },
  { key: 'observaciones', label: 'Observaciones', multiline: true },
];

export const caracteristicasVacias = (): Caracteristicas => ({
  marca: '', fabricante: '', modelo: '', tipoLuminaria: '', tecnologia: '', potenciaW: '',
  tensionV: '', fotocelda: '', pinesFotocelda: '', temperaturaColorK: '', flujoLuminosoLm: '',
  ip: '', montaje: '', alturaM: '', estado: '', observaciones: '',
});
