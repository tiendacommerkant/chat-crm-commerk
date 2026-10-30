'use client';

// Difusiones: mensajes con plantilla aprobada a un grupo de clientes
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ETIQUETAS } from '@/components/chat/base';
import { SEDES_FISICAS } from '@/lib/sedes';

const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const fecha = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
const ESTADO: Record<string, { l: string; cls: string }> = {
  enviando: { l: 'Enviando', cls: 'bg-amber-50 text-amber-700' },
  completada: { l: 'Completada', cls: 'bg-emerald-50 text-emerald-700' },
  cancelada: { l: 'Cancelada', cls: 'bg-slate-100 text-slate-500' },
  borrador: { l: 'Borrador', cls: 'bg-slate-100 text-slate-500' },
};
const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-commerk-navy/40 bg-white';

type Plantilla = { id: string; name: string; status: string; category: string; language: string; components: any[] };

export default function DifusionesPage() {
  const [difusiones, setDifusiones] = useState<any[]>([]);
  const [aviso, setAviso] = useState('');
  const [nueva, setNueva] = useState(false);
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  const detener = useRef(false);

  const cargar = useCallback(async () => {
    const j = await fetch('/api/difusiones').then((r) => r.json()).catch(() => null);
    if (j?.success) { setDifusiones(j.difusiones); setAviso(j.aviso || ''); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // Envía por lotes mostrando el avance; si se cierra la página, se retoma con "Continuar"
  const continuar = useCallback(async (id: string) => {
    setEnviandoId(id);
    detener.current = false;
    while (!detener.current) {
      const r = await fetch(`/api/difusiones/${id}/enviar`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
      if (!r?.success) { setAviso(r?.error || 'Se interrumpió el envío. Puedes continuarlo.'); break; }
      setDifusiones((prev) => prev.map((d) => (d.id === id ? { ...d, ...r } : d)));
      if (r.estado !== 'enviando') break;
    }
    setEnviandoId(null);
    cargar();
  }, [cargar]);

  const cancelar = async (id: string) => {
    if (!confirm('¿Detener esta difusión? Lo que ya se envió no se puede recoger.')) return;
    detener.current = true;
    await fetch(`/api/difusiones/${id}/cancelar`, { method: 'POST' });
    cargar();
  };

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Difusiones</h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">
            Mensajes con plantilla aprobada a un grupo de clientes. Solo llegan a quienes aceptaron la política de privacidad y no pidieron la baja.
          </p>
        </div>
        <button onClick={() => setNueva(true)} className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold hover:bg-commerk-navy/90">+ Nueva difusión</button>
      </div>

      {aviso && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="text-left px-5 py-3 font-semibold">Difusión</th><th className="text-left px-5 py-3 font-semibold">Creada</th>
              <th className="text-right px-5 py-3 font-semibold">Avance</th><th className="text-right px-5 py-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {difusiones.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">Aún no hay difusiones.</td></tr>}
            {difusiones.map((d) => {
              const hechos = (d.enviados || 0) + (d.fallidos || 0);
              const pct = d.total ? Math.round((hechos / d.total) * 100) : 0;
              return (
                <tr key={d.id} className="border-t border-slate-100 align-top">
                  <td className="px-5 py-3"><p className="font-semibold text-slate-800">{d.nombre}</p><p className="text-xs text-slate-500">Plantilla {d.plantilla}</p></td>
                  <td className="px-5 py-3 text-xs text-slate-500">{fecha(d.created_at)}<br />{d.creado_nombre || d.creado_por}</td>
                  <td className="px-5 py-3 text-right">
                    <p className="text-sm text-slate-800 tabular-nums">{d.enviados} enviados{d.fallidos ? ` · ${d.fallidos} fallidos` : ''} de {d.total}</p>
                    <div className="mt-1.5 h-1.5 bg-slate-100 rounded ml-auto w-40"><div className="h-1.5 rounded bg-commerk-navy" style={{ width: `${pct}%` }} /></div>
                  </td>
                  <td className="px-5 py-3 text-right space-y-1.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${ESTADO[d.estado]?.cls}`}>{ESTADO[d.estado]?.l || d.estado}</span>
                    {d.estado === 'enviando' && (
                      <div className="flex justify-end gap-2">
                        {enviandoId === d.id
                          ? <span className="text-[11px] text-slate-500">Enviando…</span>
                          : <button onClick={() => continuar(d.id)} className="text-[11px] font-semibold text-commerk-navy hover:underline">Continuar</button>}
                        <button onClick={() => cancelar(d.id)} className="text-[11px] text-red-600 hover:underline">Detener</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nueva && <NuevaDifusion onClose={() => setNueva(false)} onCreada={(id) => { setNueva(false); cargar().then(() => continuar(id)); }} />}
    </div>
  );
}

function NuevaDifusion({ onClose, onCreada }: { onClose: () => void; onCreada: (id: string) => void }) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [nombre, setNombre] = useState('');
  const [plantilla, setPlantilla] = useState<Plantilla | null>(null);
  const [valores, setValores] = useState<string[]>([]);
  const [boton, setBoton] = useState('');
  const [seg, setSeg] = useState({ compro: '', sede: '', etiqueta: '', activos_dias: 0 });
  const [audiencia, setAudiencia] = useState<{ total: number; muestra: string[]; costo_estimado: number } | null>(null);
  const [confirmo, setConfirmo] = useState(false);
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    fetch('/api/plantillas').then((r) => r.json()).then((j) => setPlantillas((j.plantillas || []).filter((p: Plantilla) => p.status === 'APPROVED')));
  }, []);

  const cuerpo = plantilla?.components?.find((c) => c.type === 'BODY')?.text || '';
  const nVars = useMemo(() => { const n = Array.from(cuerpo.matchAll(/\{\{(\d+)\}\}/g)).map((m: any) => Number(m[1])); return n.length ? Math.max(...n) : 0; }, [cuerpo]);
  const urlBoton = plantilla?.components?.find((c) => c.type === 'BUTTONS')?.buttons?.find((b: any) => b.type === 'URL' && /\{\{1\}\}/.test(b.url || ''));
  const vista = cuerpo.replace(/\{\{(\d+)\}\}/g, (_: string, i: string) => (valores[Number(i) - 1] || `[campo ${i}]`).replace(/\{nombre\}/gi, 'Laura'));

  const elegir = (p: Plantilla | null) => {
    setPlantilla(p);
    const n = p ? Array.from((p.components?.find((c) => c.type === 'BODY')?.text || '').matchAll(/\{\{(\d+)\}\}/g)).length : 0;
    setValores(Array.from({ length: n }, (_, i) => (i === 0 ? '{nombre}' : '')));
    setConfirmo(false);
  };

  // Conteo en vivo de destinatarios y costo
  useEffect(() => {
    setConfirmo(false);
    const t = setTimeout(async () => {
      const j = await fetch('/api/difusiones/audiencia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmento: seg, categoria: plantilla?.category }),
      }).then((r) => r.json()).catch(() => null);
      setAudiencia(j?.success ? j : null);
    }, 400);
    return () => clearTimeout(t);
  }, [seg, plantilla]);

  const crear = async () => {
    setCreando(true); setError('');
    const j = await fetch('/api/difusiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, plantilla: plantilla!.name, idioma: plantilla!.language, categoria: plantilla!.category, cuerpo: valores, boton: urlBoton ? boton : undefined, texto: vista.replace('Laura', '{nombre}'), segmento: seg }),
    }).then((r) => r.json()).catch(() => null);
    setCreando(false);
    if (!j?.success) { setError(j?.error || 'No se pudo crear'); return; }
    onCreada(j.difusion.id);
  };

  const listo = nombre.trim() && plantilla && valores.every((v) => v.trim()) && (!urlBoton || boton.trim()) && audiencia?.total && confirmo;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-commerk-navy">Nueva difusión</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">✕</button>
        </div>

        <section className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-commerk-navy">1 · Mensaje</p>
          <input className={inputCls} placeholder="Nombre interno (ej. Black Weekend clientes que ya compraron)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <select className={inputCls} value={plantilla?.id || ''} onChange={(e) => elegir(plantillas.find((p) => p.id === e.target.value) || null)}>
            <option value="">Elige una plantilla aprobada…</option>
            {plantillas.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category === 'MARKETING' ? 'marketing' : 'servicio'}</option>)}
          </select>
          {plantilla && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                {valores.map((v, i) => (
                  <label key={i} className="block"><span className="text-[11px] text-slate-500">Campo {`{{${i + 1}}}`}</span>
                    <input className={inputCls} value={v} onChange={(e) => setValores((x) => x.map((y, j) => (j === i ? e.target.value : y)))} /></label>
                ))}
                {urlBoton && <label className="block"><span className="text-[11px] text-slate-500">Final del enlace del botón “{urlBoton.text}”</span><input className={inputCls} value={boton} onChange={(e) => setBoton(e.target.value)} /></label>}
                {nVars > 0 && <p className="text-[11px] text-slate-400">Escribe <b>{'{nombre}'}</b> para poner el primer nombre de cada cliente.</p>}
              </div>
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Así lo recibe el cliente (ejemplo: Laura)</p>
                <div className="rounded-2xl bg-[#e7ffdb] border border-emerald-100 px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap">{vista}</div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-commerk-navy">2 · A quién</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select className={inputCls} value={seg.compro} onChange={(e) => setSeg({ ...seg, compro: e.target.value })}>
              <option value="">Compraron o no</option><option value="si">Solo clientes que ya compraron</option><option value="no">Solo quienes aún no compran</option>
            </select>
            <select className={inputCls} value={seg.sede} onChange={(e) => setSeg({ ...seg, sede: e.target.value })}>
              <option value="">Todas las sedes</option><option value="Virtual">Virtual (domicilio)</option>
              {Object.values(SEDES_FISICAS).map((s) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
            </select>
            <select className={inputCls} value={seg.etiqueta} onChange={(e) => setSeg({ ...seg, etiqueta: e.target.value })}>
              <option value="">Cualquier etiqueta</option>
              {Object.entries(ETIQUETAS).map(([k, e]) => <option key={k} value={k}>{e.emoji} {e.label}</option>)}
            </select>
            <select className={inputCls} value={seg.activos_dias} onChange={(e) => setSeg({ ...seg, activos_dias: Number(e.target.value) })}>
              <option value={0}>Sin importar cuándo escribieron</option><option value={30}>Escribieron en los últimos 30 días</option>
              <option value={90}>Escribieron en los últimos 90 días</option><option value={180}>Escribieron en los últimos 6 meses</option>
            </select>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {audiencia === null ? 'Calculando…' : <>
              <b>{audiencia.total}</b> cliente{audiencia.total === 1 ? '' : 's'} recibirían el mensaje
              {plantilla && <> · costo aproximado <b>{cop(audiencia.costo_estimado)}</b></>}
              {audiencia.muestra.length > 0 && <span className="text-xs text-slate-500"> · ej. {audiencia.muestra.join(', ')}</span>}
            </>}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-commerk-navy">3 · Confirmar</p>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} disabled={!audiencia?.total || !plantilla} />
            <span>Entiendo que se enviarán <b>{audiencia?.total || 0}</b> mensajes{plantilla ? <> por aproximadamente <b>{cop(audiencia?.costo_estimado || 0)}</b></> : ''} y que no se pueden deshacer.</span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600">Cancelar</button>
            <button onClick={crear} disabled={!listo || creando} className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold disabled:opacity-40">
              {creando ? 'Preparando…' : `Enviar a ${audiencia?.total || 0} clientes`}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
