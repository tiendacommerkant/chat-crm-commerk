'use client';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Card } from '@/components/ui/card';
import type { PedidoShopify } from '@/types';

type EstadoFin = 'todos' | 'paid' | 'pending' | 'refunded' | 'voided' | 'partially_paid';

const ESTADOS_FINANCIERO: Record<string, { label: string; cls: string }> = {
  paid:            { label: 'Pagado',         cls: 'bg-emerald-100 text-emerald-700' },
  pending:         { label: 'Pendiente',       cls: 'bg-amber-100 text-amber-700' },
  partially_paid:  { label: 'Parcial',         cls: 'bg-yellow-100 text-yellow-700' },
  refunded:        { label: 'Reembolsado',     cls: 'bg-purple-100 text-purple-700' },
  voided:          { label: 'Anulado',         cls: 'bg-red-100 text-red-600' },
};

const ESTADOS_FULFILLMENT: Record<string, { label: string; cls: string }> = {
  fulfilled:   { label: 'Enviado',      cls: 'bg-blue-100 text-blue-700' },
  partial:     { label: 'Parcial',      cls: 'bg-sky-100 text-sky-700' },
  unfulfilled: { label: 'Sin enviar',   cls: 'bg-slate-100 text-slate-500' },
  null:        { label: 'Sin enviar',   cls: 'bg-slate-100 text-slate-500' },
};

