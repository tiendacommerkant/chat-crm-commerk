'use client';

// Columna derecha: todo lo del cliente al lado del chat
import { iniciales, mostrarContacto, enlaceWhatsApp, fmtFechaCompleta, TZ } from './base';
import { MOTIVOS, tiempoEspera } from './Bandeja';

export type Ficha = {
  cliente: any;
  atencion: { estado: string; asignado_a: string | null; asignado_nombre: string | null; pendiente_desde: string | null; motivo: string | null };
  resumen: { total_comprado: number; pedidos_pagados: number; ticket_promedio: number; ultimo_pedido: string | null; conversaciones: number };
  pedidos: any[];
  ventas_bot: any[];
  carritos: any[];
  ventana: { ultimo_mensaje_cliente: string | null; abierta: boolean; cierra_en: string | null };
};

export type Usuario = { email: string; nombre: string };

const cop = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const fecha = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) : '—';

const ESTADO_PEDIDO: Record<string, string> = { paid: 'Pagado', pending: 'Pendiente', refunded: 'Reembolsado', partially_refunded: 'Reembolso parcial', voided: 'Anulado' };
const ESTADO_VENTA: Record<string, { label: string; cls: string }> = {
  pagado: { label: 'Pagado', cls: 'bg-emerald-50 text-emerald-700' },
  pendiente: { label: 'Sin pagar', cls: 'bg-amber-50 text-amber-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500' },
};

function Seccion({ titulo, children, extra }: { titulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="px-4 py-3.5 border-b border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{titulo}</h4>
        {extra}
      </div>
      {children}
    </div>
  );
}

