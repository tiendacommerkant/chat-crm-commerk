'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';

type EstadoFiltro = 'todos' | 'pagado' | 'pendiente' | 'cancelado' | 'reembolsado';

type VentaUnificada = {
  id: string;
  fuente: 'shopify' | 'bot';
  fecha: string;
  referencia: string;
  nombre_cliente: string;
  telefono: string | null;
  email: string | null;
  productos: string;
  cantidad: number;
  total: number;
  descuentos: number;
  estado: string;
  estado_financiero: string;
  estado_fulfillment: string | null;
  notificado_whatsapp: boolean;
};

type Stats = { total: number; pagadas: number; pendientes: number; canceladas: number; revenue: number };

const ESTADOS: Record<string, { label: string; cls: string }> = {
  pagado:      { label: 'Pagado',       cls: 'bg-emerald-100 text-emerald-700' },
  pendiente:   { label: 'Pendiente',    cls: 'bg-amber-100 text-amber-700' },
  cancelado:   { label: 'Cancelado',    cls: 'bg-red-100 text-red-600' },
  reembolsado: { label: 'Reembolsado',  cls: 'bg-purple-100 text-purple-700' },
};

function EstadoBadge({ estado }: { estado: string }) {
  const e = ESTADOS[estado] || { label: estado, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${e.cls}`}>{e.label}</span>;
}

function FuenteBadge({ fuente }: { fuente: 'shopify' | 'bot' }) {
  return fuente === 'shopify'
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Shopify</span>
    : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600 font-medium">Bot WA</span>;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function VentasPage() {
  const [ventas, setVentas] = useState<VentaUnificada[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pagadas: 0, pendientes: 0, canceladas: 0, revenue: 0 });
  const [filtro, setFiltro] = useState<EstadoFiltro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/ventas');
      const json = await res.json();
      if (json.success) {
        setVentas(json.ventas);
        setStats(json.stats);
      }
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = ventas.filter((v) => {
    const matchEstado = filtro === 'todos' || v.estado === filtro;
    const q = busqueda.toLowerCase();
    const matchSearch = !q
      || v.nombre_cliente.toLowerCase().includes(q)
      || v.productos.toLowerCase().includes(q)
      || v.referencia.toLowerCase().includes(q)
      || (v.telefono || '').includes(q)
      || (v.email || '').toLowerCase().includes(q);
    return matchEstado && matchSearch;
  });

  const totalFiltradas = filtradas.reduce((s, v) => s + v.total, 0);

  function exportarCSV() {
    const header = ['Fecha', 'Fuente', 'Referencia', 'Cliente', 'Teléfono', 'Productos', 'Cantidad', 'Total', 'Estado'].join(',');
    const rows = filtradas.map((v) => [
      new Date(v.fecha).toLocaleDateString('es-CO'),
      v.fuente,
      v.referencia,
      `"${v.nombre_cliente}"`,
      v.telefono || '',
      `"${v.productos}"`,
      v.cantidad,
      v.total,
      v.estado,
    ].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas-commerk-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const TABS: { key: EstadoFiltro; label: string; count: number; color: string }[] = [
    { key: 'todos',       label: 'Todos',        count: stats.total,      color: 'border-commerk-navy/20 bg-commerk-navy/5' },
    { key: 'pagado',      label: 'Pagados',       count: stats.pagadas,    color: 'border-emerald-200 bg-emerald-50' },
    { key: 'pendiente',   label: 'Pendientes',    count: stats.pendientes, color: 'border-amber-200 bg-amber-50' },
    { key: 'cancelado',   label: 'Cancelados',    count: stats.canceladas, color: 'border-red-200 bg-red-50' },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Ventas</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {stats.total} registros · Shopify + Bot WA · Revenue: <span className="font-semibold text-emerald-600">{fmt(stats.revenue)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={cargar}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:border-commerk-navy/40 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
          <button
            onClick={exportarCSV}
            className="flex items-center gap-2 px-4 py-2.5 bg-commerk-navy text-white rounded-xl text-sm font-semibold hover:bg-commerk-navy/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Revenue card destacada */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFiltro(t.key)}
            className={`p-4 rounded-xl border text-left transition-all ${t.color} ${
              filtro === t.key ? 'ring-2 ring-commerk-navy shadow-sm' : ''
            }`}
          >
            <p className="text-xs text-slate-500 font-medium">{t.label}</p>
            <p className="text-2xl font-bold text-commerk-navy mt-1">{t.count.toLocaleString('es-CO')}</p>
          </button>
        ))}
      </div>

      {/* Búsqueda */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Buscar por cliente, producto, referencia, teléfono..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-commerk-navy/20 focus:border-commerk-navy/40"
        />
      </div>

      {/* Resumen */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-slate-500">{filtradas.length} registros</p>
        <p className="text-sm font-bold text-commerk-navy">
          Total: <span className="text-commerk-green">{fmt(totalFiltradas)}</span>
        </p>
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
          </div>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            <p className="text-sm">Sin ventas encontradas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Fecha</th>
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden sm:table-cell">Fuente</th>
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Cliente</th>
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">Productos</th>
                  <th className="text-center px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">Uds.</th>
                  <th className="text-right px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Total</th>
                  <th className="text-center px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtradas.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="text-xs text-slate-500 whitespace-nowrap">{fmtFecha(v.fecha)}</p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{v.referencia}</p>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <FuenteBadge fuente={v.fuente} />
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-slate-800 truncate max-w-[140px]">{v.nombre_cliente}</p>
                      {v.telefono && (
                        <a
                          href={`https://wa.me/${v.telefono}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-commerk-green hover:underline"
                        >
                          {v.telefono}
                        </a>
                      )}
                      {!v.telefono && v.email && (
                        <p className="text-xs text-slate-400 truncate max-w-[140px]">{v.email}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 hidden lg:table-cell">
                      <p className="text-xs text-slate-500 max-w-[220px] truncate">{v.productos}</p>
                    </td>
                    <td className="px-5 py-3.5 text-center text-slate-600 hidden md:table-cell">
                      {v.cantidad}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <p className="font-bold text-commerk-navy whitespace-nowrap">{fmt(v.total)}</p>
                      {v.descuentos > 0 && (
                        <p className="text-xs text-slate-400">-{fmt(v.descuentos)}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <EstadoBadge estado={v.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
