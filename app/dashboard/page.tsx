'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import type { MetricasDashboard } from '@/types';

// ─── Metric Card ─────────────────────────────────────────────
function MetricCard({
  label,
  value,
  sub,
  icon,
  accent = 'navy',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: 'navy' | 'green' | 'wine' | 'gold';
}) {
  const accentClasses = {
    navy: 'text-commerk-navy bg-commerk-navy/10',
    green: 'text-commerk-green bg-commerk-green/10',
    wine: 'text-commerk-wine bg-commerk-wine/10',
    gold: 'text-commerk-gold bg-commerk-gold/10',
  };

  return (
    <Card className="p-6 hover:shadow-md transition-shadow duration-200 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${accent === 'green' ? 'text-commerk-green' : 'text-commerk-navy'}`}>
            {value}
          </p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${accentClasses[accent]}`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

// ─── Status Badge ─────────────────────────────────────────────
function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    pagado: 'bg-commerk-green/10 text-commerk-green',
    pendiente: 'bg-commerk-gold/10 text-amber-600',
    cancelado: 'bg-commerk-wine/10 text-commerk-wine',
  };
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${map[estado] || 'bg-slate-100 text-slate-500'}`}>
      {estado}
    </span>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────
export default function DashboardPage() {
  const [metricas, setMetricas] = useState<MetricasDashboard>({
    ventasHoy: 0, ventasSemana: 0, ventasMes: 0,
    ingresosHoy: 0, ingresosSemana: 0, ingresosMes: 0,
    clientesNuevos: 0, conversacionesActivas: 0,
    tasaConversion: 0, ticketPromedio: 0,
  });
  const [ultimasVentas, setUltimasVentas] = useState<any[]>([]);
  const [ultimosClientes, setUltimosClientes] = useState<any[]>([]);
  const [pedidosShopify, setPedidosShopify] = useState<any[]>([]);
  const [enCheckout, setEnCheckout] = useState(0);
  const [carritosAbandonados, setCarritosAbandonados] = useState(0);
  const [actividadReciente, setActividadReciente] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function cargarDatos() {
      try {
        const hoy = new Date().toISOString().split('T')[0];
        const inicioSemana = new Date();
        inicioSemana.setDate(inicioSemana.getDate() - 7);
        const inicioMes = new Date();
        inicioMes.setDate(1);
        const hace30min = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        const [
          { data: ventasHoy },
          { data: ventasSemana },
          { data: ventasMes },
          { data: clientesNuevos },
          { data: convActivas },
          { data: pedidos },
          { data: enCheckoutData },
          { data: abandonados },
          { data: ventas },
          { data: clientes },
          { data: pedidosHoy },
          { data: pedidosSemana },
          { data: pedidosMes },
        ] = await Promise.all([
          supabase.from('ventas').select('total').gte('created_at', `${hoy}T00:00:00`).eq('estado', 'pagado'),
          supabase.from('ventas').select('total').gte('created_at', inicioSemana.toISOString()).eq('estado', 'pagado'),
          supabase.from('ventas').select('total').gte('created_at', inicioMes.toISOString()).eq('estado', 'pagado'),
          supabase.from('clientes').select('id').gte('created_at', `${hoy}T00:00:00`),
          supabase.from('conversaciones').select('id').eq('estado', 'activa'),
          supabase.from('pedidos_shopify').select('*, cliente:clientes(nombre, telefono)').order('shopify_created_at', { ascending: false }).limit(5),
          supabase.from('carritos_abandonados').select('id').eq('estado', 'en_progreso').gte('shopify_updated_at', hace30min),
          supabase.from('carritos_abandonados').select('id').in('estado', ['abandonado', 'notificado']),
          supabase.from('ventas').select('*, cliente:clientes(nombre, telefono)').order('created_at', { ascending: false }).limit(5),
          supabase.from('clientes').select('*').order('created_at', { ascending: false }).limit(5),
          // Pedidos Shopify pagados hoy
          supabase.from('pedidos_shopify').select('total').gte('shopify_created_at', `${hoy}T00:00:00`).eq('estado_financiero', 'paid'),
          // Pedidos Shopify pagados esta semana
          supabase.from('pedidos_shopify').select('total').gte('shopify_created_at', inicioSemana.toISOString()).eq('estado_financiero', 'paid'),
          // Pedidos Shopify pagados este mes
          supabase.from('pedidos_shopify').select('total').gte('shopify_created_at', inicioMes.toISOString()).eq('estado_financiero', 'paid'),
        ]);

        // Ingresos WhatsApp bot
        const ingresosWaHoy = ventasHoy?.reduce((s, v) => s + (v.total || 0), 0) || 0;
        const ingresosWaSemana = ventasSemana?.reduce((s, v) => s + (v.total || 0), 0) || 0;
        const ingresosWaMes = ventasMes?.reduce((s, v) => s + (v.total || 0), 0) || 0;
        // Ingresos Shopify
        const ingresosShopifyHoy = pedidosHoy?.reduce((s, p) => s + (p.total || 0), 0) || 0;
        const ingresosShopifySemana = pedidosSemana?.reduce((s, p) => s + (p.total || 0), 0) || 0;
        const ingresosShopifyMes = pedidosMes?.reduce((s, p) => s + (p.total || 0), 0) || 0;

        const ventasHoyTotal = (ventasHoy?.length || 0) + (pedidosHoy?.length || 0);
        const ventasSemanaTotal = (ventasSemana?.length || 0) + (pedidosSemana?.length || 0);
        const ventasMesTotal = (ventasMes?.length || 0) + (pedidosMes?.length || 0);
        const ingresosHoy = ingresosWaHoy + ingresosShopifyHoy;
        const ingresosSemana = ingresosWaSemana + ingresosShopifySemana;
        const ingresosMesTotal = ingresosWaMes + ingresosShopifyMes;

        setMetricas({
          ventasHoy: ventasHoyTotal,
          ventasSemana: ventasSemanaTotal,
          ventasMes: ventasMesTotal,
          ingresosHoy,
          ingresosSemana,
          ingresosMes: ingresosMesTotal,
          clientesNuevos: clientesNuevos?.length || 0,
          conversacionesActivas: convActivas?.length || 0,
          tasaConversion: 0,
          ticketPromedio: ventasMesTotal ? Math.round(ingresosMesTotal / ventasMesTotal) : 0,
        });

        setPedidosShopify(pedidos || []);
        setEnCheckout(enCheckoutData?.length || 0);
        setCarritosAbandonados(abandonados?.length || 0);
        setUltimasVentas(ventas || []);
        setUltimosClientes(clientes || []);

        // Feed de actividad: mezcla pedidos Shopify + conversaciones recientes
        const actFeed: any[] = [];
        (pedidos || []).slice(0, 4).forEach((p: any) => {
          actFeed.push({ tipo: 'pedido', ...p, _ts: p.shopify_created_at || p.created_at });
        });
        const { data: ultimasConvs } = await supabase
          .from('conversaciones')
          .select('*, cliente:clientes(nombre, telefono)')
          .order('updated_at', { ascending: false })
          .limit(4);
        (ultimasConvs || []).forEach((c: any) => {
          actFeed.push({ tipo: 'conversacion', ...c, _ts: c.updated_at });
        });
        actFeed.sort((a, b) => new Date(b._ts).getTime() - new Date(a._ts).getTime());
        setActividadReciente(actFeed.slice(0, 6));
      } catch (err) {
        console.error('Error cargando métricas:', err);
      } finally {
        setLoading(false);
      }
    }

    cargarDatos();
    const interval = setInterval(cargarDatos, 60000);
    return () => clearInterval(interval);
  }, []);

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Cargando métricas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-commerk-green/10 text-commerk-green text-sm font-medium">
          <span className="w-2 h-2 bg-commerk-green rounded-full animate-pulse" />
          Sistema activo
        </div>
      </div>

      {/* Métricas principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Ventas Hoy"
          value={metricas.ventasHoy}
          sub={`Esta semana: ${metricas.ventasSemana}`}
          accent="navy"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          }
        />
        <MetricCard
          label="Ingresos Hoy"
          value={fmt(metricas.ingresosHoy)}
          sub={`Este mes: ${fmt(metricas.ingresosMes)}`}
          accent="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <MetricCard
          label="Clientes Nuevos"
          value={metricas.clientesNuevos}
          sub="Hoy"
          accent="gold"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <MetricCard
          label="Chats Activos"
          value={metricas.conversacionesActivas}
          sub="Ahora mismo"
          accent="wine"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
        />
      </div>

      {/* Métricas secundarias — incluye Shopify + carritos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-commerk-navy/10 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-commerk-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-slate-500">Ticket Promedio</p>
            <p className="text-lg font-bold text-commerk-navy">{fmt(metricas.ticketPromedio)}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-commerk-green/10 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-commerk-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-slate-500">Ventas Semana</p>
            <p className="text-lg font-bold text-commerk-navy">{metricas.ventasSemana}</p>
          </div>
        </Card>
        <a href="/dashboard/carritos" className="block">
          <Card className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-slate-500">En checkout ahora</p>
              <p className="text-lg font-bold text-blue-600">{enCheckout}</p>
            </div>
          </Card>
        </a>
        <a href="/dashboard/carritos" className="block">
          <Card className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-slate-500">Carritos abandonados</p>
              <p className="text-lg font-bold text-amber-600">{carritosAbandonados}</p>
            </div>
          </Card>
        </a>
      </div>

      {/* Tablas principales */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Últimos pedidos Shopify */}
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-commerk-navy">Pedidos Shopify</h2>
              <span className="text-xs bg-[#96bf48]/20 text-[#5a7a1f] px-2 py-0.5 rounded-full font-semibold">Live</span>
            </div>
            <a href="/dashboard/carritos" className="text-xs text-commerk-green font-medium hover:underline">Ver carritos →</a>
          </div>
          <div className="divide-y divide-slate-50">
            {pedidosShopify.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-slate-400">Sin pedidos Shopify</p>
                <a href="/dashboard/carritos" className="text-xs text-commerk-navy font-medium hover:underline mt-1 block">
                  Sincronizar pedidos →
                </a>
              </div>
            ) : (
              pedidosShopify.map((p: any) => (
                <div key={p.id} className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">#{p.shopify_order_number}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        p.estado_financiero === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                        p.estado_financiero === 'pending' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {p.estado_financiero === 'paid' ? '✓ Pagado' : p.estado_financiero}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {p.nombre_cliente || p.email || '—'} · {fmtDate(p.shopify_created_at || p.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <span className="text-sm font-bold text-commerk-navy">{fmt(p.total)}</span>
                    {p.notificado_whatsapp
                      ? <span className="text-xs text-commerk-green" title="WhatsApp enviado">✓ WA</span>
                      : <span className="text-xs text-slate-300" title="Sin notificación WA">— WA</span>
                    }
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Actividad en tiempo real */}
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-commerk-navy">Actividad Reciente</h2>
              <span className="w-2 h-2 bg-commerk-green rounded-full animate-pulse" />
            </div>
            <span className="text-xs text-slate-400">Actualiza cada 60s</span>
          </div>
          <div className="divide-y divide-slate-50">
            {actividadReciente.length === 0 ? (
              <p className="p-6 text-sm text-slate-400 text-center">Sin actividad reciente</p>
            ) : (
              actividadReciente.map((item: any, i: number) => (
                <div key={i} className="px-6 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${
                    item.tipo === 'pedido' ? 'bg-[#96bf48]/15 text-[#5a7a1f]' : 'bg-commerk-green/15 text-commerk-green'
                  }`}>
                    {item.tipo === 'pedido' ? '🛍️' : '💬'}
                  </div>
                  <div className="flex-1 min-w-0">
                    {item.tipo === 'pedido' ? (
                      <>
                        <p className="text-sm font-semibold text-slate-800">
                          Pedido #{item.shopify_order_number} — {fmt(item.total)}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{item.nombre_cliente || item.email || 'Cliente'}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-slate-800">
                          Chat {item.estado === 'activa' ? 'activo' : item.estado}
                        </p>
                        <p className="text-xs text-slate-400">{item.cliente?.nombre || item.cliente?.telefono || 'Cliente'}</p>
                      </>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{fmtDate(item._ts)}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Tablas secundarias */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Últimas ventas (bot/Wompi) */}
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-commerk-navy">Ventas (Bot / Wompi)</h2>
            <a href="/dashboard/ventas" className="text-xs text-commerk-green font-medium hover:underline">Ver todas →</a>
          </div>
          <div className="divide-y divide-slate-50">
            {ultimasVentas.length === 0 ? (
              <p className="p-6 text-sm text-slate-400 text-center">Sin ventas registradas</p>
            ) : (
              ultimasVentas.map((v) => (
                <div key={v.id} className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{v.producto_nombre}</p>
                    <p className="text-xs text-slate-400">{v.cliente?.nombre || v.cliente?.telefono || '—'} · {fmtDate(v.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <span className="text-sm font-bold text-commerk-navy">{fmt(v.total)}</span>
                    <EstadoBadge estado={v.estado} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Últimos clientes */}
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-commerk-navy">Nuevos Clientes</h2>
            <a href="/dashboard/clientes" className="text-xs text-commerk-green font-medium hover:underline">Ver todos →</a>
          </div>
          <div className="divide-y divide-slate-50">
            {ultimosClientes.length === 0 ? (
              <p className="p-6 text-sm text-slate-400 text-center">Sin clientes registrados</p>
            ) : (
              ultimosClientes.map((c) => (
                <div key={c.id} className="px-6 py-3.5 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-commerk-navy/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-commerk-navy">
                      {(c.nombre || c.telefono || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{c.nombre || 'Sin nombre'}</p>
                    <p className="text-xs text-slate-400">{c.telefono} · {fmtDate(c.created_at)}</p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-commerk-green shrink-0" title="Activo" />
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