export function FichaCliente(props: {
  ficha: Ficha | null;
  cargando: boolean;
  usuarios: Usuario[];
  yo: Usuario | null;
  ahora: number;
  onTomar: () => void;
  onDevolverBot: () => void;
  onAsignar: (u: Usuario) => void;
  onCerrar: () => void;
}) {
  const f = props.ficha;
  if (!f) {
    return (
      <div className="p-6 text-center text-xs text-slate-400">
        {props.cargando ? 'Cargando ficha…' : 'Sin datos del cliente'}
      </div>
    );
  }
  const c = f.cliente || {};
  const espera = f.atencion.estado === 'pendiente' ? tiempoEspera(f.atencion.pendiente_desde, props.ahora) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-slate-100 flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-commerk-navy/10 flex items-center justify-center text-commerk-navy font-bold shrink-0">{iniciales(c.nombre)}</div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 truncate">{c.nombre || 'Sin nombre'}</p>
          {enlaceWhatsApp(c)
            ? <a href={enlaceWhatsApp(c)} target="_blank" rel="noopener noreferrer" className="text-xs text-commerk-green hover:underline">{mostrarContacto(c)}</a>
            : <p className="text-xs text-commerk-green">{mostrarContacto(c)}</p>}
          {c.email && <p className="text-xs text-slate-500 truncate">{c.email}</p>}
          {(c.ciudad || c.sede_preferida) && <p className="text-[11px] text-slate-400">{[c.ciudad, c.sede_preferida && `Sede ${c.sede_preferida}`].filter(Boolean).join(' · ')}</p>}
        </div>
        <button onClick={props.onCerrar} className="p-1 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-100" title="Ocultar ficha">✕</button>
      </div>

      <Seccion titulo="Atención">
        <div className="space-y-2">
          {f.atencion.estado === 'pendiente' && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2">
              <p className="text-xs font-bold text-red-700">Esperando asesor {espera && `· ${espera.texto}`}</p>
              {f.atencion.motivo && <p className="text-[11px] text-red-600/80">{MOTIVOS[f.atencion.motivo] || f.atencion.motivo}</p>}
            </div>
          )}
          {f.atencion.estado === 'en_atencion' && (
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
              <p className="text-xs font-bold text-amber-800">👤 {f.atencion.asignado_a === props.yo?.email ? 'La atiendes tú' : `La atiende ${f.atencion.asignado_nombre || 'un asesor'}`}</p>
              <p className="text-[11px] text-amber-700/80">Sofi no responde mientras tanto</p>
            </div>
          )}
          {f.atencion.estado === 'bot' && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2">
              <p className="text-xs font-bold text-emerald-700">🤖 La atiende Sofi</p>
            </div>
          )}

          <div className="flex gap-2">
            {(f.atencion.estado !== 'en_atencion' || f.atencion.asignado_a !== props.yo?.email) && (
              <button onClick={props.onTomar} className="flex-1 py-1.5 rounded-lg bg-commerk-navy text-white text-xs font-semibold hover:bg-commerk-navy/90">Tomar</button>
            )}
            {f.atencion.estado !== 'bot' && (
              <button onClick={props.onDevolverBot} className="flex-1 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50" title="El caso quedó resuelto: Sofi vuelve a responder">Devolver a Sofi</button>
            )}
          </div>

          {props.usuarios.length > 1 && (
            <select value="" onChange={(e) => { const u = props.usuarios.find((x) => x.email === e.target.value); if (u) props.onAsignar(u); }}
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 bg-white focus:outline-none">
              <option value="">Asignar a otro asesor…</option>
              {props.usuarios.filter((u) => u.email !== f.atencion.asignado_a).map((u) => <option key={u.email} value={u.email}>{u.nombre}</option>)}
            </select>
          )}

          <p className={`text-[11px] ${f.ventana.abierta ? 'text-slate-400' : 'text-amber-700 font-medium'}`}>
            {f.ventana.ultimo_mensaje_cliente
              ? f.ventana.abierta
                ? `Ventana de WhatsApp abierta hasta ${fmtFechaCompleta(f.ventana.cierra_en!)}`
                : 'Ventana de 24 h cerrada: solo plantillas'
              : 'El cliente no ha escrito: solo plantillas'}
          </p>
        </div>
      </Seccion>

      <Seccion titulo="Resumen">
        <div className="grid grid-cols-2 gap-2">
          {[
            { l: 'Total comprado', v: cop(f.resumen.total_comprado) },
            { l: 'Pedidos pagados', v: String(f.resumen.pedidos_pagados) },
            { l: 'Ticket promedio', v: f.resumen.ticket_promedio ? cop(f.resumen.ticket_promedio) : '—' },
            { l: 'Conversaciones', v: String(f.resumen.conversaciones) },
          ].map((x) => (
            <div key={x.l} className="rounded-xl bg-slate-50 px-2.5 py-2">
              <p className="text-[10px] text-slate-400">{x.l}</p>
              <p className="text-sm font-bold text-slate-800 truncate">{x.v}</p>
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Links de pago del bot">
        {f.ventas_bot.length === 0 ? <p className="text-xs text-slate-400">Sin links de pago</p> : (
          <div className="space-y-1.5">
            {f.ventas_bot.map((v, i) => (
              <div key={i} className="rounded-lg border border-slate-100 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-slate-700 truncate flex-1">{v.producto_nombre}</p>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ESTADO_VENTA[v.estado]?.cls || 'bg-slate-100 text-slate-500'}`}>{ESTADO_VENTA[v.estado]?.label || v.estado}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-[11px] text-slate-500">{cop(v.total)} · {fecha(v.created_at)}</p>
                  {v.link_pago && v.estado === 'pendiente' && (
                    <button onClick={() => navigator.clipboard?.writeText(v.link_pago)} className="text-[10px] text-commerk-navy font-semibold hover:underline">Copiar link</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Compras en la tienda">
        {f.pedidos.length === 0 ? <p className="text-xs text-slate-400">Sin pedidos en Shopify</p> : (
          <div className="space-y-1.5">
            {f.pedidos.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-700">#{p.shopify_order_number}</span>
                <span className="text-slate-400">{fecha(p.shopify_created_at)}</span>
                <span className="ml-auto font-semibold text-slate-700">{cop(p.total)}</span>
                <span className="text-[10px] text-slate-400 w-16 text-right">{ESTADO_PEDIDO[p.estado_financiero] || p.estado_financiero}</span>
              </div>
            ))}
          </div>
        )}
      </Seccion>

      {f.carritos.length > 0 && (
        <Seccion titulo="Carritos sin terminar">
          <div className="space-y-1.5">
            {f.carritos.map((cr, i) => (
              <div key={i} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-700 font-medium truncate flex-1">{(cr.items || []).map((x: any) => x.title).join(', ') || 'Carrito'}</span>
                  <span className="font-semibold text-slate-700">{cop(cr.total)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{fecha(cr.shopify_updated_at)}</span>
                  {cr.url_checkout && <button onClick={() => navigator.clipboard?.writeText(cr.url_checkout)} className="text-commerk-navy font-semibold hover:underline">Copiar enlace</button>}
                </div>
              </div>
            ))}
          </div>
        </Seccion>
      )}
    </div>
  );
}
