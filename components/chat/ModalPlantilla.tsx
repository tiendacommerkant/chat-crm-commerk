'use client';

// Elegir una plantilla aprobada, llenar sus campos y enviarla.
// Es la forma de escribirle a un cliente pasadas 24 h de su último mensaje.
import { useEffect, useMemo, useState } from 'react';

type Plantilla = { id: string; name: string; status: string; category: string; language: string; components: any[] };

const NOMBRES: Record<string, string> = {
  recordatorio_pago: 'Recordatorio de pago',
  carrito_abandonado: 'Recuperación de carrito',
  confirmacion_pago: 'Confirmación de pago',
  pedido_en_camino: 'Pedido en camino',
  pedido_recoger_sede: 'Pedido para recoger en sede',
  lead_mayorista: 'Aviso de lead mayorista',
};

function cuerpo(p: Plantilla | null): string {
  return p?.components?.find((c) => c.type === 'BODY')?.text || '';
}
function variables(texto: string): number {
  const nums = Array.from(texto.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}
function botonDinamico(p: Plantilla | null): { texto: string; url: string } | null {
  const botones = p?.components?.find((c) => c.type === 'BUTTONS')?.buttons || [];
  const b = botones.find((x: any) => x.type === 'URL' && /\{\{1\}\}/.test(x.url || ''));
  return b ? { texto: b.text, url: b.url } : null;
}

export function ModalPlantilla(props: {
  conversacionId: string;
  clienteNombre?: string | null;
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

  useEffect(() => {
    fetch('/api/plantillas').then((r) => r.json()).then((j) => {
      setPlantillas((j.plantillas || []).filter((p: Plantilla) => p.status === 'APPROVED'));
    }).finally(() => setCargando(false));
  }, []);

  const textoBase = cuerpo(elegida);
  const n = variables(textoBase);
  const boton = botonDinamico(elegida);

  const elegir = (p: Plantilla) => {
    setElegida(p);
    const cant = variables(cuerpo(p));
    const iniciales = Array.from({ length: cant }, () => '');
    // Casi todas empiezan saludando por el nombre
    if (cant && props.clienteNombre) iniciales[0] = props.clienteNombre.split(' ')[0];
    setValores(iniciales);
    setValorBoton('');
    setError('');
  };

  const vistaPrevia = useMemo(
    () => textoBase.replace(/\{\{(\d+)\}\}/g, (_, i) => valores[Number(i) - 1] || `[campo ${i}]`),
    [textoBase, valores]
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
              : plantillas.map((p) => (
                <button key={p.id} onClick={() => elegir(p)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 mb-1 transition-colors ${elegida?.id === p.id ? 'bg-commerk-navy text-white' : 'hover:bg-slate-50'}`}>
                  <p className="text-sm font-semibold">{NOMBRES[p.name] || p.name}</p>
                  <p className={`text-[10px] ${elegida?.id === p.id ? 'text-white/70' : 'text-slate-400'}`}>
                    {p.category === 'MARKETING' ? 'Marketing' : 'Servicio'} · {p.name}
                  </p>
                </button>
              ))}
          </div>

          <div className="overflow-y-auto p-5">
            {!elegida ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">Elige una plantilla</div>
            ) : (
              <div className="space-y-4">
                {n > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Campos</p>
                    {valores.map((v, i) => (
                      <div key={i}>
                        <label className="text-[11px] text-slate-500">Campo {`{{${i + 1}}}`}</label>
                        <input value={v} onChange={(e) => setValores((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                          className="w-full mt-0.5 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-commerk-navy/40" />
                      </div>
                    ))}
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
                </div>
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
            <button onClick={enviar} disabled={!elegida || enviando}
              className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold hover:bg-commerk-navy/90 disabled:opacity-40">
              {enviando ? 'Enviando…' : 'Enviar plantilla'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
