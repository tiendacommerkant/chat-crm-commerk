'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import type { CarritoAbandonado } from '@/types';

type EstadoFiltro = 'todos' | 'en_progreso' | 'abandonado' | 'notificado' | 'convertido';

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    en_progreso: 'bg-blue-100 text-blue-700',
    abandonado:  'bg-amber-100 text-amber-700',
    notificado:  'bg-purple-100 text-purple-700',
    convertido:  'bg-emerald-100 text-emerald-700',
  };
  const labels: Record<string, string> = {
    en_progreso: '● En checkout',
    abandonado:  '● Abandonado',
    notificado:  '● Notificado',
    convertido:  '✓ Convertido',
  };
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${map[estado] || 'bg-slate-100 text-slate-500'}`}>
      {labels[estado] || estado}
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Ahora';
  if (diff < 3600000) return `hace ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `hace ${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

export default function CarritosPage() {
  const [carritos, setCarritos] = useState<CarritoAbandonado[]>([]);
  const [filtro, setFiltro] = useState<EstadoFiltro>('todos');
  const [cargando, setCargando] = useState(true);
  const [recuperando, setRecuperando] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const cargarCarritos = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/carritos');
      const json = await res.json();
      if (json.success) setCarritos(json.carritos);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarCarritos(); }, [cargarCarritos]);

  // Supabase Realtime: actualiza instantáneamente cuando llega un webhook de Shopify
  useEffect(() => {
    const channel = supabase
      .channel('carritos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carritos_abandonados' }, () => {
        cargarCarritos();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [cargarCarritos]);

  // Auto-refresh cada 15 segundos como fallback
  useEffect(() => {
    const interval = setInterval(cargarCarritos, 15000);
    return () => clearInterval(interval);
  }, [cargarCarritos]);

  const recuperar = async (id: string) => {
    setRecuperando(id);
    try {
      const res = await fetch(`/api/carritos/${id}/recover`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setToast({ msg: '✅ Mensaje enviado por WhatsApp', ok: true });
        cargarCarritos();
      } else {
        setToast({ msg: `❌ ${json.error}`, ok: false });
      }
    } catch {
      setToast({ msg: '❌ Error de conexión', ok: false });
    } finally {
      setRecuperando(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const syncCarritos = async () => {
    setSyncingOrders(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/shopify/checkouts?limit=250');
      const json = await res.json();
      if (json.success) {
        setSyncResult(`✅ ${json.sincronizados} carritos sincronizados (${json.errores} errores) — total en Shopify: ${json.total}`);
        await cargarCarritos();
      } else {
        setSyncResult(`❌ ${json.error}`);
      }
    } catch {
      setSyncResult('❌ Error de conexión');
    } finally {
      setSyncingOrders(false);
    }
  };

  const filtrados = filtro === 'todos' ? carritos : carritos.filter((c) => c.estado === filtro);

  const counts: Record<EstadoFiltro, number> = {
    todos:      carritos.length,
    en_progreso: carritos.filter((c) => c.estado === 'en_progreso').length,
    abandonado: carritos.filter((c) => c.estado === 'abandonado').length,
    notificado: carritos.filter((c) => c.estado === 'notificado').length,
    convertido: carritos.filter((c) => c.estado === 'convertido').length,
  };

  const valorPerdido = carritos
    .filter((c) => c.estado === 'abandonado' || c.estado === 'notificado')
    .reduce((s, c) => s + (c.total || 0), 0);

  const tasaRecuperacion = counts.convertido + counts.notificado > 0
    ? Math.round((counts.convertido / (counts.abandonado + counts.notificado + counts.convertido)) * 100)
    : 0;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-in ${
          toast.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Carritos & Pedidos</h1>
          <p className="text-sm text-slate-500 mt-0.5">Checkouts en tiempo real · Recuperación automática</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={cargarCarritos}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:border-commerk-navy/40 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
          <button
            onClick={syncCarritos}
            disabled={syncingOrders}
            className="flex items-center gap-2 px-4 py-2 bg-commerk-navy text-white rounded-xl text-sm font-semibold hover:bg-commerk-navy/90 transition-all disabled:opacity-60"
          >
            {syncingOrders
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
            }
            Sync Carritos Shopify
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium animate-fade-in ${
          syncResult.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
        }`}>
          {syncResult}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">En checkout ahora</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{counts.en_progreso}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Carritos abandonados</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{counts.abandonado}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Valor perdido</p>
          <p className="text-xl font-bold text-commerk-wine mt-1">{fmt(valorPerdido)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Tasa de recuperación</p>
          <p className="text-2xl font-bold text-commerk-green mt-1">{tasaRecuperacion}%</p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {(['todos', 'en_progreso', 'abandonado', 'notificado', 'convertido'] as EstadoFiltro[]).map((f) => {
          const labels: Record<EstadoFiltro, string> = {
            todos: 'Todos', en_progreso: 'En checkout', abandonado: 'Abandonados',
            notificado: 'Notificados', convertido: 'Convertidos',
          };
          return (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filtro === f ? 'bg-commerk-navy text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:border-commerk-navy/40'
              }`}
            >
              {labels[f]} ({counts[f]})
            </button>
          );
        })}
      </div>

      {/* Tabla */}
      <Card className="overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-sm font-medium">Sin carritos en esta categoría</p>
            <p className="text-xs">Los checkouts de Shopify aparecen aquí automáticamente</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Cliente</th>
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">Productos</th>
                  <th className="text-right px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Total</th>
                  <th className="text-center px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Estado</th>
                  <th className="text-center px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden sm:table-cell">Última actividad</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtrados.map((c) => {
                  const itemsResumen = (c.items || []).slice(0, 2).map((i) => `${i.title} x${i.quantity}`).join(' · ');
                  const puedeRecuperar = c.telefono && !['convertido'].includes(c.estado);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-4">
                        <div>
                          <p className="font-semibold text-slate-800">{c.nombre || 'Anónimo'}</p>
                          {c.email && <p className="text-xs text-slate-400 truncate max-w-[180px]">{c.email}</p>}
                          {c.telefono && (
                            <a
                              href={`https://wa.me/${c.telefono}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-commerk-green font-medium hover:underline"
                            >
                              {c.telefono}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 hidden md:table-cell">
                        <p className="text-xs text-slate-500 max-w-[200px] truncate">{itemsResumen || '—'}</p>
                        {(c.items?.length || 0) > 2 && (
                          <p className="text-xs text-slate-400">+{(c.items?.length || 0) - 2} más</p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-commerk-navy whitespace-nowrap">
                        {fmt(c.total || 0)}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <EstadoBadge estado={c.estado} />
                      </td>
                      <td className="px-5 py-4 text-center text-xs text-slate-400 hidden sm:table-cell">
                        {fmtTime(c.shopify_updated_at || c.created_at)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {puedeRecuperar ? (
                          <button
                            onClick={() => recuperar(c.id)}
                            disabled={recuperando === c.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-commerk-green/10 text-commerk-green rounded-lg text-xs font-semibold hover:bg-commerk-green/20 transition-colors disabled:opacity-50 ml-auto"
                          >
                            {recuperando === c.id ? (
                              <span className="w-3 h-3 border-2 border-commerk-green/30 border-t-commerk-green rounded-full animate-spin" />
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                              </svg>
                            )}
                            {recuperando === c.id ? 'Enviando...' : 'Recuperar'}
                          </button>
                        ) : c.estado === 'convertido' ? (
                          <span className="text-xs text-emerald-600 font-semibold">✓ Compró</span>
                        ) : (
                          <span className="text-xs text-slate-400">Sin tel.</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Info de configuración */}
      <Card className="p-5 bg-commerk-navy/5 border-commerk-navy/20">
        <h3 className="font-semibold text-commerk-navy text-sm mb-3">⚙️ Configuración de Webhooks</h3>
        <p className="text-xs text-slate-600 mb-3">
          Para recibir checkouts en tiempo real, registra los webhooks de Shopify. Solo necesitas hacerlo una vez.
          Asegúrate de que <code className="bg-white px-1 py-0.5 rounded text-commerk-navy font-mono">NEXT_PUBLIC_BASE_URL</code> esté configurada en tu <code className="bg-white px-1 py-0.5 rounded font-mono">.env.local</code>.
        </p>
        <WebhookRegistrar />
      </Card>
    </div>
  );
}

// ─── Webhook Registrar ────────────────────────────────────────────────────────
function WebhookRegistrar() {
  const [estado, setEstado] = useState<'idle' | 'loading' | 'done'>('idle');
  const [resultado, setResultado] = useState<any>(null);

  const registrar = async () => {
    setEstado('loading');
    try {
      const res = await fetch('/api/shopify/webhooks', { method: 'POST' });
      const json = await res.json();
      setResultado(json);
    } catch {
      setResultado({ success: false, error: 'Error de red' });
    } finally {
      setEstado('done');
    }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={registrar}
        disabled={estado === 'loading'}
        className="flex items-center gap-2 px-4 py-2 bg-commerk-navy text-white rounded-xl text-xs font-semibold hover:bg-commerk-navy/90 transition-all disabled:opacity-60"
      >
        {estado === 'loading'
          ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        }
        {estado === 'loading' ? 'Registrando...' : 'Registrar webhooks en Shopify'}
      </button>

      {resultado && (
        <div className={`p-3 rounded-lg text-xs ${resultado.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {resultado.success
            ? `✅ ${resultado.registrados}/${resultado.total} webhooks registrados correctamente`
            : `❌ ${resultado.error}`
          }
          {resultado.fallidos?.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {resultado.fallidos.map((f: any) => (
                <li key={f.topic}>• {f.topic}: {f.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
