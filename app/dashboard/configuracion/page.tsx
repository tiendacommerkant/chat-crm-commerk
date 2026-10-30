'use client';

// Configuración de la atención: horario del equipo y encuesta de satisfacción
import { useEffect, useState } from 'react';

const DIAS = [
  { k: 'lun', l: 'Lunes' }, { k: 'mar', l: 'Martes' }, { k: 'mie', l: 'Miércoles' }, { k: 'jue', l: 'Jueves' },
  { k: 'vie', l: 'Viernes' }, { k: 'sab', l: 'Sábado' }, { k: 'dom', l: 'Domingo' },
] as const;

type Franja = { abre: string; cierra: string } | null;
type Horario = Record<string, Franja>;

const VACIO: Horario = { lun: null, mar: null, mie: null, jue: null, vie: null, sab: null, dom: null };

export default function ConfiguracionPage() {
  const [horario, setHorario] = useState<Horario>(VACIO);
  const [configurado, setConfigurado] = useState(false);
  const [encuesta, setEncuesta] = useState(true);
  const [resumen, setResumen] = useState<any>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);

  const cargar = async () => {
    const j = await fetch('/api/configuracion').then((r) => r.json()).catch(() => null);
    if (j?.success) {
      setHorario(j.horario || VACIO);
      setConfigurado(!!j.horario);
      setEncuesta(j.encuesta_activa);
      setResumen(j.resumen);
      setAviso(j.aviso);
    }
    setCargando(false);
  };
  useEffect(() => { cargar(); }, []);

  const guardar = async (cambios: Record<string, any>) => {
    setGuardando(true); setMensaje('');
    const j = await fetch('/api/configuracion', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cambios) })
      .then((r) => r.json()).catch(() => null);
    setGuardando(false);
    setMensaje(j?.success ? '✅ Guardado. El bot lo usa desde el próximo mensaje.' : `⚠️ ${j?.error || 'No se pudo guardar'}`);
    if (j?.success) cargar();
  };

  const cambiarDia = (k: string, f: Franja) => setHorario((h) => ({ ...h, [k]: f }));
  const copiarLunes = () => setHorario((h) => ({ ...h, mar: h.lun, mie: h.lun, jue: h.lun, vie: h.lun }));

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-commerk-navy">Configuración de la atención</h1>
        <p className="text-sm text-slate-500 mt-0.5">Horario del equipo y encuesta de satisfacción. Solo un administrador puede cambiarlos.</p>
      </div>

      {aviso && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>}
      {mensaje && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{mensaje}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-commerk-navy">Horario de atención del equipo</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Si el bot pasa un cliente a un asesor fuera de este horario, le dice cuándo le van a escribir. Sofi atiende 24/7 igual.
              {!configurado && ' Mientras no lo configures, el bot no menciona horarios.'}
            </p>
          </div>
          {resumen && (
            <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${resumen.abierto_ahora ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              {resumen.abierto_ahora ? '● Equipo en horario' : `○ Fuera de horario · abre ${resumen.proxima_apertura}`}
            </span>
          )}
        </div>

        {cargando ? <p className="text-sm text-slate-400">Cargando…</p> : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {DIAS.map((d) => {
              const f = horario[d.k];
              return (
                <div key={d.k} className="flex items-center gap-4 px-4 py-2.5">
                  <label className="flex items-center gap-2 w-32 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={!!f} onChange={(e) => cambiarDia(d.k, e.target.checked ? { abre: '08:00', cierra: '18:00' } : null)} />
                    {d.l}
                  </label>
                  {f ? (
                    <div className="flex items-center gap-2 text-sm">
                      <input type="time" value={f.abre} onChange={(e) => cambiarDia(d.k, { ...f, abre: e.target.value })} className="px-2 py-1 border border-slate-200 rounded-lg" />
                      <span className="text-slate-400">a</span>
                      <input type="time" value={f.cierra} onChange={(e) => cambiarDia(d.k, { ...f, cierra: e.target.value })} className="px-2 py-1 border border-slate-200 rounded-lg" />
                      {d.k === 'lun' && <button onClick={copiarLunes} className="ml-2 text-xs text-commerk-navy/70 hover:text-commerk-navy font-semibold">Copiar a martes–viernes</button>}
                    </div>
                  ) : <span className="text-sm text-slate-400">Cerrado</span>}
                </div>
              );
            })}
          </div>
        )}

        {resumen?.descripcion && (
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <p><b>Horario guardado:</b> {resumen.descripcion}.</p>
            {resumen.aviso_al_cliente && <p className="mt-1"><b>Si alguien pide un asesor ahora, el bot agrega:</b> “{resumen.aviso_al_cliente}”</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {configurado && (
            <button onClick={() => guardar({ horario: null })} disabled={guardando} className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
              Quitar horario
            </button>
          )}
          <button onClick={() => guardar({ horario })} disabled={guardando || !Object.values(horario).some(Boolean)}
            className="px-4 py-2 rounded-xl bg-commerk-navy text-white text-sm font-semibold hover:bg-commerk-navy/90 disabled:opacity-40">
            {guardando ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex items-start justify-between gap-6">
        <div>
          <h2 className="font-bold text-commerk-navy">Encuesta de satisfacción</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-xl">
            Al marcar una conversación como <b>Resuelto</b>, el cliente recibe “¿Cómo calificarías la atención?” con tres botones:
            Excelente, Buena y Mala. Si responde Mala, el bot le pregunta qué mejorar. Solo se envía si un asesor le escribió en las últimas 24 horas.
          </p>
        </div>
        <button onClick={() => guardar({ encuesta_activa: !encuesta })} disabled={guardando}
          className={`shrink-0 relative w-12 h-7 rounded-full transition-colors ${encuesta ? 'bg-commerk-green' : 'bg-slate-300'}`} title={encuesta ? 'Activada' : 'Apagada'}>
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${encuesta ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
    </div>
  );
}
