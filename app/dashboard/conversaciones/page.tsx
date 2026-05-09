'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────
type Cliente = { id: string; nombre?: string; telefono: string; email?: string; ciudad?: string };
type UltimoMensaje = { contenido: string; tipo: string; tipo_wa: string; created_at: string };
type Conversacion = {
  id: string; estado: string; created_at: string; updated_at: string;
  cliente: Cliente; ultimo_mensaje: UltimoMensaje | null;
  total_mensajes: number; no_leidos: number;
};
type Mensaje = {
  id: string; conversacion_id: string; tipo: 'user' | 'bot';
  contenido: string; created_at: string;
  metadata?: {
    tipo_wa?: string; media_url?: string; media_id?: string; media_mime_type?: string;
    caption?: string; filename?: string; plantilla?: string; referencia_id?: string;
    estado_envio?: string; enviado_por?: string; whatsapp_message_id?: string;
    interactive_title?: string; error?: string; latitude?: number; longitude?: number;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function iniciales(nombre?: string) {
  if (!nombre) return '?';
  return nombre.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function fmtHora(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'ahora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString('es-CO', { weekday: 'short' });
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function fmtFechaCompleta(iso: string) {
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const PLANTILLA_LABELS: Record<string, string> = {
  pedido_confirmado: '🎉 Pedido Confirmado',
  pedido_cancelado: '❌ Pedido Cancelado',
  pedido_enviado: '🚚 Pedido Enviado',
  carrito_abandonado: '🛒 Recuperación de Carrito',
};

const ESTADO_COLORS: Record<string, string> = {
  activa:     'bg-emerald-400',
  cerrada:    'bg-slate-400',
  abandonada: 'bg-amber-400',
};

// ─── Audio Player ─────────────────────────────────────────────────────────────
function AudioPlayer({ src }: { src: string }) {
  return (
    <audio controls className="max-w-[220px] h-10 rounded-full" preload="none">
      <source src={src} />
    </audio>
  );
}

// ─── Burbuja de mensaje ───────────────────────────────────────────────────────
function MensajeBurbuja({ msg }: { msg: Mensaje }) {
  const esUser = msg.tipo === 'user';
  const tipoWA = msg.metadata?.tipo_wa || 'text';
  const esTemplate = tipoWA === 'template';
  const esAgente = msg.metadata?.enviado_por === 'agente';

  if (esTemplate) {
    const label = PLANTILLA_LABELS[msg.metadata?.plantilla || ''] || '📋 Notificación';
    const ok = msg.metadata?.estado_envio !== 'fallido';
    return (
      <div className="flex justify-center my-3">
        <div className={`max-w-xs rounded-2xl border px-4 py-3 text-xs ${
          ok ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <div className="flex items-center gap-2 font-semibold mb-1.5">
            <span className="text-sm">{ok ? '📤' : '⚠️'}</span>
            <span>{label}</span>
            <span className={`ml-auto font-bold ${ok ? 'text-emerald-600' : 'text-red-500'}`}>
              {ok ? '✓ Enviado' : '✗ Error'}
            </span>
          </div>
          <p className="text-slate-600 whitespace-pre-wrap line-clamp-4">{msg.contenido}</p>
          <p className="text-slate-400 mt-1.5 text-right">{fmtFechaCompleta(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${esUser ? 'justify-start' : 'justify-end'} mb-1.5`}>
      <div className={`relative max-w-[72%] rounded-2xl px-4 py-2.5 shadow-sm ${
        esUser
          ? 'bg-white text-slate-800 rounded-tl-sm border border-slate-100'
          : esAgente
            ? 'bg-commerk-green text-white rounded-tr-sm'
            : 'bg-commerk-navy text-white rounded-tr-sm'
      }`}>
        {esAgente && (
          <p className="text-[10px] text-white/70 font-semibold mb-0.5 uppercase tracking-wide">Agente</p>
        )}

        {tipoWA === 'image' && msg.metadata?.media_url && (
          <div className="mb-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={msg.metadata.media_url}
              alt={msg.metadata.caption || 'Imagen'}
              className="rounded-xl max-h-60 w-auto cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(msg.metadata!.media_url, '_blank')}
            />
            {msg.metadata.caption && (
              <p className="text-sm mt-1 opacity-80">{msg.metadata.caption}</p>
            )}
          </div>
        )}

        {tipoWA === 'audio' && msg.metadata?.media_url && (
          <div className="py-1"><AudioPlayer src={msg.metadata.media_url} /></div>
        )}

        {tipoWA === 'video' && msg.metadata?.media_url && (
          <div className="mb-1">
            <video controls className="rounded-xl max-h-48 w-auto">
              <source src={msg.metadata.media_url} type={msg.metadata.media_mime_type} />
            </video>
            {msg.metadata.caption && <p className="text-sm mt-1 opacity-80">{msg.metadata.caption}</p>}
          </div>
        )}

        {tipoWA === 'document' && msg.metadata?.media_url && (
          <a
            href={msg.metadata.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2 hover:bg-white/20 transition-colors mb-1"
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium truncate">{msg.metadata.filename || 'Documento'}</span>
          </a>
        )}

        {tipoWA === 'location' && msg.metadata?.latitude && (
          <a
            href={`https://maps.google.com/?q=${msg.metadata.latitude},${msg.metadata.longitude}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm hover:underline mb-1"
          >
            <span>📍</span><span>{msg.contenido}</span>
          </a>
        )}

        {msg.contenido && !['📷 Imagen', '🎤 Nota de voz', '🎥 Video'].includes(msg.contenido) && (
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.contenido}</p>
        )}

        <p className={`text-[10px] mt-1 text-right ${esUser ? 'text-slate-400' : 'text-white/50'}`}>
          {fmtFechaCompleta(msg.created_at)}
          {!esUser && msg.metadata?.whatsapp_message_id && <span className="ml-1">✓✓</span>}
        </p>
      </div>
    </div>
  );
}

// ─── Modal Nueva Conversación ─────────────────────────────────────────────────
function ModalNuevaConversacion({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: (convId: string) => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [clientes, setClientes] = useState<any[]>([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState<any>(null);
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!busqueda.trim()) { setClientes([]); return; }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/clientes?q=${encodeURIComponent(busqueda)}&limit=8`);
      const json = await res.json();
      if (json.success) setClientes(json.clientes);
    }, 300);
    return () => clearTimeout(timer);
  }, [busqueda]);

  const enviar = async () => {
    if (!clienteSeleccionado || !mensaje.trim()) return;
    setEnviando(true);
    setError('');
    try {
      const res = await fetch('/api/conversaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: clienteSeleccionado.id, mensaje: mensaje.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        onCreada(json.conversacion_id);
      } else {
        setError(json.error || 'Error enviando');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-commerk-navy text-base">Nueva conversación</h3>
            <p className="text-xs text-slate-400 mt-0.5">Busca un cliente y envía el primer mensaje</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Buscador de clientes */}
          {!clienteSeleccionado ? (
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Cliente</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Nombre, teléfono o email..."
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-commerk-navy/40 focus:ring-2 focus:ring-commerk-navy/10"
                />
              </div>
              {clientes.length > 0 && (
                <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  {clientes.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setClienteSeleccionado(c); setBusqueda(''); setClientes([]); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-commerk-navy/10 flex items-center justify-center text-commerk-navy font-bold text-xs shrink-0">
                        {(c.nombre || c.telefono || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{c.nombre || 'Sin nombre'}</p>
                        <p className="text-xs text-slate-400">{c.telefono}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {busqueda && clientes.length === 0 && (
                <p className="text-xs text-slate-400 mt-2 text-center">Sin resultados para "{busqueda}"</p>
              )}
            </div>
          ) : (
            /* Cliente seleccionado */
            <div className="flex items-center gap-3 p-3 bg-commerk-navy/5 rounded-xl border border-commerk-navy/10">
              <div className="w-9 h-9 rounded-full bg-commerk-navy/10 flex items-center justify-center text-commerk-navy font-bold text-sm shrink-0">
                {(clienteSeleccionado.nombre || clienteSeleccionado.telefono || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 text-sm">{clienteSeleccionado.nombre || 'Sin nombre'}</p>
                <p className="text-xs text-commerk-green">{clienteSeleccionado.telefono}</p>
              </div>
              <button onClick={() => setClienteSeleccionado(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Mensaje */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Primer mensaje</label>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Escribe el mensaje que recibirá el cliente por WhatsApp..."
              rows={4}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:border-commerk-navy/40 focus:ring-2 focus:ring-commerk-navy/10"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-100">{error}</p>
          )}

          {/* Acciones */}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button
              onClick={enviar}
              disabled={!clienteSeleccionado || !mensaje.trim() || enviando}
              className="flex-1 py-2.5 rounded-xl bg-commerk-navy text-white text-sm font-semibold hover:bg-commerk-navy/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {enviando ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
              {enviando ? 'Enviando...' : 'Enviar por WhatsApp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeparadorFecha({ fecha }: { fecha: string }) {
  const d = new Date(fecha);
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86400000);
  let label = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  if (d.toDateString() === hoy.toDateString()) label = 'Hoy';
  else if (d.toDateString() === ayer.toDateString()) label = 'Ayer';
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-slate-200" />
      <span className="text-[11px] text-slate-400 font-medium capitalize bg-slate-50 px-2 rounded-full">{label}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ConversacionesPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" /></div>}>
      <ConversacionesContent />
    </Suspense>
  );
}

function ConversacionesContent() {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [activa, setActiva] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoConvs, setCargandoConvs] = useState(true);
  const [cargandoMsgs, setCargandoMsgs] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [textoRespuesta, setTextoRespuesta] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const [mostrarDetalle, setMostrarDetalle] = useState(false);

  const [mostrarModal, setMostrarModal] = useState(false);

  const searchParams = useSearchParams();
  const clienteIdParam = searchParams.get('cliente');

  const mensajesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const cargarConversaciones = useCallback(async () => {
    setCargandoConvs(true);
    try {
      const params = new URLSearchParams();
      if (filtroEstado !== 'todas') params.set('estado', filtroEstado);
      if (busqueda) params.set('q', busqueda);
      const res = await fetch(`/api/conversaciones?${params}`);
      const json = await res.json();
      if (json.success) setConversaciones(json.conversaciones);
    } finally {
      setCargandoConvs(false);
    }
  }, [filtroEstado, busqueda]);

  useEffect(() => { cargarConversaciones(); }, [cargarConversaciones]);

  const onConversacionCreada = useCallback(async (convId: string) => {
    setMostrarModal(false);
    const res = await fetch('/api/conversaciones');
    const json = await res.json();
    if (json.success) {
      setConversaciones(json.conversaciones);
      const conv = json.conversaciones.find((c: Conversacion) => c.id === convId);
      if (conv) setActiva(conv);
    }
  }, []);

  // Auto-seleccionar conversación si viene ?cliente= en la URL
  useEffect(() => {
    if (!clienteIdParam || conversaciones.length === 0) return;
    const conv = conversaciones.find((c) => c.cliente?.id === clienteIdParam);
    if (conv) setActiva(conv);
  }, [clienteIdParam, conversaciones]);

  const cargarMensajes = useCallback(async (convId: string) => {
    setCargandoMsgs(true);
    try {
      const res = await fetch(`/api/conversaciones/${convId}/messages`);
      const json = await res.json();
      if (json.success) setMensajes(json.mensajes);
    } finally {
      setCargandoMsgs(false);
    }
  }, []);

  useEffect(() => {
    if (activa) cargarMensajes(activa.id);
    else setMensajes([]);
  }, [activa, cargarMensajes]);

  useEffect(() => {
    mensajesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  // Realtime: nuevo mensaje en conversación activa
  useEffect(() => {
    if (!activa) return;
    const ch = supabase
      .channel(`msgs-${activa.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'mensajes',
        filter: `conversacion_id=eq.${activa.id}`,
      }, (payload) => {
        setMensajes((prev) => {
          if (prev.some((m) => m.id === payload.new.id)) return prev;
          return [...prev, payload.new as Mensaje];
        });
        cargarConversaciones();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activa, cargarConversaciones]);

  const enviarRespuesta = async () => {
    if (!textoRespuesta.trim() || !activa || enviando) return;
    setEnviando(true);
    const texto = textoRespuesta.trim();
    setTextoRespuesta('');
    try {
      const res = await fetch(`/api/conversaciones/${activa.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: texto }),
      });
      const json = await res.json();
      if (!json.success) {
        setTextoRespuesta(texto);
        alert(`Error al enviar: ${json.error}`);
      }
    } catch {
      setTextoRespuesta(texto);
    } finally {
      setEnviando(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarRespuesta(); }
  };

  // Agrupar mensajes por fecha
  type ItemChat = Mensaje | { _tipo: 'fecha'; fecha: string; _id: string };
  const mensajesConFecha = mensajes.reduce<ItemChat[]>((acc, msg, i) => {
    const prev = mensajes[i - 1];
    if (!prev || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString()) {
      acc.push({ _tipo: 'fecha', fecha: msg.created_at, _id: `f${i}` });
    }
    acc.push(msg);
    return acc;
  }, []);

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden">

      {/* ── Lista de conversaciones ──────────────────────────────── */}
      <aside className={`w-80 bg-white border-r border-slate-100 flex flex-col shrink-0 ${activa ? 'hidden lg:flex' : 'flex'}`}>
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-commerk-navy">Conversaciones</h2>
            <button
              onClick={() => setMostrarModal(true)}
              className="w-8 h-8 rounded-xl bg-commerk-navy text-white flex items-center justify-center hover:bg-commerk-navy/90 transition-colors shadow-sm"
              title="Nueva conversación"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div className="relative mb-3">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar cliente o mensaje..."
              className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-commerk-navy/40"
            />
          </div>
          <div className="flex gap-1">
            {[{ k: 'todas', l: 'Todas' }, { k: 'activa', l: 'Activas' }, { k: 'cerrada', l: 'Cerradas' }].map((t) => (
              <button key={t.k} onClick={() => setFiltroEstado(t.k)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  filtroEstado === t.k ? 'bg-commerk-navy text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>{t.l}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {cargandoConvs ? (
            <div className="flex justify-center items-center h-24">
              <div className="w-5 h-5 border-2 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
            </div>
          ) : conversaciones.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 text-slate-400 gap-1">
              <p className="text-xs">Sin conversaciones</p>
            </div>
          ) : conversaciones.map((conv) => {
            const esActiva = activa?.id === conv.id;
            const nombre = conv.cliente?.nombre || conv.cliente?.telefono || 'Desconocido';
            const tipoWA = conv.ultimo_mensaje?.tipo_wa;
            const preview = !conv.ultimo_mensaje ? 'Sin mensajes'
              : tipoWA === 'image' ? '📷 Imagen'
              : tipoWA === 'audio' ? '🎤 Nota de voz'
              : tipoWA === 'video' ? '🎥 Video'
              : tipoWA === 'template' ? '📤 Notificación enviada'
              : (conv.ultimo_mensaje.contenido || '').slice(0, 45) + ((conv.ultimo_mensaje.contenido?.length || 0) > 45 ? '…' : '');

            return (
              <button key={conv.id} onClick={() => setActiva(conv)}
                className={`w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 ${
                  esActiva ? 'bg-commerk-navy/5 border-l-2 border-l-commerk-navy' : ''
                }`}
              >
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-commerk-navy/10 flex items-center justify-center text-commerk-navy font-bold text-sm">
                    {iniciales(conv.cliente?.nombre)}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${ESTADO_COLORS[conv.estado] || 'bg-slate-300'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{nombre}</p>
                    {conv.ultimo_mensaje && (
                      <p className="text-[10px] text-slate-400 shrink-0">{fmtHora(conv.ultimo_mensaje.created_at)}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{preview}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{conv.cliente?.telefono}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="p-3 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-400">{conversaciones.length} conversaciones</p>
        </div>
      </aside>

      {/* ── Panel de chat ───────────────────────────────────────── */}
      {activa ? (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Header */}
          <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center gap-3 shrink-0 shadow-sm">
            <button onClick={() => setActiva(null)} className="lg:hidden p-1.5 rounded-xl hover:bg-slate-100 text-slate-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="w-9 h-9 rounded-full bg-commerk-navy/10 flex items-center justify-center text-commerk-navy font-bold text-sm shrink-0">
              {iniciales(activa.cliente?.nombre)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{activa.cliente?.nombre || 'Sin nombre'}</p>
              <div className="flex items-center gap-2">
                <a href={`https://wa.me/${activa.cliente?.telefono}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-commerk-green hover:underline">{activa.cliente?.telefono}</a>
                <span className={`w-2 h-2 rounded-full ${ESTADO_COLORS[activa.estado] || 'bg-slate-300'}`} />
                <span className="text-xs text-slate-400 capitalize">{activa.estado}</span>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs text-slate-400">{mensajes.length} msgs</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <a href={`https://wa.me/${activa.cliente?.telefono}`} target="_blank" rel="noopener noreferrer"
                className="p-2 rounded-xl hover:bg-slate-100 transition-colors" title="Abrir en WhatsApp">
                <svg className="w-5 h-5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </a>
              <button onClick={() => setMostrarDetalle(!mostrarDetalle)}
                className={`p-2 rounded-xl hover:bg-slate-100 transition-colors ${mostrarDetalle ? 'bg-slate-100 text-commerk-navy' : 'text-slate-400'}`}
                title="Info del cliente">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Mensajes */}
            <div
              className="flex-1 overflow-y-auto px-5 py-4"
              style={{ background: 'linear-gradient(135deg, #f8fafc 25%, #f1f5f9 100%)' }}
            >
              {cargandoMsgs ? (
                <div className="flex justify-center items-center h-32">
                  <div className="w-6 h-6 border-2 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
                </div>
              ) : mensajesConFecha.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-sm">Sin mensajes aún</p>
                </div>
              ) : mensajesConFecha.map((item) => {
                if ('_tipo' in item) return <SeparadorFecha key={item._id} fecha={item.fecha} />;
                return <MensajeBurbuja key={item.id} msg={item} />;
              })}
              <div ref={mensajesEndRef} />
            </div>

            {/* Panel info cliente */}
            {mostrarDetalle && (
              <div className="w-60 bg-white border-l border-slate-100 p-4 overflow-y-auto shrink-0">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Info del cliente</h3>
                <div className="flex flex-col items-center mb-4">
                  <div className="w-14 h-14 rounded-full bg-commerk-navy/10 flex items-center justify-center text-commerk-navy font-bold text-xl mb-2">
                    {iniciales(activa.cliente?.nombre)}
                  </div>
                  <p className="font-bold text-slate-800 text-sm text-center">{activa.cliente?.nombre || 'Sin nombre'}</p>
                </div>
                <div className="space-y-3">
                  {[
                    { l: 'Teléfono', v: activa.cliente?.telefono, link: `https://wa.me/${activa.cliente?.telefono}` },
                    { l: 'Email', v: activa.cliente?.email },
                    { l: 'Ciudad', v: activa.cliente?.ciudad },
                    { l: 'Estado conv.', v: activa.estado },
                    { l: 'Mensajes', v: `${mensajes.length}` },
                    { l: 'Inicio', v: fmtFechaCompleta(activa.created_at) },
                  ].filter((x) => x.v).map((x) => (
                    <div key={x.l}>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">{x.l}</p>
                      {x.link
                        ? <a href={x.link} target="_blank" rel="noopener noreferrer" className="text-xs text-commerk-green hover:underline">{x.v}</a>
                        : <p className="text-xs text-slate-700 break-all">{x.v}</p>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input respuesta */}
          <div className="bg-white border-t border-slate-100 px-4 py-3 shrink-0">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <textarea
                  ref={inputRef}
                  value={textoRespuesta}
                  onChange={(e) => {
                    setTextoRespuesta(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Escribe un mensaje… (Enter envía · Shift+Enter nueva línea)"
                  rows={1}
                  className="w-full px-4 py-3 text-sm border border-slate-200 rounded-2xl resize-none focus:outline-none focus:border-commerk-navy/40 focus:ring-2 focus:ring-commerk-navy/10 max-h-32 overflow-y-auto bg-slate-50"
                />
              </div>
              <button
                onClick={enviarRespuesta}
                disabled={!textoRespuesta.trim() || enviando}
                className="w-11 h-11 rounded-2xl bg-commerk-navy text-white flex items-center justify-center hover:bg-commerk-navy/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-sm"
              >
                {enviando
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                }
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 px-1">
              Enviando a {activa.cliente?.telefono} por WhatsApp
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 hidden lg:flex flex-col items-center justify-center text-slate-400 bg-slate-50">
          <div className="w-20 h-20 rounded-full bg-white shadow flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-500">Selecciona una conversación</p>
          <p className="text-xs text-slate-400 mt-1">Las conversaciones de WhatsApp aparecen aquí en tiempo real</p>
        </div>
      )}

      {mostrarModal && (
        <ModalNuevaConversacion
          onClose={() => setMostrarModal(false)}
          onCreada={onConversacionCreada}
        />
      )}
    </div>
  );
}
