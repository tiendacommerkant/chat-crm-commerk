'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogClose } from '@/components/ui/dialog';
import type { Cliente } from '@/types';

function Avatar({ nombre, telefono }: { nombre?: string | null; telefono: string }) {
  const letter = (nombre || telefono || '?')[0].toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-commerk-navy/10 flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-commerk-navy">{letter}</span>
    </div>
  );
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [filtrados, setFiltrados] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState<Cliente | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function cargarClientes() {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        setClientes(data);
        setFiltrados(data);
      }
      setCargando(false);
    }
    cargarClientes();
  }, []);

  useEffect(() => {
    const q = busqueda.toLowerCase();
    setFiltrados(
      q
        ? clientes.filter(
            (c) =>
              c.nombre?.toLowerCase().includes(q) ||
              c.telefono.includes(q) ||
              c.email?.toLowerCase().includes(q) ||
              c.ciudad?.toLowerCase().includes(q)
          )
        : clientes
    );
  }, [busqueda, clientes]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-commerk-navy">Clientes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {clientes.length} clientes registrados en total
          </p>
        </div>
        <Badge className="bg-commerk-navy text-white hover:bg-commerk-navy/90 px-3 py-1 text-sm rounded-full self-start sm:self-auto">
          {filtrados.length} resultados
        </Badge>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          id="search-clientes"
          type="text"
          placeholder="Buscar por nombre, teléfono, email o ciudad..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-commerk-navy/30 focus:border-commerk-navy transition-all"
        />
      </div>

      {/* Table Card */}
      <Card className="overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm">No se encontraron clientes</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Cliente</th>
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Teléfono</th>
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">Ciudad</th>
                  <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">Registro</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtrados.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                    onClick={() => setSeleccionado(c)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar nombre={c.nombre} telefono={c.telefono} />
                        <div>
                          <p className="font-semibold text-slate-800">{c.nombre || 'Sin nombre'}</p>
                          {c.email && <p className="text-xs text-slate-400">{c.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <a
                        href={`https://wa.me/${c.telefono}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 text-commerk-green font-medium hover:underline"
                      >
                        <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        {c.telefono}
                      </a>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 hidden md:table-cell">
                      {c.ciudad || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs hidden lg:table-cell">
                      {fmtDate(c.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSeleccionado(c); }}
                        className="text-xs text-commerk-navy font-medium hover:underline"
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!seleccionado} onClose={() => setSeleccionado(null)}>
        {seleccionado && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <Avatar nombre={seleccionado.nombre} telefono={seleccionado.telefono} />
                <DialogTitle>{seleccionado.nombre || 'Sin nombre'}</DialogTitle>
              </div>
              <DialogClose onClose={() => setSeleccionado(null)} />
            </DialogHeader>
            <DialogContent>
              <dl className="space-y-4 text-sm">
                {[
                  { label: 'ID', value: seleccionado.id },
                  { label: 'Teléfono', value: seleccionado.telefono },
                  { label: 'Email', value: seleccionado.email || '—' },
                  { label: 'Ciudad', value: seleccionado.ciudad || '—' },
                  { label: 'Registro', value: fmtDate(seleccionado.created_at) },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-start gap-4 py-2 border-b border-slate-100 last:border-0">
                    <dt className="text-slate-500 font-medium shrink-0">{item.label}</dt>
                    <dd className="text-slate-800 text-right break-all">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 flex flex-col gap-2">
                {/* Botón principal: abrir conversación en el dashboard */}
                <button
                  onClick={() => {
                    setSeleccionado(null);
                    router.push(`/dashboard/conversaciones?cliente=${seleccionado.id}`);
                  }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-commerk-navy text-white rounded-xl font-bold text-sm hover:bg-commerk-navy/90 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Ver conversación
                </button>

                {/* Botón secundario: abrir WhatsApp externo */}
                <a
                  href={`https://wa.me/${seleccionado.telefono}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 bg-commerk-green/10 text-commerk-green rounded-xl font-semibold text-sm hover:bg-commerk-green/20 transition-all border border-commerk-green/20"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Abrir en WhatsApp
                </a>
              </div>
            </DialogContent>
          </>
        )}
      </Dialog>
    </div>
  );
}
