import { ReactNode, useEffect } from 'react';
import { Icono } from './Icono';

export function Boton({ texto, onClick, variante = 'primario', deshabilitado, cargando, icono, bloque = true, tipo = 'button' }: {
  texto: string; onClick?: () => void; variante?: 'primario' | 'secundario' | 'peligro'; deshabilitado?: boolean; cargando?: boolean;
  icono?: string; bloque?: boolean; tipo?: 'button' | 'submit';
}) {
  return (
    <button type={tipo} className={`boton ${variante}${bloque ? ' bloque' : ''}`} onClick={onClick} disabled={deshabilitado || cargando} aria-busy={cargando || undefined}>
      {cargando ? <span className="girar" aria-hidden="true" /> : icono ? <Icono nombre={icono} tam={18} /> : null}
      <span>{texto}</span>
    </button>
  );
}

/** Campo de texto con opciones rápidas (un toque) para llenar a mano más rápido. */
export function Campo({ etiqueta, valor, alCambiar, pista, multilinea, numerico, conSigno, secreto, soloLectura, opciones, tipo }: {
  etiqueta: string; valor: string; alCambiar: (t: string) => void; pista?: string; multilinea?: boolean; numerico?: boolean;
  conSigno?: boolean; secreto?: boolean; soloLectura?: boolean; opciones?: string[]; tipo?: string;
}) {
  const id = `c-${etiqueta.replace(/\W+/g, '-').toLowerCase()}`;
  const comun = {
    id, value: valor, placeholder: pista, readOnly: soloLectura, autoCapitalize: secreto || numerico || conSigno || tipo === 'url' ? 'none' : 'sentences',
    autoCorrect: 'off', spellCheck: false, onChange: (e: { target: { value: string } }) => alCambiar(e.target.value),
  } as const;
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {multilinea
        ? <textarea {...comun} rows={3} />
        : <input {...comun} type={secreto ? 'password' : tipo ?? 'text'} inputMode={conSigno ? 'text' : numerico ? 'decimal' : tipo === 'url' ? 'url' : undefined} />}
      {!!opciones?.length && (
        <div className="fichas" role="group" aria-label={`Opciones para ${etiqueta}`}>
          {opciones.map((o) => {
            const activa = valor.trim().toLowerCase() === o.toLowerCase();
            return <button key={o} type="button" className={`ficha${activa ? ' activa' : ''}`} aria-pressed={activa} onClick={() => alCambiar(activa ? '' : o)}>{o}</button>;
          })}
        </div>
      )}
    </div>
  );
}

export function Ficha({ texto, color }: { texto: string; color?: 'ok' | 'aviso' | 'peligro' | 'primario' }) {
  return <span className={`ficha-estado${color ? ' ' + color : ''}`}>{texto}</span>;
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`tarjeta ${className}`}>{children}</div>;
}

export function Seccion({ children }: { children: ReactNode }) {
  return <h2 className="seccion">{children}</h2>;
}

export function Segmentado<T extends string>({ valor, opciones, alCambiar }: { valor: T; opciones: { valor: T; texto: string }[]; alCambiar: (v: T) => void }) {
  return (
    <div className="segmentado" role="tablist">
      {opciones.map((o) => (
        <button key={o.valor} type="button" role="tab" aria-selected={o.valor === valor} className={o.valor === valor ? 'activo' : ''} onClick={() => alCambiar(o.valor)}>{o.texto}</button>
      ))}
    </div>
  );
}

export interface OpcionHoja { texto: string; onClick: () => void; peligro?: boolean }

/** Menú inferior de acciones. */
export function Hoja({ abierta, titulo, subtitulo, opciones, alCerrar, children }: {
  abierta: boolean; titulo: string; subtitulo?: string; opciones?: OpcionHoja[]; alCerrar: () => void; children?: ReactNode;
}) {
  useEffect(() => {
    if (!abierta) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [abierta, alCerrar]);
  if (!abierta) return null;
  return (
    <div className="velo hoja-velo" role="presentation" onClick={alCerrar}>
      <div className="hoja" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <h2>{titulo}</h2>
        {subtitulo && <p className="muted">{subtitulo}</p>}
        {children}
        {opciones?.map((o) => (
          <button key={o.texto} type="button" className={`hoja-opcion${o.peligro ? ' peligro' : ''}`} onClick={() => { alCerrar(); o.onClick(); }}>{o.texto}</button>
        ))}
        <button type="button" className="hoja-opcion muted" onClick={alCerrar}>Cancelar</button>
      </div>
    </div>
  );
}

export function Cargando({ texto }: { texto?: string }) {
  return <div className="cargando" role="status"><span className="girar grande" aria-hidden="true" />{texto && <p>{texto}</p>}</div>;
}

export function Cabecera({ titulo, subtitulo, onSubtitulo, acciones, atras }: {
  titulo: string; subtitulo?: string; onSubtitulo?: () => void;
  acciones?: { icono: string; etiqueta: string; onClick: () => void; insignia?: number }[]; atras?: () => void;
}) {
  return (
    <header className="cabecera">
      {atras && <button type="button" className="icono-btn" aria-label="Volver" onClick={atras}><Icono nombre="atras" /></button>}
      <div className="cabecera-texto">
        <h1>{titulo}</h1>
        {subtitulo && (onSubtitulo
          ? <button type="button" className="enlace-sub" onClick={onSubtitulo}>{subtitulo} ▾</button>
          : <p>{subtitulo}</p>)}
      </div>
      {acciones?.map((a) => (
        <button key={a.etiqueta} type="button" className="icono-btn" aria-label={a.etiqueta} title={a.etiqueta} onClick={a.onClick}>
          <Icono nombre={a.icono} />
          {!!a.insignia && <span className="insignia">{a.insignia > 99 ? '99+' : a.insignia}</span>}
        </button>
      ))}
    </header>
  );
}
