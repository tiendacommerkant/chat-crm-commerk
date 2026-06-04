'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

interface Componente {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
}

interface Plantilla {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: Componente[];
  rejected_reason?: string;
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: 'Aprobada',      cls: 'bg-emerald-100 text-emerald-700' },
  PENDING:  { label: 'En revisión',   cls: 'bg-amber-100 text-amber-700' },
  REJECTED: { label: 'Rechazada',     cls: 'bg-red-100 text-red-700' },
  PAUSED:   { label: 'Pausada',       cls: 'bg-slate-100 text-slate-600' },
  DISABLED: { label: 'Deshabilitada', cls: 'bg-slate-100 text-slate-400' },
};

const CAT_CLS: Record<string, string> = {
  MARKETING:      'bg-purple-100 text-purple-700',
  UTILITY:        'bg-blue-100 text-blue-700',
  AUTHENTICATION: 'bg-orange-100 text-orange-700',
};

export default function PlantillasPage() {
  const [plantillas, setPlantillas]   = useState<Plantilla[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [sel, setSel]                 = useState<Plantilla | null>(null);
  const [editando, setEditando]       = useState(false);
  const [bodyEdit, setBodyEdit]       = useState('');
  const [guardando, setGuardando]     = useState(false);
  const [msg, setMsg]                 = useState('');
  const [eliminando, setEliminando]   = useState<string | null>(null);
  const [filtro, setFiltro]           = useState('TODAS');
  const [busqueda, setBusqueda]       = useState('');

  async function cargar() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/plantillas');
      const d = await r.json();
      if (d.success) setPlantillas(d.plantillas);
      else setError(d.error || 'Error al cargar');
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  }

  useEffect(() => { cargar(); }, []);

  function abrir(p: Plantilla) {
    setSel(p); setEditando(false); setMsg('');
    setBodyEdit(p.components.find((c) => c.type === 'BODY')?.text || '');
  }

  async function guardar() {
    if (!sel) return;
    setGuardando(true); setMsg('');
    try {
      const components = sel.components.map((c) => c.type === 'BODY' ? { ...c, text: bodyEdit } : c);
      const r = await fetch(`/api/plantillas/${sel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components }),
      });
      const d = await r.json();
      setMsg(d.success ? '✅ Enviado a Meta para revisión' : '❌ ' + (d.error || 'Error'));
      if (d.success) { setEditando(false); cargar(); }
    } catch { setMsg('❌ Error de conexión'); }
    finally { setGuardando(false); }
  }

  async function eliminar(p: Plantilla) {
    if (!confirm(`¿Eliminar la plantilla "${p.name}"?`)) return;
    setEliminando(p.id);
    try {
      const r = await fetch(`/api/plantillas/${p.id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) { if (sel?.id === p.id) setSel(null); cargar(); }
      else alert('Error: ' + (d.error || 'No se pudo eliminar'));
    } catch { alert('Error de conexión'); }
    finally { setEliminando(null); }
  }

  const filtradas = plantillas.filter((p) =>
    (filtro === 'TODAS' || p.status === filtro) &&
    (!busqueda || p.name.toLowerCase().includes(busqueda.toLowerCase()))
  );

  return (
    <div className="p-6 lg:p-8 space-y-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Plantillas WhatsApp</h1>
          <p className="text-sm text-slate-500 mt-0.5">Plantillas aprobadas por Meta — {plantillas.length} en total</p>
        </div>
        <button onClick={cargar} className="flex items-center gap-2 px-4 py-2 bg-commerk-navy text-white rounded-xl text-sm font-medium hover:bg-commerk-navy/90 transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* Chips de estado */}
      <div className="flex flex-wrap gap-2">
        {['TODAS', 'APPROVED', 'PENDING', 'REJECTED', 'PAUSED'].map((s) => {
          const count = s === 'TODAS' ? plantillas.length : plantillas.filter((p) => p.status === s).length;
          const cfg = STATUS_CFG[s] || { label: s, cls: 'bg-slate-100 text-slate-600' };
          return (
            <button
              key={s}
              onClick={() => setFiltro(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${filtro === s ? 'border-commerk-navy shadow-sm' : 'border-transparent'} ${cfg.cls}`}
            >
              {s === 'TODAS' ? 'Todas' : cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Buscador */}
      <input
        type="text"
        placeholder="Buscar por nombre..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="w-full max-w-sm px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-commerk-navy/20"
      />

      {/* Layout lista + detalle */}
      <div className="flex-1 flex gap-6 min-h-0 overflow-hidden">
        {/* Lista */}
        <div className="w-80 shrink-0 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
            </div>
          ) : error ? (
            <Card className="p-5 text-center">
              <p className="text-red-500 text-sm">{error}</p>
              <button onClick={cargar} className="mt-2 text-sm text-commerk-navy underline">Reintentar</button>
            </Card>
          ) : filtradas.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Sin resultados</p>
          ) : (
            filtradas.map((p) => {
              const cfg = STATUS_CFG[p.status] || STATUS_CFG.DISABLED;
              const body = p.components.find((c) => c.type === 'BODY');
              return (
                <button
                  key={p.id}
                  onClick={() => abrir(p)}
                  className={`w-full text-left p-4 rounded-xl border transition ${sel?.id === p.id ? 'border-commerk-navy bg-commerk-navy/5' : 'border-slate-200 bg-white hover:border-commerk-navy/40 hover:shadow-sm'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${cfg.cls}`}>{cfg.label}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CAT_CLS[p.category] || 'bg-slate-100 text-slate-600'}`}>{p.category}</span>
                    <span className="text-xs text-slate-400">{p.language}</span>
                  </div>
                  {body?.text && <p className="text-xs text-slate-500 mt-2 line-clamp-2">{body.text}</p>}
                </button>
              );
            })
          )}
        </div>

        {/* Detalle */}
        {sel ? (
          <Card className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-commerk-navy">{sel.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${(STATUS_CFG[sel.status] || STATUS_CFG.DISABLED).cls}`}>
                    {(STATUS_CFG[sel.status] || STATUS_CFG.DISABLED).label}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${CAT_CLS[sel.category] || 'bg-slate-100 text-slate-600'}`}>{sel.category}</span>
                  <span className="text-xs text-slate-400">{sel.language}</span>
                  <span className="text-xs text-slate-300 font-mono">{sel.id}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {(sel.status === 'REJECTED' || sel.status === 'PAUSED') && !editando && (
                  <button onClick={() => setEditando(true)} className="px-3 py-1.5 bg-commerk-navy text-white rounded-lg text-xs font-medium hover:bg-commerk-navy/90">
                    Editar texto
                  </button>
                )}
                <button
                  onClick={() => eliminar(sel)}
                  disabled={eliminando === sel.id}
                  className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50"
                >
                  {eliminando === sel.id ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>

            {sel.status === 'REJECTED' && sel.rejected_reason && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-red-700 mb-1">Razón del rechazo:</p>
                <p className="text-sm text-red-600">{sel.rejected_reason}</p>
              </div>
            )}

            {sel.status === 'APPROVED' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                ⚠️ Las plantillas <strong>aprobadas</strong> no se pueden editar. Para modificarlas elimínala y créala de nuevo desde Meta Business Manager.
              </div>
            )}

            {/* Componentes */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-700">Componentes</p>
              {sel.components.map((comp, i) => (
                <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 flex items-center gap-2 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-600 uppercase">{comp.type}</span>
                    {comp.format && <span className="text-xs text-slate-400">({comp.format})</span>}
                  </div>
                  <div className="p-4">
                    {comp.type === 'BODY' && editando ? (
                      <textarea
                        value={bodyEdit}
                        onChange={(e) => setBodyEdit(e.target.value)}
                        rows={6}
                        className="w-full text-sm border border-slate-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-commerk-navy/20 resize-none font-mono"
                        placeholder="Texto del mensaje..."
                      />
                    ) : comp.text ? (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{comp.text}</p>
                    ) : comp.buttons ? (
                      <div className="space-y-2">
                        {comp.buttons.map((btn, j) => (
                          <div key={j} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-lg">
                            <span className="text-xs bg-commerk-navy/10 text-commerk-navy px-2 py-0.5 rounded font-medium">{btn.type}</span>
                            <span className="text-sm font-medium text-slate-700">{btn.text}</span>
                            {btn.url && <span className="text-xs text-blue-500 truncate">{btn.url}</span>}
                            {btn.phone_number && <span className="text-xs text-slate-400">{btn.phone_number}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">Sin texto</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {editando && (
              <div className="flex items-center gap-3 pt-2">
                <button onClick={guardar} disabled={guardando} className="px-5 py-2 bg-commerk-green text-commerk-navy font-semibold rounded-xl text-sm hover:bg-commerk-green/90 disabled:opacity-50">
                  {guardando ? 'Enviando...' : 'Enviar a revisión'}
                </button>
                <button onClick={() => { setEditando(false); setMsg(''); }} className="px-4 py-2 text-slate-500 rounded-xl text-sm hover:bg-slate-100">
                  Cancelar
                </button>
                {msg && <p className="text-sm">{msg}</p>}
              </div>
            )}

            {/* Preview */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Vista previa</p>
              </div>
              <div className="p-4 bg-[#e5ddd5]">
                <div className="bg-white rounded-xl p-4 shadow-sm max-w-xs">
                  {sel.components.map((comp, i) => {
                    if (comp.type === 'HEADER' && comp.text) return <p key={i} className="font-bold text-sm text-slate-800 mb-2">{comp.text}</p>;
                    if (comp.type === 'BODY') return <p key={i} className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{editando ? bodyEdit : comp.text}</p>;
                    if (comp.type === 'FOOTER' && comp.text) return <p key={i} className="text-xs text-slate-400 mt-2">{comp.text}</p>;
                    return null;
                  })}
                  {sel.components.filter((c) => c.type === 'BUTTONS').flatMap((comp, i) =>
                    (comp.buttons || []).map((btn, j) => (
                      <button key={`${i}-${j}`} className="w-full mt-2 py-1.5 text-sm text-[#00a5f4] font-medium border-t border-slate-100 text-left">
                        {btn.text}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-3 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-sm">Selecciona una plantilla para ver detalles</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
