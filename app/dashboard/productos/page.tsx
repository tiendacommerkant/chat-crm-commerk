'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Producto {
  id: string;
  shopify_id: string;
  titulo: string;
  precio: number;
  inventario: number;
  imagen_url?: string | null;
  categoria?: string | null;
  activo: boolean;
  updated_at: string;
}

function InventarioBadge({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-600">Agotado</span>;
  if (cantidad <= 5) return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-600">Bajo ({cantidad})</span>;
  return <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700">En stock ({cantidad})</span>;
}

export default function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultSync, setResultSync] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'activo' | 'agotado'>('todos');

  const cargarProductos = async () => {
    const { data } = await supabase
      .from('productos')
      .select('*')
      .order('titulo', { ascending: true });
    if (data) setProductos(data);
    setCargando(false);
  };

  useEffect(() => { cargarProductos(); }, []);

  const sincronizar = async () => {
    setSincronizando(true);
    setResultSync(null);
    try {
      const res = await fetch('/api/shopify/sync');
      const json = await res.json();
      if (json.success) {
        setResultSync(`✅ ${json.sincronizados} productos sincronizados desde Shopify`);
        cargarProductos();
      } else {
        setResultSync(`❌ Error: ${json.error || json.message}`);
      }
    } catch {
      setResultSync('❌ No se pudo conectar con Shopify');
    }
    setSincronizando(false);
    setTimeout(() => setResultSync(null), 5000);
  };

  const filtrados = productos.filter((p) => {
    const q = busqueda.toLowerCase();
    const matchSearch = !q || p.titulo.toLowerCase().includes(q) || p.categoria?.toLowerCase().includes(q);
    const matchFiltro =
      filtro === 'todos' ||
      (filtro === 'activo' && p.activo && p.inventario > 0) ||
      (filtro === 'agotado' && p.inventario === 0);
    return matchSearch && matchFiltro;
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const totalActivos = productos.filter((p) => p.activo && p.inventario > 0).length;
  const totalAgotados = productos.filter((p) => p.inventario <= 0).length;
  const valorInventario = productos.reduce((s, p) => s + p.precio * Math.max(0, p.inventario), 0);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Inventario Shopify</h1>
          <p className="text-sm text-slate-500 mt-0.5">{productos.length} productos en catálogo</p>
        </div>
        <button
          id="btn-sincronizar"
          onClick={sincronizar}
          disabled={sincronizando}
          className="flex items-center gap-2 px-5 py-2.5 bg-commerk-navy text-white rounded-xl text-sm font-bold hover:bg-commerk-navy-dark transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
        >
          {sincronizando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Sincronizando...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sincronizar con Shopify
            </>
          )}
        </button>
      </div>

      {/* Toast */}
      {resultSync && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium animate-fade-in ${
          resultSync.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          {resultSync}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total productos', value: productos.length, accent: 'navy' },
          { label: 'En stock', value: totalActivos, accent: 'green' },
          { label: 'Agotados', value: totalAgotados, accent: 'wine' },
          { label: 'Valor inventario', value: fmt(valorInventario), accent: 'gold' },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-slate-500 font-medium">{s.label}</p>
            <p className={`text-xl font-bold mt-1 ${
              s.accent === 'green' ? 'text-commerk-green' :
              s.accent === 'wine' ? 'text-commerk-wine' :
              s.accent === 'gold' ? 'text-commerk-gold' : 'text-commerk-navy'
            }`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="search-productos"
            type="text"
            placeholder="Buscar producto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-commerk-navy/20 focus:border-commerk-navy transition-all"
          />
        </div>
        <div className="flex gap-2">
          {(['todos', 'activo', 'agotado'] as const).map((f) => (
            <button
              key={f}
              id={`filtro-productos-${f}`}
              onClick={() => setFiltro(f)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                filtro === f ? 'bg-commerk-navy text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:border-commerk-navy/40'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {cargando ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
        </div>
      ) : filtrados.length === 0 ? (
        <Card className="flex flex-col items-center justify-center h-48 text-slate-400 gap-3">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
          </svg>
          <p className="text-sm font-medium">
            {productos.length === 0
              ? 'Sin productos — haz clic en "Sincronizar con Shopify"'
              : 'Sin resultados para esa búsqueda'}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filtrados.map((p) => (
            <Card key={p.id} className={`overflow-hidden hover:shadow-md transition-all duration-200 ${!p.activo ? 'opacity-60' : ''}`}>
              {/* Image */}
              <div className="h-40 bg-slate-100 flex items-center justify-center overflow-hidden relative">
                {p.imagen_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imagen_url} alt={p.titulo} className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                {/* Shopify badge */}
                <div className="absolute top-2 right-2 px-2 py-0.5 bg-[#96bf48]/90 text-white text-[10px] font-bold rounded-full">
                  Shopify
                </div>
              </div>

              {/* Info */}
              <div className="p-4 space-y-3">
                <div>
                  <p className="font-bold text-commerk-navy text-sm leading-snug line-clamp-2">{p.titulo}</p>
                  {p.categoria && <p className="text-xs text-slate-400 mt-0.5">{p.categoria}</p>}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-commerk-navy">{fmt(p.precio)}</span>
                  <InventarioBadge cantidad={p.inventario} />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400">
                    Sync: {fmtDate(p.updated_at)}
                  </span>
                  <span className={`text-[10px] font-semibold ${p.activo ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {p.activo ? '● Activo' : '○ Inactivo'}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
