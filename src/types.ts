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
  confianza: Confianza | '';
  sincronizado: boolean;
}

export type LuminariaBorrador = Omit<Luminaria, 'id' | 'sincronizado'> & { id?: number };

export const CAMPOS: { key: keyof Caracteristicas; label: string; hint?: string; multiline?: boolean; numeric?: boolean }[] = [
  { key: 'marca', label: 'Marca', hint: 'Ej. Philips, Schréder, Lumenpulse' },
  { key: 'fabricante', label: 'Fabricante' },
  { key: 'modelo', label: 'Modelo / referencia' },
  { key: 'tipoLuminaria', label: 'Tipo de luminaria', hint: 'Alumbrado público, proyector, farol, panel...' },
  { key: 'tecnologia', label: 'Tecnología', hint: 'LED, sodio alta presión, mercurio, metal halide...' },
  { key: 'potenciaW', label: 'Potencia (W)', numeric: true },
  { key: 'tensionV', label: 'Tensión (V)', numeric: true },
  { key: 'fotocelda', label: 'Fotocelda', hint: 'Sin fotocelda, NEMA/twist-lock, integrada, externa' },
  { key: 'pinesFotocelda', label: 'Pines de la fotocelda', hint: '3, 5 o 7 pines', numeric: true },
  { key: 'temperaturaColorK', label: 'Temperatura de color (K)', numeric: true },
  { key: 'flujoLuminosoLm', label: 'Flujo luminoso (lm)', numeric: true },
  { key: 'ip', label: 'Grado IP' },
  { key: 'montaje', label: 'Montaje', hint: 'Poste, brazo, pared, suspendida...' },
  { key: 'alturaM', label: 'Altura de montaje (m)', hint: 'Estimada', numeric: true },
  { key: 'estado', label: 'Estado visual', hint: 'Bueno, deteriorado, apagada, sin luminaria...' },
  { key: 'observaciones', label: 'Observaciones', multiline: true },
];

export const caracteristicasVacias = (): Caracteristicas => ({
  marca: '', fabricante: '', modelo: '', tipoLuminaria: '', tecnologia: '', potenciaW: '',
  tensionV: '', fotocelda: '', pinesFotocelda: '', temperaturaColorK: '', flujoLuminosoLm: '',
  ip: '', montaje: '', alturaM: '', estado: '', observaciones: '',
});
