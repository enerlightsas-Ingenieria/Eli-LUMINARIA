/** Posición GPS neutra de plataforma. simulada: Android marca ubicación proveniente de una app de GPS falso (iOS y web no lo exponen). */
export interface Posicion { latitud: number; longitud: number; precisionM: number | null; simulada?: boolean }
