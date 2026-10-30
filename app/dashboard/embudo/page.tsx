'use client';

// Embudo de ventas empresariales: empresas que compran regalos para su equipo o sus clientes
import { useCallback, useEffect, useState } from 'react';

const ETAPAS = [
  { k: 'nueva', l: 'Nueva', ayuda: 'Llegó por WhatsApp o se creó a mano' },
  { k: 'contactada', l: 'Contactada', ayuda: 'Ya hablamos con la empresa' },
  { k: 'cotizada', l: 'Cotizada', ayuda: 'Se envió la propuesta' },
  { k: 'ganada', l: 'Ganada', ayuda: 'Compró' },
  { k: 'perdida', l: 'Perdida', ayuda: 'No compró (con motivo)' },
] as const;

const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const dias = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

type Op = Record<string, any>;

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><div className="mt-1">{children}</div></label>;
}
const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-commerk-navy/40';

export default function EmbudoPage() {
  const [ops, setOps] = useState<Op[]>([]);
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Op | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const j = await fetch('/api/oportunidades').then((r) => r.json()).catch(() => null);
    if (j?.success) { setOps(j.oportunidades); setAviso(j.aviso || ''); }
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (datos: Op) => {
    setGuardando(true); setError('');
    const nueva = !datos.id;
    const j = await fetch('/api/oportunidades', {
      method: nueva ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos),
    }).then((r) => r.json()).catch(() => null);
    setGuardando(false);
    if (!j?.success) { setError(j?.error || 'No se pudo guardar'); return false; }
    setEditando(null);
    cargar();
    return true;
  };

  const mover = async (op: Op, etapa: string) => {
    if (etapa === 'perdida') { setEditando({ ...op, etapa: 'perdida' }); return; }
    setOps((prev) => prev.map((o) => (o.id === op.id ? { ...o, etapa } : o)));
    await guardar({ id: op.id, etapa });
  };

  const abiertas = ops.filter((o) => ['nueva', 'contactada', 'cotizada'].includes(o.etapa));
  const valorAbierto = abiertas.reduce((s, o) => s + Number(o.valor_estimado || 0), 0);
  const ganadas = ops.filter((o) => o.etapa === 'ganada');

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Embudo de ventas empresariales</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {abiertas.length} oportunidades abiertas · {cop(valorAbierto)} en juego · {ganadas.length} ganadas en los últimos 60 días por {cop(ganadas.reduce((s, o) => s + Number(o.valor_estimado || 0), 0))}
          </p>
        </div>
        <button onClick={() => setEditando({ etapa: 'nueva' })} className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold hover:bg-commerk-navy/90">
          + Nueva oportunidad
        </button>
      </div>

      {aviso && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>}

      {cargando ? <p className="text-sm text-slate-400">Cargando…</p> : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
          {ETAPAS.map((etapa, i) => {
            const columna = ops.filter((o) => o.etapa === etapa.k);
            const valor = columna.reduce((s, o) => s + Number(o.valor_estimado || 0), 0);
            return (
              <div key={etapa.k} className="bg-slate-100/70 rounded-2xl p-3 min-h-[120px]">
                <div className="px-1 pb-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-700">{etapa.l}</h2>
                    <span className="text-xs font-semibold text-slate-500">{columna.length}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">{valor ? cop(valor) : etapa.ayuda}</p>
                </div>
                <div className="space-y-2">
                  {columna.map((o) => (
                    <div key={o.id} className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
                      <button onClick={() => setEditando(o)} className="text-left w-full">
                        <p className="text-sm font-semibold text-slate-800 truncate">{o.empresa || o.contacto || o.cliente?.nombre || 'Sin nombre'}</p>
                        {o.empresa && (o.contacto || o.cliente?.nombre) && <p className="text-xs text-slate-500 truncate">{o.contacto || o.cliente?.nombre}</p>}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-slate-600">
                          {o.valor_estimado ? <span className="font-semibold">{cop(o.valor_estimado)}</span> : null}
                          {o.unidades ? <span>{o.unidades} uds</span> : null}
                          {o.correo ? <span className="truncate max-w-full">✉ {o.correo}</span> : <span className="text-amber-700">Sin correo</span>}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {o.asignado_nombre ? `${o.asignado_nombre} · ` : ''}{dias(o.updated_at) === 0 ? 'actualizada hoy' : `sin cambios hace ${dias(o.updated_at)} d`}
                        </p>
                        {o.etapa === 'perdida' && o.motivo_perdida && <p className="text-[11px] text-red-600 mt-1">Motivo: {o.motivo_perdida}</p>}
                      </button>
                      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
                        {i > 0 && etapa.k !== 'perdida' && (
                          <button onClick={() => mover(o, ETAPAS[i - 1].k)} className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:bg-slate-100" title={`Volver a ${ETAPAS[i - 1].l}`}>←</button>
                        )}
                        {i < 3 && (
                          <button onClick={() => mover(o, ETAPAS[i + 1].k)} className="flex-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-commerk-navy bg-commerk-navy/5 hover:bg-commerk-navy/10">
                            {ETAPAS[i + 1].l} →
                          </button>
                        )}
                        {o.conversacion_id && o.cliente?.id && (
                          <a href={`/dashboard/conversaciones?cliente=${o.cliente.id}`} className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:bg-slate-100" title="Abrir el chat">💬</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editando && (
        <ModalOportunidad op={editando} error={error} guardando={guardando}
          onClose={() => { setEditando(null); setError(''); }} onGuardar={guardar} />
      )}
    </div>
  );
}

function ModalOportunidad({ op, error, guardando, onClose, onGuardar }: {
  op: Op; error: string; guardando: boolean; onClose: () => void; onGuardar: (d: Op) => Promise<boolean>;
}) {
  const [d, setD] = useState<Op>({
    empresa: op.empresa || '', contacto: op.contacto || op.cliente?.nombre || '', telefono: op.telefono || op.cliente?.telefono || '',
    correo: op.correo || '', necesidad: op.necesidad || '', notas: op.notas || '', valor_estimado: op.valor_estimado ?? '',
    unidades: op.unidades ?? '', etapa: op.etapa || 'nueva', motivo_perdida: op.motivo_perdida || '',
  });
  const set = (k: string, v: any) => setD((x) => ({ ...x, [k]: v }));
  const nueva = !op.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-commerk-navy">{nueva ? 'Nueva oportunidad' : d.empresa || d.contacto || 'Oportunidad'}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">✕</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo label="Empresa"><input className={inputCls} value={d.empresa} onChange={(e) => set('empresa', e.target.value)} /></Campo>
          <Campo label="Contacto"><input className={inputCls} value={d.contacto} onChange={(e) => set('contacto', e.target.value)} /></Campo>
          <Campo label="Teléfono"><input className={inputCls} value={d.telefono} onChange={(e) => set('telefono', e.target.value)} /></Campo>
          <Campo label="Correo"><input className={inputCls} type="email" value={d.correo} onChange={(e) => set('correo', e.target.value)} /></Campo>
          <Campo label="Valor estimado (COP)"><input className={inputCls} type="number" min={0} value={d.valor_estimado} onChange={(e) => set('valor_estimado', e.target.value)} /></Campo>
          <Campo label="Unidades"><input className={inputCls} type="number" min={0} value={d.unidades} onChange={(e) => set('unidades', e.target.value)} /></Campo>
        </div>
        <Campo label="Qué necesita"><textarea className={inputCls} rows={3} value={d.necesidad} onChange={(e) => set('necesidad', e.target.value)} /></Campo>
        <Campo label="Notas del equipo"><textarea className={inputCls} rows={3} value={d.notas} onChange={(e) => set('notas', e.target.value)} /></Campo>
        {!nueva && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Etapa">
              <select className={inputCls + ' bg-white'} value={d.etapa} onChange={(e) => set('etapa', e.target.value)}>
                {ETAPAS.map((e) => <option key={e.k} value={e.k}>{e.l}</option>)}
              </select>
            </Campo>
            {d.etapa === 'perdida' && (
              <Campo label="¿Por qué se perdió?"><input className={inputCls} value={d.motivo_perdida} onChange={(e) => set('motivo_perdida', e.target.value)} placeholder="Ej. precio, tiempos de entrega, eligió otro proveedor" /></Campo>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600">Cancelar</button>
          <button onClick={() => onGuardar(nueva ? d : { ...d, id: op.id, ...(d.etapa === op.etapa ? { etapa: undefined } : {}) })} disabled={guardando}
            className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold disabled:opacity-40">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
