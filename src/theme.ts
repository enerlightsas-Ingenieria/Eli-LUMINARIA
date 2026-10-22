import React, { createContext, useContext } from 'react';
import { PreferenciaTema } from './services/settings';

export interface Colores {
  bg: string; surface: string; surfaceAlt: string; primary: string; primaryText: string; text: string;
  muted: string; border: string; danger: string; ok: string; warn: string; overlay: string;
}

export const paletas: Record<'claro' | 'oscuro', Colores> = {
  oscuro: {
    bg: '#0F1B2D', surface: '#17283F', surfaceAlt: '#1F3550', primary: '#FFC53D', primaryText: '#1A1400',
    text: '#F2F6FB', muted: '#93A4BA', border: '#2A4263', danger: '#FF6B6B', ok: '#4ADE80', warn: '#FBBF24',
    overlay: 'rgba(15,27,45,0.92)',
  },
  claro: {
    bg: '#F4F6FA', surface: '#FFFFFF', surfaceAlt: '#E8EDF5', primary: '#F5A100', primaryText: '#1A1400',
    text: '#0F1B2D', muted: '#5B6B80', border: '#D5DDE9', danger: '#D93636', ok: '#15803D', warn: '#B45309',
    overlay: 'rgba(244,246,250,0.94)',
  },
};

export const radius = 14;

export interface TemaCtx { c: Colores; oscuro: boolean; pref: PreferenciaTema; setPref: (p: PreferenciaTema) => void }
export const TemaContext = createContext<TemaCtx>({ c: paletas.oscuro, oscuro: true, pref: 'auto', setPref: () => {} });
export const useTema = () => useContext(TemaContext);

/** Crea estilos dependientes del tema; memoízalos con useMemo(() => crear(c), [c]). */
export const confianzaColor = (c: Colores, conf: string) => (conf === 'alta' ? c.ok : conf === 'media' ? c.warn : c.danger);
