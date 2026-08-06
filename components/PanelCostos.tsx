'use client';

import { useEffect, useState } from 'react';

interface PlantillaCosto {
  nombre: string;
  categoria: string;
  enviadas: number;
  entregadas: number;
  fallidas: number;
  costo_usd: number;
}

interface Costos {
  success: boolean;
  tablaFaltante?: boolean;
  error?: string;
  dias: number;
  tarifas: { usd_cop: number; wa_marketing: number; wa_utility: number };
  claude: {
    llamadas: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    costo_usd: number;
    costo_cop: number;
    costo_por_conversacion_usd: number;
  };
  whatsapp: {
    enviadas: number;
    entregadas: number;
    costo_usd: number;
    costo_cop: number;
    plantillas: PlantillaCosto[];
  };
  total: { costo_usd: number; costo_cop: number };
}

const cop = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
const usd = (v: number) => `US$ ${v.toFixed(v < 1 ? 4 : 2)}`;
const num = (v: number) => new Intl.NumberFormat('es-CO').format(v);

export default function PanelCostos() {
  const [d, setD] = useState<Costos | null>(null);
  const [dias, setDias] = useState(30);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(true);

  useEffect(() => {
    setCargando(true);
    fetch(`/api/costos?dias=${dias}`)
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setCargando(false));
  }, [dias]);

  if (cargando) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Cargando costos…</div>;
  }

  if (!d || !d.success) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-800">Registro de costos aún no activo</p>
        <p className="text-sm text-amber-700 mt-1">
          Falta crear la tabla <code className="font-mono">uso_costos</code> en Supabase. Una vez creada, aquí verás el
          consumo real de la IA y de cada plantilla enviada.
        </p>
      </div>
    );
  }

  const totalMensual = d.total.costo_cop * (30 / d.dias);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {/* Encabezado */}
      <button onClick={() => setAbierto(!abierto)} className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition">
        <div className="text-left">
          <h2 className="text-lg font-bold text-commerk-navy">💰 Costos de operación</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Consumo real medido, últimos {d.dias} días · valores en <strong>pesos colombianos</strong>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-bold text-commerk-navy">{cop(d.total.costo_cop)}</p>
            <p className="text-xs text-slate-500">{usd(d.total.costo_usd)} · ≈ {cop(totalMensual)}/mes</p>
          </div>
          <svg className={`w-5 h-5 text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {abierto && (
        <div className="border-t border-slate-100 p-5 space-y-6">
          {/* Selector de periodo */}
          <div className="flex gap-2">
            {[7, 30, 90].map((n) => (
              <button
                key={n}
                onClick={() => setDias(n)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  dias === n ? 'bg-commerk-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {n} días
              </button>
            ))}
          </div>

          {/* Resumen en dos tarjetas */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Claude */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold text-slate-800">🤖 Inteligencia artificial</h3>
                <span className="text-lg font-bold text-commerk-navy">{cop(d.claude.costo_cop)}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Claude Opus 5 — lo que piensa y responde Sofi</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Respuestas generadas</dt><dd className="font-medium">{num(d.claude.llamadas)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Costo por respuesta</dt><dd className="font-medium">{cop(d.claude.costo_por_conversacion_usd * d.tarifas.usd_cop)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Tokens de entrada</dt><dd className="font-medium">{num(d.claude.input_tokens)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Tokens de salida</dt><dd className="font-medium">{num(d.claude.output_tokens)}</dd></div>
                {d.claude.cache_write_tokens > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <dt>Catálogo guardado en memoria</dt><dd className="font-medium">{num(d.claude.cache_write_tokens)}</dd>
                  </div>
                )}
                {d.claude.cache_read_tokens > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <dt>Reutilizados de memoria (10× más baratos)</dt><dd className="font-medium">{num(d.claude.cache_read_tokens)}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-3 text-[11px] text-slate-400">
                Tarifa: US$5 por millón de tokens de entrada · US$25 de salida · US$6,25 al guardar el catálogo en memoria
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Costo en dólares: <strong>{usd(d.claude.costo_usd)}</strong>
              </p>
            </div>

            {/* WhatsApp */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold text-slate-800">💬 Plantillas de WhatsApp</h3>
                <span className="text-lg font-bold text-commerk-navy">{cop(d.whatsapp.costo_cop)}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Mensajes que iniciamos nosotros hacia el cliente</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Enviadas</dt><dd className="font-medium">{num(d.whatsapp.enviadas)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Entregadas (las que se cobran)</dt><dd className="font-medium">{num(d.whatsapp.entregadas)}</dd></div>
              </dl>
              <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-100 p-2.5">
                <p className="text-[11px] text-emerald-800">
                  <strong>Gratis:</strong> cuando el cliente escribe primero se abre una ventana de 24 h y todas las
                  respuestas de Sofi no tienen costo. Ahí ocurre la venta.
                </p>
              </div>
            </div>
          </div>

          {/* Detalle por plantilla */}
          {d.whatsapp.plantillas.length > 0 && (
            <div>
              <h3 className="font-semibold text-slate-800 mb-2">Detalle por plantilla</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Plantilla</th>
                      <th className="text-left px-3 py-2 font-medium">Tipo</th>
                      <th className="text-right px-3 py-2 font-medium">Enviadas</th>
                      <th className="text-right px-3 py-2 font-medium">Entregadas</th>
                      <th className="text-right px-3 py-2 font-medium">Costo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.whatsapp.plantillas.map((p) => (
                      <tr key={p.nombre}>
                        <td className="px-3 py-2 font-mono text-xs">{p.nombre}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            p.categoria === 'marketing' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {p.categoria === 'marketing' ? 'Marketing' : 'Utilidad'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{num(p.enviadas)}</td>
                        <td className="px-3 py-2 text-right">
                          {num(p.entregadas)}
                          {p.fallidas > 0 && <span className="text-red-500 text-xs ml-1">({p.fallidas} fallidas)</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{cop(p.costo_usd * d.tarifas.usd_cop)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Explicación de tarifas */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-800">¿Cómo se calcula?</h4>
            <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
              <li>• <strong>Marketing</strong> ({usd(d.tarifas.wa_marketing)} c/u): recordatorio de pago, carrito abandonado y aviso mayorista.</li>
              <li>• <strong>Utilidad</strong> ({usd(d.tarifas.wa_utility)} c/u): confirmación de pago, pedido en camino y aviso de recogida.</li>
              <li>• <strong>IA</strong>: se cobra por tokens; el costo real de cada respuesta se registra al momento.</li>
              <li>• Solo se cobran los mensajes <strong>entregados</strong>. Conversión usada: US$1 = {cop(d.tarifas.usd_cop)}.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
