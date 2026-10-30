'use client';

// Tablero de atención: cómo responde el equipo, cuánto resuelve Sofi,
// cuánto vende el bot y qué opinan los clientes.
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const NAVY = '#1B3A6B';
const PERIODOS = [{ d: 7, l: '7 días' }, { d: 30, l: '30 días' }, { d: 90, l: '90 días' }];

const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
function duracion(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
  return `${Math.round(min / 1440)} días`;
}
const diaCorto = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Cifra({ titulo, valor, detalle, alerta }: { titulo: string; valor: string; detalle?: string; alerta?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
      <p className="text-xs font-semibold text-slate-500">{titulo}</p>
      <p className={`text-3xl font-bold mt-1 tracking-tight ${alerta ? 'text-red-600' : 'text-slate-900'}`}>{valor}</p>
      {detalle && <p className="text-xs text-slate-500 mt-1">{detalle}</p>}
    </div>
  );
}

function Panel({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <h2 className="font-bold text-slate-800">{titulo}</h2>
      {subtitulo && <p className="text-xs text-slate-500 mt-0.5 mb-4">{subtitulo}</p>}
      {!subtitulo && <div className="h-3" />}
      {children}
    </div>
  );
}

/** Barra horizontal: etiqueta y valor en texto, la barra solo da la proporción. */
function FilaBarra({ etiqueta, valor, maximo, icono }: { etiqueta: string; valor: number; maximo: number; icono?: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5" title={`${etiqueta}: ${valor}`}>
      <span className="w-44 shrink-0 text-sm text-slate-700 truncate">{icono && <span className="mr-1">{icono}</span>}{etiqueta}</span>
      <div className="flex-1 h-2.5 bg-slate-100 rounded">
        <div className="h-2.5 rounded" style={{ width: `${maximo ? Math.max(2, (valor / maximo) * 100) : 0}%`, background: NAVY }} />
      </div>
      <span className="w-10 text-right text-sm font-semibold text-slate-800 tabular-nums">{valor}</span>
    </div>
  );
}

