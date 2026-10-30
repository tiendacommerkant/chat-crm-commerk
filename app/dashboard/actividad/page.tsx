'use client';

// Registro de actividad: quién hizo qué en el CRM (solo administradores)
import { useEffect, useState } from 'react';

const GRUPOS = [
  { k: '', l: 'Todo' }, { k: 'conversacion', l: 'Conversaciones' }, { k: 'mensaje', l: 'Mensajes' },
  { k: 'oportunidad', l: 'Embudo' }, { k: 'difusion', l: 'Difusiones' }, { k: 'equipo', l: 'Equipo' },
  { k: 'configuracion', l: 'Configuración' }, { k: 'sesion', l: 'Ingresos' },
];

const fecha = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });

function detalleLegible(e: any): string {
  const d = e.detalle || {};
  const partes: string[] = [];
  if (e.cliente) partes.push(`Cliente: ${e.cliente}`);
  if (d.a) partes.push(`a ${d.a}`);
  if (d.etiqueta !== undefined) partes.push(d.etiqueta ? `etiqueta ${d.etiqueta}` : 'quitó la etiqueta');
  if (d.plantilla) partes.push(`plantilla ${d.plantilla}`);
  if (d.archivo) partes.push(d.archivo);
  if (d.encuesta !== undefined) partes.push(d.encuesta ? 'con encuesta' : 'sin encuesta');
  if (d.email) partes.push(d.email);
  if (d.rol) partes.push(`rol ${d.rol}`);
  if (d.acceso !== undefined) partes.push(d.acceso ? 'con acceso' : 'sin acceso');
  if (d.etapa) partes.push(`→ ${d.etapa}`);
  if (d.total !== undefined) partes.push(`${d.total} destinatarios`);
  if (d.sincronizados !== undefined) partes.push(`${d.sincronizados} productos`);
  if (d.bot_activo !== undefined) partes.push(d.bot_activo ? 'encendió el bot' : 'apagó el bot');
  return partes.join(' · ');
}

export default function ActividadPage() {
  const [eventos, setEventos] = useState<any[]>([]);
  const [actores, setActores] = useState<{ email: string; nombre: string }[]>([]);
  const [dias, setDias] = useState(7);
  const [actor, setActor] = useState('');
  const [grupo, setGrupo] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    const p = new URLSearchParams({ dias: String(dias) });
    if (actor) p.set('actor', actor);
    if (grupo) p.set('grupo', grupo);
    fetch(`/api/auditoria?${p}`).then((r) => r.json()).then((j) => {
      if (!j.success) { setAviso(j.error || 'No se pudo cargar'); setEventos([]); return; }
      setEventos(j.eventos); setAviso(j.aviso || '');
      if (!actor) setActores(j.actores || []);
    }).finally(() => setCargando(false));
  }, [dias, actor, grupo]);

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-commerk-navy">Actividad</h1>
        <p className="text-sm text-slate-500 mt-0.5">Quién hizo qué en el CRM: conversaciones, mensajes, embudo, difusiones, equipo y configuración.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
          <option value={1}>Hoy y ayer</option><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option>
        </select>
        <select value={actor} onChange={(e) => setActor(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white">
          <option value="">Todas las personas</option>
          {actores.map((a) => <option key={a.email} value={a.email}>{a.nombre}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {GRUPOS.map((g) => (
            <button key={g.k} onClick={() => setGrupo(g.k)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${grupo === g.k ? 'bg-commerk-navy text-white border-commerk-navy' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {g.l}
            </button>
          ))}
        </div>
      </div>

      {aviso && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="text-left px-5 py-3 font-semibold w-36">Cuándo</th><th className="text-left px-5 py-3 font-semibold w-48">Quién</th><th className="text-left px-5 py-3 font-semibold">Qué hizo</th></tr>
          </thead>
          <tbody>
            {cargando && eventos.length === 0 && <tr><td colSpan={3} className="px-5 py-6 text-center text-slate-400">Cargando…</td></tr>}
            {!cargando && eventos.length === 0 && <tr><td colSpan={3} className="px-5 py-6 text-center text-slate-400">Sin actividad en este periodo.</td></tr>}
            {eventos.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 align-top">
                <td className="px-5 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fecha(e.created_at)}</td>
                <td className="px-5 py-2.5 text-slate-700">{e.actor_nombre || e.actor}</td>
                <td className="px-5 py-2.5">
                  <p className="text-slate-800">{e.accion_legible}</p>
                  {detalleLegible(e) && <p className="text-xs text-slate-500 mt-0.5">{detalleLegible(e)}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">Se muestran hasta 500 registros. El registro empezó con esta versión del CRM.</p>
    </div>
  );
}
