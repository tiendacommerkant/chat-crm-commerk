'use client';

// Elegir una plantilla aprobada, llenar sus campos y enviarla.
// Es la forma de escribirle a un cliente pasadas 24 h de su último mensaje:
// para eso está "Retomar conversación" (retomar_conversacion), que se ofrece
// primero cuando la ventana está cerrada.
import { useEffect, useMemo, useRef, useState } from 'react';
import { primerNombre } from '@/lib/nombre';

type Plantilla = { id: string; name: string; status: string; category: string; language: string; components: any[] };

export const PLANTILLA_RETOMAR = 'retomar_conversacion';

const NOMBRES: Record<string, string> = {
  retomar_conversacion: 'Retomar conversación',
  recordatorio_pago: 'Recordatorio de pago',
  carrito_abandonado: 'Recuperación de carrito',
  confirmacion_pago: 'Confirmación de pago',
  pedido_en_camino: 'Pedido en camino',
  pedido_tienda_recibido: 'Pedido de la tienda recibido',
  pedido_tienda_despachado: 'Pedido de la tienda despachado',
  hora_roja_destapada: 'Oferta Hora Roja',
  black_week_inicio: 'Black Week: inicio',
  black_week_ultimo_dia: 'Black Week: último día',
};

// Qué va en cada {{n}}, para que el asesor no tenga que adivinar
const CAMPOS: Record<string, { etiqueta: string; ejemplo?: string }[]> = {
  retomar_conversacion: [
    { etiqueta: 'Nombre del cliente' },
    { etiqueta: 'Tema de la consulta', ejemplo: 'tu pedido · el Ron Viejo de Caldas · la ancheta que cotizaste' },
  ],
  recordatorio_pago: [{ etiqueta: 'Nombre del cliente' }, { etiqueta: 'Producto' }, { etiqueta: 'Total' }, { etiqueta: 'Link de pago' }],
  carrito_abandonado: [{ etiqueta: 'Nombre del cliente' }, { etiqueta: 'Producto' }, { etiqueta: 'Precio' }],
  confirmacion_pago: [{ etiqueta: 'Nombre del cliente' }, { etiqueta: 'Pedido' }, { etiqueta: 'Total' }],
  pedido_en_camino: [{ etiqueta: 'Nombre del cliente' }, { etiqueta: 'Producto' }, { etiqueta: 'Dirección de entrega' }],
  pedido_tienda_recibido: [{ etiqueta: 'Nombre del cliente' }, { etiqueta: 'Número de pedido', ejemplo: '2692' }, { etiqueta: 'Productos' }, { etiqueta: 'Total' }],
  pedido_tienda_despachado: [{ etiqueta: 'Nombre del cliente' }, { etiqueta: 'Número de pedido', ejemplo: '2692' }, { etiqueta: 'Transportadora y guía' }],
  hora_roja_destapada: [{ etiqueta: 'Nombre del cliente' }, { etiqueta: 'Producto' }, { etiqueta: 'Descuento', ejemplo: '15%' }, { etiqueta: 'Horas que dura' }],
  black_week_inicio: [{ etiqueta: 'Nombre del cliente' }],
  black_week_ultimo_dia: [{ etiqueta: 'Nombre del cliente' }],
};

// Avisos para el celular de la sede, no para clientes
const INTERNAS = new Set(['lead_mayorista', 'pedido_recoger_sede']);
const EN_REVISION = new Set(['PENDING', 'IN_APPEAL']);

