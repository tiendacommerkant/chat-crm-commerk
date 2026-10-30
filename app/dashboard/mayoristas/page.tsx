'use client';

// Leads mayoristas: clientes que pidieron precio por mayor y el bot envió a
// una sede. Cada sede ve solo los suyos y los marca a medida que los atiende.
import { useCallback, useEffect, useState } from 'react';
import { contactoVisible, esIdUsuarioWhatsApp } from '@/lib/whatsapp-id';

type Estado = 'nuevo' | 'contactado' | 'vendido' | 'no_concretado';
type Lead = {
  id: string;
  cliente_id: string | null;
  nombre_cliente: string;
  telefono_cliente: string;
  sede: string;
  mensaje_original: string | null;
  estado: Estado;
  nota: string | null;
  atendido_por: string | null;
  updated_at: string | null;
  created_at: string;
};

const ESTADOS: { k: Estado; label: string; cls: string }[] = [
  { k: 'nuevo', label: 'Nuevo', cls: 'bg-red-50 text-red-700 border-red-200' },
  { k: 'contactado', label: 'Contactado', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { k: 'vendido', label: 'Vendido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { k: 'no_concretado', label: 'No se concretó', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
];

const hace = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${Math.max(min, 1)} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  const dias = Math.round(min / 1440);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
};
const fecha = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });

export default function MayoristasPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contadores, setContadores] = useState<Record<string, number>>({});
  const [sedes, setSedes] = useState<string[]>([]);
  const [yo, setYo] = useState<{ rol: string; sede: string | null } | null>(null);
  const [sede, setSede] = useState('');
  const [filtro, setFiltro] = useState<Estado | 'todos'>('nuevo');
  const [seguimiento, setSeguimiento] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    const j = await fetch(`/api/mayoristas${sede ? `?sede=${encodeURIComponent(sede)}` : ''}`).then((r) => r.json()).catch(() => null);
    if (j?.success) {
      setLeads(j.leads); setContadores(j.contadores); setSedes(j.sedes); setYo(j.yo); setSeguimiento(j.seguimiento); setError('');
    } else setError(j?.error || 'No se pudieron cargar los leads');
    setCargando(false);
  }, [sede]);
  useEffect(() => { cargar(); const t = setInterval(cargar, 60_000); return () => clearInterval(t); }, [cargar]);

  const guardar = async (id: string, cambios: Partial<Pick<Lead, 'estado' | 'nota'>>) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
    const j = await fetch('/api/mayoristas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...cambios }) })
      .then((r) => r.json()).catch(() => null);
    if (!j?.success) setAviso(j?.error || 'No se pudo guardar');
    cargar();
  };

  const esSede = yo?.rol === 'sede';
  const visibles = filtro === 'todos' ? leads : leads.filter((l) => l.estado === filtro);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Leads mayoristas</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {esSede
              ? `Clientes que pidieron precio por mayor en ${yo?.sede}. Escríbeles y marca cómo va cada uno.`
              : 'Clientes que pidieron precio por mayor y el bot envió a cada sede.'}
          </p>
        </div>
        {!esSede && sedes.length > 0 && (
          <select value={sede} onChange={(e) => { setSede(e.target.value); setCargando(true); }}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
            <option value="">Todas las sedes</option>
            {sedes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {!seguimiento && !esSede && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Para guardar el seguimiento falta correr <b>sql/migracion_2026_10_sedes.sql</b> en Supabase.
        </div>
      )}
      {aviso && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex justify-between gap-3">
          <span>{aviso}</span><button onClick={() => setAviso('')} className="text-red-400">✕</button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {[...ESTADOS, { k: 'todos' as const, label: 'Todos', cls: '' }].map((e) => {
          const n = e.k === 'todos' ? leads.length : contadores[e.k] || 0;
          return (
            <button key={e.k} onClick={() => setFiltro(e.k)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                filtro === e.k ? 'bg-commerk-navy text-white border-commerk-navy' : 'bg-white text-slate-600 border-slate-200 hover:border-commerk-navy/40'
              }`}>
              {e.label} <span className="opacity-70">({n})</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">{error}</div>
      ) : cargando && !leads.length ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white px-5 py-10 text-center text-sm text-slate-400">
          {filtro === 'nuevo' ? 'No hay leads nuevos por atender 🎉' : 'No hay leads en este estado.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visibles.map((l) => {
            const conNumero = !esIdUsuarioWhatsApp(l.telefono_cliente);
            return (
              <div key={l.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800">{l.nombre_cliente || 'Sin nombre'}</p>
                      {!esSede && <span className="text-[11px] px-2 py-0.5 rounded-full bg-commerk-navy/5 text-commerk-navy">{l.sede}</span>}
                      <span className="text-xs text-slate-400" title={fecha(l.created_at)}>{hace(l.created_at)}</span>
                    </div>
                    <p className="text-sm text-commerk-green mt-0.5">{contactoVisible(l.telefono_cliente)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!esSede && l.cliente_id && (
                      <a href={`/dashboard/conversaciones?cliente=${l.cliente_id}`}
                        className="inline-flex items-center justify-center px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:border-commerk-navy/40">
                        Abrir chat
                      </a>
                    )}
                    {conNumero && (
                      <a href={`https://wa.me/${l.telefono_cliente.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#25D366] text-white text-xs font-semibold hover:opacity-90">
                        Escribir por WhatsApp
                      </a>
                    )}
                  </div>
                </div>
                {!conNumero && esSede && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                    Este cliente oculta su número en WhatsApp: el equipo de Commerk le puede responder desde el chat del CRM. Pídeles que te pasen el contacto.
                  </p>
                )}

                {l.mensaje_original && (
                  <p className="text-sm text-slate-600 bg-slate-50 rounded-xl px-3 py-2 whitespace-pre-wrap">“{l.mensaje_original}”</p>
                )}

                <div className="flex gap-1.5 flex-wrap">
                  {ESTADOS.map((e) => (
                    <button key={e.k} onClick={() => l.estado !== e.k && guardar(l.id, { estado: e.k })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${l.estado === e.k ? e.cls : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'}`}>
                      {e.label}
                    </button>
                  ))}
                </div>

                <textarea defaultValue={l.nota || ''} placeholder="Nota (qué se habló, cantidades, próximo paso…)" rows={2}
                  onBlur={(e) => { if ((e.target.value.trim() || null) !== (l.nota || null)) guardar(l.id, { nota: e.target.value }); }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-commerk-navy/40 resize-none" />
                {l.atendido_por && l.updated_at && (
                  <p className="text-[11px] text-slate-400">Última actualización: {l.atendido_por} · {fecha(l.updated_at)}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
