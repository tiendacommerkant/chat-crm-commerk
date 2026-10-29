'use client';

// Panel "Estado del sistema": revisión en vivo de cada servicio y últimos errores
import { useCallback, useEffect, useState } from 'react';

type Chequeo = { servicio: string; ok: boolean; detalle: string; nivel?: 'ok' | 'aviso' | 'error' };
type Evento = { nivel: 'info' | 'aviso' | 'error'; origen: string; mensaje: string; created_at: string };

const COLOR = {
  ok: 'bg-emerald-500',
  aviso: 'bg-amber-400',
  error: 'bg-red-500',
};

export default function EstadoSistema() {
  const [chequeos, setChequeos] = useState<Chequeo[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [revisado, setRevisado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [verEventos, setVerEventos] = useState(false);

  const revisar = useCallback(async () => {
    setCargando(true);
    const j = await fetch('/api/sistema/estado').then((r) => r.json()).catch(() => null);
    if (j?.success) { setChequeos(j.chequeos); setEventos(j.eventos); setRevisado(j.revisado); }
    setCargando(false);
  }, []);

  useEffect(() => {
    revisar();
    const t = setInterval(revisar, 5 * 60_000);
    return () => clearInterval(t);
  }, [revisar]);

  const errores = chequeos.filter((c) => (c.nivel || (c.ok ? 'ok' : 'error')) === 'error').length;
  const avisos = chequeos.filter((c) => c.nivel === 'aviso').length;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-commerk-navy">Estado del sistema</h3>
          <p className="text-xs text-slate-400">
            {cargando ? 'Revisando…' : errores ? `${errores} servicio(s) con falla` : avisos ? `${avisos} aviso(s) por revisar` : 'Todo funcionando'}
            {revisado && !cargando && ` · ${new Date(revisado).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}`}
          </p>
        </div>
        <button onClick={revisar} disabled={cargando} className="text-xs font-semibold text-commerk-navy/70 hover:text-commerk-navy disabled:opacity-40">Revisar ahora</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {chequeos.map((c) => {
          const nivel = c.nivel || (c.ok ? 'ok' : 'error');
          return (
            <div key={c.servicio} className="flex items-start gap-2.5 rounded-xl border border-slate-100 px-3 py-2.5">
              <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${COLOR[nivel]}`} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700">{c.servicio}</p>
                <p className="text-[11px] text-slate-500 break-words">{c.detalle}</p>
              </div>
            </div>
          );
        })}
      </div>

      {eventos.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setVerEventos(!verEventos)} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
            {verEventos ? '▾' : '▸'} Últimos eventos ({eventos.length})
          </button>
          {verEventos && (
            <div className="mt-2 space-y-1 max-h-56 overflow-y-auto">
              {eventos.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${e.nivel === 'error' ? 'bg-red-500' : e.nivel === 'aviso' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                  <span className="text-slate-400 shrink-0">{new Date(e.created_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}</span>
                  <span className="text-slate-500 font-semibold shrink-0">{e.origen}</span>
                  <span className="text-slate-600">{e.mensaje}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