function BadgeFinanciero({ estado }: { estado: string }) {
  const e = ESTADOS_FINANCIERO[estado] || { label: estado, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${e.cls}`}>{e.label}</span>;
}

function BadgeFulfillment({ estado }: { estado: string | null }) {
  const key = estado || 'null';
  const e = ESTADOS_FULFILLMENT[key] || { label: key, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${e.cls}`}>{e.label}</span>;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

function fmtFecha(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function PedidosPage() {
  const [pedidos, setPedidos] = useState<PedidoShopify[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [filtroFin, setFiltroFin] = useState<EstadoFin>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [busquedaInput, setBusquedaInput] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [syncando, setSyncando] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [stats, setStats] = useState({ pagados: 0, pendientes: 0, cancelados: 0, totalRevenue: 0 });
  const busquedaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargarPedidos = useCallback(async (p = 1, fin = filtroFin, q = busqueda) => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ pagina: p.toString(), por_pagina: '50' });
      if (fin !== 'todos') params.set('estado', fin);
      if (q) params.set('q', q);

      const res = await fetch(`/api/pedidos?${params}`);
      const json = await res.json();
      if (json.success) {
        setPedidos(json.pedidos);
        setTotal(json.total);
        setTotalPaginas(json.totalPaginas);
        setPagina(p);
      }
    } finally {
      setCargando(false);
    }
  }, [filtroFin, busqueda]);

  const cargarStats = useCallback(async () => {
    try {
      const [rPaid, rPend, rCan] = await Promise.all([
        fetch('/api/pedidos?estado=paid&por_pagina=1'),
        fetch('/api/pedidos?estado=pending&por_pagina=1'),
        fetch('/api/pedidos?estado=voided&por_pagina=1'),
      ]);
      const [jPaid, jPend, jCan] = await Promise.all([rPaid.json(), rPend.json(), rCan.json()]);

      // Para revenue total, traemos todos los pagados
      const rRev = await fetch('/api/pedidos?estado=paid&por_pagina=250');
      const jRev = await rRev.json();
      const revenue = (jRev.pedidos || []).reduce((s: number, p: PedidoShopify) => s + (p.total || 0), 0);

      setStats({
        pagados: jPaid.total || 0,
        pendientes: jPend.total || 0,
        cancelados: jCan.total || 0,
        totalRevenue: revenue,
      });
    } catch {}
  }, []);

  useEffect(() => {
    cargarPedidos(1, filtroFin, busqueda);
  }, [filtroFin]);

  useEffect(() => {
    cargarStats();
  }, []);

  const handleBusqueda = (v: string) => {
    setBusquedaInput(v);
    if (busquedaTimer.current) clearTimeout(busquedaTimer.current);
    busquedaTimer.current = setTimeout(() => {
      setBusqueda(v);
      cargarPedidos(1, filtroFin, v);
    }, 400);
  };

  const cambiarFiltro = (f: EstadoFin) => {
    setFiltroFin(f);
    setBusqueda('');
    setBusquedaInput('');
    setPagina(1);
  };

  const syncPedidos = async () => {
    setSyncando(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/shopify/orders?limit=250&status=any');
      const json = await res.json();
      if (json.success) {
        setSyncResult(`✅ ${json.sincronizados} pedidos sincronizados (${json.errores} errores) — total en Shopify: ${json.total}`);
        await cargarPedidos(1, filtroFin, busqueda);
        await cargarStats();
      } else {
        setSyncResult(`❌ ${json.error}`);
      }
    } catch {
      setSyncResult('❌ Error de conexión');
    } finally {
      setSyncando(false);
    }
  };

  const TABS: { key: EstadoFin; label: string }[] = [
    { key: 'todos',           label: 'Todos' },
    { key: 'paid',            label: 'Pagados' },
    { key: 'pending',         label: 'Pendientes' },
    { key: 'partially_paid',  label: 'Parciales' },
    { key: 'refunded',        label: 'Reembolsados' },
    { key: 'voided',          label: 'Anulados' },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Pedidos Shopify</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total.toLocaleString('es-CO')} pedidos sincronizados</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => cargarPedidos(pagina, filtroFin, busqueda)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:border-commerk-navy/40 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
          <button
            onClick={syncPedidos}
            disabled={syncando}
            className="flex items-center gap-2 px-4 py-2 bg-commerk-navy text-white rounded-xl text-sm font-semibold hover:bg-commerk-navy/90 transition-all disabled:opacity-60"
          >
            {syncando
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
            }
            {syncando ? 'Sincronizando...' : 'Sync desde Shopify'}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          syncResult.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          {syncResult}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Total pedidos</p>
          <p className="text-2xl font-bold text-commerk-navy mt-1">{total.toLocaleString('es-CO')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Pagados</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.pagados.toLocaleString('es-CO')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Pendientes</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{stats.pendientes.toLocaleString('es-CO')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Revenue (pagados)</p>
          <p className="text-lg font-bold text-commerk-navy mt-1">{fmt(stats.totalRevenue)}</p>
        </Card>
      </div>

      {/* Búsqueda + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={busquedaInput}
            onChange={(e) => handleBusqueda(e.target.value)}
            placeholder="Buscar por #orden, cliente, email..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-commerk-navy/40 focus:ring-2 focus:ring-commerk-navy/10"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => cambiarFiltro(t.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filtroFin === t.key
                  ? 'bg-commerk-navy text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-commerk-navy/40'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
          </div>
        ) : pedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium">Sin pedidos{busqueda ? ` para "${busqueda}"` : ''}</p>
            <p className="text-xs">Usa el botón "Sync desde Shopify" para importar pedidos</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Orden</th>
                    <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Cliente</th>
                    <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">Productos</th>
                    <th className="text-right px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Total</th>
                    <th className="text-center px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Pago</th>
                    <th className="text-center px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">Envío</th>
                    <th className="text-center px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden sm:table-cell">WA</th>
                    <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden xl:table-cell">Fecha</th>
                    <th className="px-5 py-3 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pedidos.map((p) => {
                    const isExpanded = expandido === p.id;
                    const itemsResumen = (p.items || []).slice(0, 2).map((i) => `${i.title} ×${i.quantity}`).join(' · ');
                    return (
                      <Fragment key={p.id}>
                        <tr
                          className={`hover:bg-slate-50/70 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50/50' : ''}`}
                          onClick={() => setExpandido(isExpanded ? null : p.id)}
                        >
                          <td className="px-5 py-4">
                            <div>
                              <p className="font-bold text-commerk-navy">#{p.shopify_order_number}</p>
                              <p className="text-xs text-slate-400 font-mono">{p.shopify_order_id}</p>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div>
                              <p className="font-semibold text-slate-800 truncate max-w-[140px]">{p.nombre_cliente || 'Anónimo'}</p>
                              {p.email && <p className="text-xs text-slate-400 truncate max-w-[140px]">{p.email}</p>}
                              {p.telefono && (
                                <a
                                  href={`https://wa.me/${p.telefono}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs text-commerk-green font-medium hover:underline"
                                >
                                  {p.telefono}
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-4 hidden lg:table-cell">
                            <p className="text-xs text-slate-500 max-w-[220px] truncate">{itemsResumen || '—'}</p>
                            {(p.items?.length || 0) > 2 && (
                              <p className="text-xs text-slate-400">+{(p.items?.length || 0) - 2} más</p>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <p className="font-bold text-commerk-navy whitespace-nowrap">{fmt(p.total || 0)}</p>
                            {(p.total_descuentos || 0) > 0 && (
                              <p className="text-xs text-slate-400">-{fmt(p.total_descuentos)}</p>
                            )}
                          </td>
                          <td className="px-5 py-4 text-center">
                            <BadgeFinanciero estado={p.estado_financiero} />
                          </td>
                          <td className="px-5 py-4 text-center hidden md:table-cell">
                            <BadgeFulfillment estado={p.estado_fulfillment || null} />
                          </td>
                          <td className="px-5 py-4 text-center hidden sm:table-cell">
                            {p.notificado_whatsapp
                              ? <span title="Notificado por WA" className="text-emerald-500 text-base">✓</span>
                              : <span title="Sin notificación WA" className="text-slate-300 text-base">—</span>
                            }
                          </td>
                          <td className="px-5 py-4 hidden xl:table-cell">
                            <p className="text-xs text-slate-500 whitespace-nowrap">{fmtFecha(p.shopify_created_at)}</p>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <svg
                              className={`w-4 h-4 text-slate-400 transition-transform mx-auto ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </td>
                        </tr>

                        {/* Fila expandida */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={9} className="px-5 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                                {/* Items */}
                                <div>
                                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Productos</p>
                                  <div className="space-y-1">
                                    {(p.items || []).map((item, i) => (
                                      <div key={i} className="flex justify-between text-xs">
                                        <span className="text-slate-700">{item.title} ×{item.quantity}</span>
                                        <span className="font-semibold text-slate-800 ml-2">{fmt(item.price * item.quantity)}</span>
                                      </div>
                                    ))}
                                    {(p.total_descuentos || 0) > 0 && (
                                      <div className="flex justify-between text-xs text-emerald-600 border-t border-slate-200 pt-1 mt-1">
                                        <span>Descuento</span>
                                        <span>-{fmt(p.total_descuentos)}</span>
                                      </div>
                                    )}
                                    <div className="flex justify-between text-xs font-bold text-commerk-navy border-t border-slate-200 pt-1 mt-1">
                                      <span>Total</span>
                                      <span>{fmt(p.total)}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Dirección de envío */}
                                <div>
                                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Dirección de envío</p>
                                  {p.direccion_envio ? (
                                    <div className="text-xs text-slate-600 space-y-0.5">
                                      <p className="font-medium">{p.direccion_envio.name || p.nombre_cliente}</p>
                                      <p>{p.direccion_envio.address1}{p.direccion_envio.address2 ? `, ${p.direccion_envio.address2}` : ''}</p>
                                      <p>{p.direccion_envio.city}{p.direccion_envio.province ? `, ${p.direccion_envio.province}` : ''}</p>
                                      {p.direccion_envio.phone && <p className="text-commerk-green">{p.direccion_envio.phone}</p>}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-slate-400">Sin dirección registrada</p>
                                  )}
                                </div>

                                {/* Info adicional */}
                                <div>
                                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Detalles</p>
                                  <div className="text-xs text-slate-600 space-y-1.5">
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">ID Shopify</span>
                                      <span className="font-mono">{p.shopify_order_id}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Moneda</span>
                                      <span>{p.moneda}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Pago</span>
                                      <BadgeFinanciero estado={p.estado_financiero} />
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Envío</span>
                                      <BadgeFulfillment estado={p.estado_fulfillment || null} />
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Notif. WA</span>
                                      <span className={p.notificado_whatsapp ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                                        {p.notificado_whatsapp ? '✓ Enviada' : 'No enviada'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-slate-500">Creado</span>
                                      <span>{fmtFecha(p.shopify_created_at)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  Mostrando {((pagina - 1) * 50) + 1}–{Math.min(pagina * 50, total)} de {total.toLocaleString('es-CO')} pedidos
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={pagina === 1}
                    onClick={() => cargarPedidos(pagina - 1, filtroFin, busqueda)}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:border-commerk-navy/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Anterior
                  </button>
                  <span className="px-3 py-1.5 text-xs font-semibold text-commerk-navy">
                    {pagina} / {totalPaginas}
                  </span>
                  <button
                    disabled={pagina === totalPaginas}
                    onClick={() => cargarPedidos(pagina + 1, filtroFin, busqueda)}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:border-commerk-navy/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Siguiente →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
