import { useEffect, useState } from 'react';

export interface BotonDialogo { texto: string; estilo?: 'cancelar' | 'peligro' }
interface Pedido { id: number; titulo: string; mensaje?: string; botones: BotonDialogo[]; resolver: (i: number) => void }

let siguiente = 1;
let cola: Pedido[] = [];
const oyentes = new Set<() => void>();
const avisar_ = () => oyentes.forEach((f) => f());

/** Equivale a Alert.alert del móvil: devuelve el índice del botón pulsado (o el del botón "cancelar" si se cierra). */
export function dialogo(o: { titulo: string; mensaje?: string; botones: BotonDialogo[] }): Promise<number> {
  return new Promise((resolver) => { cola = [...cola, { id: siguiente++, ...o, resolver }]; avisar_(); });
}
export const avisar = (titulo: string, mensaje?: string) => dialogo({ titulo, mensaje, botones: [{ texto: 'Entendido' }] }).then(() => undefined);
export const confirmar = async (titulo: string, mensaje: string, textoOk = 'Aceptar', peligro = false) =>
  (await dialogo({ titulo, mensaje, botones: [{ texto: 'Cancelar', estilo: 'cancelar' }, { texto: textoOk, estilo: peligro ? 'peligro' : undefined }] })) === 1;

export function Dialogos() {
  const [, forzar] = useState(0);
  useEffect(() => { const f = () => forzar((n) => n + 1); oyentes.add(f); return () => { oyentes.delete(f); }; }, []);
  const p = cola[0];
  useEffect(() => {
    if (!p) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(p, Math.max(0, p.botones.findIndex((b) => b.estilo === 'cancelar'))); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [p]);
  if (!p) return null;
  return (
    <div className="velo" role="presentation" onClick={() => cerrar(p, Math.max(0, p.botones.findIndex((b) => b.estilo === 'cancelar')))}>
      <div className="dialogo" role="alertdialog" aria-modal="true" aria-labelledby={`dt${p.id}`} onClick={(e) => e.stopPropagation()}>
        <h2 id={`dt${p.id}`}>{p.titulo}</h2>
        {p.mensaje && <p className="dialogo-msg">{p.mensaje}</p>}
        <div className="dialogo-botones">
          {p.botones.map((b, i) => (
            <button key={i} type="button" className={`boton ${b.estilo === 'peligro' ? 'peligro' : i === p.botones.length - 1 && b.estilo !== 'cancelar' ? 'primario' : 'secundario'}`} onClick={() => cerrar(p, i)}>
              {b.texto}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function cerrar(p: Pedido, i: number) {
  cola = cola.filter((x) => x.id !== p.id);
  avisar_();
  p.resolver(i);
}