export default function TableroPage() {
  const [dias, setDias] = useState(30);
  const [t, setT] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [verTabla, setVerTabla] = useState(false);

  useEffect(() => {
    setCargando(true);
    fetch(`/api/tablero?dias=${dias}`).then((r) => r.json()).then((j) => { if (j.success) setT(j); }).finally(() => setCargando(false));
  }, [dias]);

  const r = t?.resumen;
  const maxMotivo = Math.max(0, ...(t?.motivos || []).map((m: any) => m.cantidad));
  const maxEncuesta = t ? Math.max(t.encuestas.excelente, t.encuestas.buena, t.encuestas.mala) : 0;
  const maxLead = Math.max(0, ...(t?.leads || []).map((l: any) => l.cantidad));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Tablero de atención</h1>
          <p className="text-sm text-slate-500 mt-0.5">WhatsApp: cuánto resuelve Sofi, qué tan rápido responde el equipo, cuánto vende el bot y qué opinan los clientes.</p>
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {PERIODOS.map((p) => (
            <button key={p.d} onClick={() => setDias(p.d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${dias === p.d ? 'bg-white text-commerk-navy shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Últimos {p.l}
            </button>
          ))}
        </div>
      </div>

      {!t && cargando ? <p className="text-sm text-slate-400">Calculando…</p> : !t ? <p className="text-sm text-red-600">No se pudo cargar el tablero.</p> : (
        <div className={`space-y-6 transition-opacity ${cargando ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <Cifra titulo="Conversaciones" valor={String(r.conversaciones_activas)} detalle={`${r.mensajes_clientes} mensajes de clientes · ${r.conversaciones_nuevas} nuevas`} />
            <Cifra titulo="Resueltas solo por Sofi" valor={r.porcentaje_bot === null ? '—' : `${r.porcentaje_bot} %`} detalle={`${r.resueltas_por_bot} sin pasar a una persona`} />
            <Cifra titulo="Primera respuesta del asesor" valor={duracion(r.primera_respuesta_mediana_min)}
              detalle={r.transferencias ? `Mediana · ${r.transferencias_sin_respuesta} de ${r.transferencias} sin respuesta` : 'Sin transferencias en el periodo'}
              alerta={r.transferencias_sin_respuesta > 0} />
            <Cifra titulo="Links de pago pagados" valor={r.links_generados ? `${r.links_pagados} de ${r.links_generados}` : '—'}
              detalle={r.links_generados ? `${r.conversion_links} % de conversión · ${cop(r.valor_pagado)}` : 'Sin links en el periodo'} />
            <Cifra titulo="Satisfacción" valor={r.satisfaccion === null ? '—' : `${r.satisfaccion} %`}
              detalle={r.encuestas ? `${r.encuestas} encuesta${r.encuestas === 1 ? '' : 's'} · excelente o buena` : 'Aún no hay encuestas'} />
          </div>

          {r.pendientes_ahora > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 flex items-center gap-2">
              <span className="font-bold">⏱ {r.pendientes_ahora} cliente{r.pendientes_ahora === 1 ? '' : 's'} esperando asesor ahora</span>
              <span>· la espera más larga es de {duracion(r.espera_mas_larga_min)}</span>
              <a href="/dashboard/conversaciones" className="ml-auto font-semibold underline">Ir a Pendientes</a>
            </div>
          )}

          <Panel titulo="Conversaciones por día" subtitulo="Conversaciones en las que el cliente escribió ese día (hora de Colombia).">
            <div className="flex justify-end -mt-8 mb-2">
              <button onClick={() => setVerTabla(!verTabla)} className="text-xs font-semibold text-commerk-navy/70 hover:text-commerk-navy">
                {verTabla ? 'Ver gráfico' : 'Ver tabla'}
              </button>
            </div>
            {verTabla ? (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500"><tr><th className="text-left py-1.5">Día</th><th className="text-right">Conversaciones</th><th className="text-right">Mensajes de clientes</th></tr></thead>
                  <tbody>{t.serie.map((s: any) => (
                    <tr key={s.dia} className="border-t border-slate-100"><td className="py-1.5">{diaCorto(s.dia)}</td><td className="text-right tabular-nums">{s.conversaciones}</td><td className="text-right tabular-nums">{s.mensajes}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={t.serie} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap={dias > 30 ? 1 : 4}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="dia" tickFormatter={diaCorto} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(27,58,107,0.06)' }}
                    labelFormatter={(v) => diaCorto(String(v))}
                    formatter={(v: any, _n: any, p: any) => [`${v} conversaciones · ${p.payload.mensajes} mensajes`, '']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Bar dataKey="conversaciones" fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Panel titulo="¿Por qué pasan a una persona?" subtitulo={`${r.transferencias} transferencias del bot a un asesor en el periodo.`}>
              {t.motivos.length === 0 ? <p className="text-sm text-slate-400">Sin transferencias en el periodo.</p>
                : t.motivos.map((m: any) => <FilaBarra key={m.clave} etiqueta={m.motivo} valor={m.cantidad} maximo={maxMotivo} />)}
            </Panel>

            <Panel titulo="Encuesta de satisfacción" subtitulo="Respuestas de los clientes al resolverse su caso.">
              {r.encuestas === 0 ? (
                <p className="text-sm text-slate-400">Aún no hay encuestas. Se envían al marcar una conversación como “Resuelto”.</p>
              ) : (
                <>
                  <FilaBarra etiqueta="Excelente" icono="😀" valor={t.encuestas.excelente} maximo={maxEncuesta} />
                  <FilaBarra etiqueta="Buena" icono="🙂" valor={t.encuestas.buena} maximo={maxEncuesta} />
                  <FilaBarra etiqueta="Mala" icono="😕" valor={t.encuestas.mala} maximo={maxEncuesta} />
                  {t.encuestas.comentarios.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-semibold text-slate-500">Comentarios recientes</p>
                      {t.encuestas.comentarios.map((c: any, i: number) => (
                        <p key={i} className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">“{c.comentario}” {c.asesor && <span className="text-xs text-slate-400">· atendió {c.asesor}</span>}</p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Panel>
          </div>

          <Panel titulo="Desempeño por asesor" subtitulo="Mensajes enviados desde el CRM, tiempo hasta responder un cliente transferido y su satisfacción.">
            {t.asesores.length === 0 ? <p className="text-sm text-slate-400">Ningún asesor ha respondido desde el CRM en el periodo.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 border-b border-slate-100">
                    <tr><th className="text-left py-2 font-semibold">Asesor</th><th className="text-right font-semibold">Conversaciones</th><th className="text-right font-semibold">Mensajes</th><th className="text-right font-semibold">Primera respuesta</th><th className="text-right font-semibold">Encuestas</th><th className="text-right font-semibold">Satisfacción</th></tr>
                  </thead>
                  <tbody>
                    {t.asesores.map((a: any) => (
                      <tr key={a.asesor} className="border-b border-slate-50">
                        <td className="py-2.5 font-medium text-slate-800">{a.asesor}</td>
                        <td className="text-right tabular-nums">{a.conversaciones}</td>
                        <td className="text-right tabular-nums">{a.mensajes}</td>
                        <td className="text-right">{duracion(a.primera_respuesta_mediana_min)}</td>
                        <td className="text-right tabular-nums">{a.encuestas}</td>
                        <td className="text-right">{a.satisfaccion === null ? '—' : `${a.satisfaccion} %`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-slate-400 mt-2">“Sin registrar” agrupa mensajes enviados antes de que cada asesor quedara identificado en el CRM.</p>
              </div>
            )}
          </Panel>

          <Panel titulo="Solicitudes para el equipo de ventas" subtitulo="Compras al por mayor (por sede) y ventas empresariales que dejaron sus datos.">
            {t.leads.length === 0 ? <p className="text-sm text-slate-400">Sin solicitudes en el periodo.</p>
              : t.leads.map((l: any) => <FilaBarra key={l.sede} etiqueta={l.sede} valor={l.cantidad} maximo={maxLead} />)}
          </Panel>
        </div>
      )}
    </div>
  );
}