function cuerpo(p: Plantilla | null): string {
  return p?.components?.find((c) => c.type === 'BODY')?.text || '';
}
function variables(texto: string): number {
  const nums = Array.from(texto.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}
function botones(p: Plantilla | null): any[] {
  return p?.components?.find((c) => c.type === 'BUTTONS')?.buttons || [];
}
function botonDinamico(p: Plantilla | null): { texto: string; url: string } | null {
  const b = botones(p).find((x: any) => x.type === 'URL' && /\{\{1\}\}/.test(x.url || ''));
  return b ? { texto: b.text, url: b.url } : null;
}
// Retomar primero, luego las de servicio y al final las de marketing
function orden(p: Plantilla): number {
  return p.name === PLANTILLA_RETOMAR ? 0 : p.category === 'MARKETING' ? 2 : 1;
}

export function ModalPlantilla(props: {
  conversacionId: string;
  clienteNombre?: string | null;
  /** Plantilla que se deja elegida al abrir (p. ej. retomar_conversacion con la ventana cerrada) */
  sugerida?: string;
  onClose: () => void;
  onEnviada: () => void;
}) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegida, setElegida] = useState<Plantilla | null>(null);
  const [valores, setValores] = useState<string[]>([]);
  const [valorBoton, setValorBoton] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [buscandoTema, setBuscandoTema] = useState(false);
  // Plantilla elegida ahora y tema ya calculado: si el asesor cambia de
  // plantilla mientras se busca el tema, no se le escribe en otra.
  const nombreElegida = useRef('');
  const temaCalculado = useRef<string | null>(null);

  const ponerTema = (tema: string) => {
    if (nombreElegida.current !== PLANTILLA_RETOMAR) return;
    // Si el asesor ya escribió algo, se respeta
    setValores((prev) => (prev.length > 1 && !prev[1].trim() ? prev.map((x, j) => (j === 1 ? tema : x)) : prev));
  };

  // {{2}} de "Retomar conversación": el tema sale solo de los últimos mensajes
  const llenarTema = async () => {
    if (temaCalculado.current) { ponerTema(temaCalculado.current); return; }
    setBuscandoTema(true);
    try {
      const j = await fetch(`/api/conversaciones/${props.conversacionId}/tema`).then((r) => r.json());
      if (j?.tema) {
        temaCalculado.current = j.tema;
        ponerTema(j.tema);
      }
    } catch {
      // Sin tema sugerido: el asesor lo escribe
    } finally {
      setBuscandoTema(false);
    }
  };

  const elegir = (p: Plantilla) => {
    setElegida(p);
    nombreElegida.current = p.name;
    const cant = variables(cuerpo(p));
    const iniciales = Array.from({ length: cant }, () => '');
    // Casi todas empiezan saludando por el nombre (sin emojis del perfil de WhatsApp)
    const nombre = primerNombre(props.clienteNombre);
    if (cant && nombre) iniciales[0] = nombre;
    setValores(iniciales);
    setValorBoton('');
    setError('');
    if (p.name === PLANTILLA_RETOMAR && cant >= 2) llenarTema();
  };

  useEffect(() => {
    fetch('/api/plantillas').then((r) => r.json()).then((j) => {
      const lista: Plantilla[] = (j.plantillas || [])
        .filter((p: Plantilla) => !INTERNAS.has(p.name) && (p.status === 'APPROVED' || EN_REVISION.has(p.status)))
        .sort((a: Plantilla, b: Plantilla) => orden(a) - orden(b));
      setPlantillas(lista);
      const sugerida = lista.find((p) => p.name === props.sugerida && p.status === 'APPROVED');
      if (sugerida) elegir(sugerida);
    }).finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const textoBase = cuerpo(elegida);
  const n = variables(textoBase);
  const boton = botonDinamico(elegida);
  const respuestasRapidas = botones(elegida).filter((b: any) => b.type === 'QUICK_REPLY');
  const campos = (elegida && CAMPOS[elegida.name]) || [];
  const retomarEnRevision = plantillas.some((p) => p.name === PLANTILLA_RETOMAR && EN_REVISION.has(p.status));

  const vistaPrevia = useMemo(
    () => textoBase.replace(/\{\{(\d+)\}\}/g, (_, i) => valores[Number(i) - 1] || `[${campos[Number(i) - 1]?.etiqueta || `campo ${i}`}]`),
    [textoBase, valores, campos]
  );

  const enviar = async () => {
    if (!elegida) return;
    if (valores.some((v) => !v.trim()) || (boton && !valorBoton.trim())) {
      setError('Completa todos los campos.');
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const res = await fetch(`/api/conversaciones/${props.conversacionId}/plantilla`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: elegida.name,
          idioma: elegida.language,
          parametros: valores,
          parametroBoton: boton ? valorBoton.trim() : undefined,
          texto: vistaPrevia,
        }),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error || 'No se pudo enviar.'); return; }
      props.onEnviada();
    } catch {
      setError('Sin conexión.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={props.onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-commerk-navy">Enviar plantilla de WhatsApp</h3>
            <p className="text-xs text-slate-400 mt-0.5">Solo plantillas aprobadas por Meta. Sirven aunque hayan pasado más de 24 h.</p>
          </div>
          <button onClick={props.onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">✕</button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[220px_1fr]">
          <div className="border-r border-slate-100 overflow-y-auto p-2">
            {cargando ? <p className="text-xs text-slate-400 p-3">Cargando…</p>
              : plantillas.length === 0 ? <p className="text-xs text-slate-400 p-3">No hay plantillas aprobadas.</p>
              : plantillas.map((p) => {
                const enRevision = EN_REVISION.has(p.status);
                const activa = elegida?.id === p.id;
                return (
                  <button key={p.id} onClick={() => !enRevision && elegir(p)} disabled={enRevision}
                    title={enRevision ? 'Meta todavía la está revisando: se podrá usar cuando la apruebe' : undefined}
                    className={`w-full text-left rounded-xl px-3 py-2.5 mb-1 transition-colors ${activa ? 'bg-commerk-navy text-white' : enRevision ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}>
                    <p className="text-sm font-semibold">{NOMBRES[p.name] || p.name}</p>
                    <p className={`text-[10px] ${activa ? 'text-white/70' : 'text-slate-400'}`}>
                      {enRevision ? 'En revisión de Meta' : p.category === 'MARKETING' ? 'Marketing' : 'Servicio'} · {p.name}
                    </p>
                  </button>
                );
              })}
          </div>

          <div className="overflow-y-auto p-5">
            {!elegida ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-slate-400 text-center">
                <p>Elige una plantilla</p>
                {retomarEnRevision && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 max-w-xs">
                    "Retomar conversación" está en revisión de Meta. Apenas la apruebe aparecerá aquí lista para usar.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {n > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Campos</p>
                    {valores.map((v, i) => {
                      const temaAutomatico = elegida.name === PLANTILLA_RETOMAR && i === 1;
                      return (
                        <div key={i}>
                          <label className="text-[11px] text-slate-500">
                            {campos[i]?.etiqueta || `Campo {{${i + 1}}}`}
                            {temaAutomatico && <span className="text-slate-400"> · sale solo de la conversación, puedes cambiarlo</span>}
                          </label>
                          <input value={v} onChange={(e) => setValores((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                            placeholder={temaAutomatico && buscandoTema ? 'Buscando el tema en la conversación…' : campos[i]?.ejemplo ? `Ej.: ${campos[i].ejemplo}` : undefined}
                            className="w-full mt-0.5 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-commerk-navy/40" />
                        </div>
                      );
                    })}
                  </div>
                )}
                {boton && (
                  <div>
                    <label className="text-[11px] text-slate-500">Botón "{boton.texto}" · completa el final del enlace</label>
                    <div className="flex items-center mt-0.5 border border-slate-200 rounded-xl overflow-hidden">
                      <span className="px-2 text-[11px] text-slate-400 bg-slate-50 py-2 truncate max-w-[55%]">{boton.url.replace('{{1}}', '')}</span>
                      <input value={valorBoton} onChange={(e) => setValorBoton(e.target.value)} className="flex-1 px-2 py-2 text-sm focus:outline-none" />
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Así lo recibe el cliente</p>
                  <div className="rounded-2xl bg-[#e7ffdb] border border-emerald-100 px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap">{vistaPrevia}</div>
                  {respuestasRapidas.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {respuestasRapidas.map((b: any) => (
                        <span key={b.text} className="px-3 py-1.5 rounded-xl bg-white border border-emerald-100 text-xs font-semibold text-sky-700">↩ {b.text}</span>
                      ))}
                    </div>
                  )}
                </div>
                {elegida.name === PLANTILLA_RETOMAR && (
                  <p className="text-[11px] text-slate-500">
                    Cuando el cliente responda, se abren otras 24 h para escribirle normal. Su respuesta te llega a ti, no a Sofi.
                  </p>
                )}
                {elegida.category === 'MARKETING' && (
                  <p className="text-[11px] text-slate-400">Las plantillas de marketing tienen un costo por envío en WhatsApp.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-3">
          {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
          <div className="ml-auto flex gap-2">
            <button onClick={props.onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
            <button onClick={enviar} disabled={!elegida || enviando || (buscandoTema && valores.some((v) => !v.trim()))}
              className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold hover:bg-commerk-navy/90 disabled:opacity-40">
              {enviando ? 'Enviando…' : buscandoTema && valores.some((v) => !v.trim()) ? 'Buscando el tema…' : 'Enviar plantilla'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
