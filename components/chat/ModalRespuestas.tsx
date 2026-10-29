'use client';

// Administrar las respuestas rápidas del equipo (se usan escribiendo "/atajo")
import { useState } from 'react';
import type { RespuestaRapida } from './Compositor';

export function ModalRespuestas(props: {
  respuestas: RespuestaRapida[];
  editable: boolean;
  onClose: () => void;
  onCambio: () => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [atajo, setAtajo] = useState('');
  const [contenido, setContenido] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const empezar = (r?: RespuestaRapida) => {
    setEditando(r?.id || 'nueva');
    setAtajo(r?.atajo || '');
    setContenido(r?.contenido || '');
    setError('');
  };

  const guardar = async () => {
    setGuardando(true);
    setError('');
    const nueva = editando === 'nueva';
    const res = await fetch('/api/respuestas-rapidas', {
      method: nueva ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nueva ? { atajo, contenido } : { id: editando, atajo, contenido }),
    }).then((r) => r.json()).catch(() => ({ success: false, error: 'Sin conexión' }));
    setGuardando(false);
    if (!res.success) { setError(res.error || 'No se pudo guardar'); return; }
    setEditando(null);
    props.onCambio();
  };

  const borrar = async (id: string) => {
    if (!confirm('¿Borrar esta respuesta rápida?')) return;
    await fetch(`/api/respuestas-rapidas?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    props.onCambio();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={props.onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-commerk-navy">Respuestas rápidas</h3>
            <p className="text-xs text-slate-400 mt-0.5">Escribe <b>/atajo</b> en el chat para usarlas.</p>
          </div>
          <button onClick={props.onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {!props.editable && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Para crear y editar respuestas hay que correr la migración de atención en Supabase. Mientras tanto se usan las predeterminadas.
            </p>
          )}
          {props.respuestas.map((r) => editando === r.id ? null : (
            <div key={r.id} className="group rounded-xl border border-slate-100 px-3 py-2.5 hover:border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-commerk-navy">/{r.atajo}</span>
                {props.editable && (
                  <div className="ml-auto flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => empezar(r)} className="text-[11px] text-slate-500 hover:text-commerk-navy">Editar</button>
                    <button onClick={() => borrar(r.id)} className="text-[11px] text-slate-500 hover:text-red-600">Borrar</button>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{r.contenido}</p>
            </div>
          ))}

          {editando && (
            <div className="rounded-xl border border-commerk-navy/20 bg-commerk-navy/[0.03] p-3 space-y-2">
              <input value={atajo} onChange={(e) => setAtajo(e.target.value)} placeholder="atajo (ej. horarios)"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-commerk-navy/40" />
              <textarea value={contenido} onChange={(e) => setContenido(e.target.value)} rows={4} placeholder="Texto que se enviará al cliente"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:border-commerk-navy/40" />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditando(null)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600">Cancelar</button>
                <button onClick={guardar} disabled={guardando || !atajo.trim() || !contenido.trim()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-commerk-navy text-white font-semibold disabled:opacity-40">
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          )}
        </div>

        {props.editable && !editando && (
          <div className="px-4 py-3 border-t border-slate-100">
            <button onClick={() => empezar()} className="w-full py-2 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 hover:border-commerk-navy/30 hover:text-commerk-navy">
              + Nueva respuesta rápida
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
