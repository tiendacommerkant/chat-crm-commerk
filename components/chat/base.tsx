// Piezas del chat center: tipos, formato y burbujas de mensaje
'use client';

import { useEffect, useState, useRef } from 'react';
import { esIdUsuarioWhatsApp, contactoVisible } from '@/lib/whatsapp-id';

// ─── Types ────────────────────────────────────────────────────────────────────
export type Cliente = { id: string; nombre?: string; telefono: string; email?: string; ciudad?: string; wa_username?: string | null };

// Clientes que usan nombre de usuario de WhatsApp no tienen número: se muestra
// su @usuario y no se arma un enlace wa.me (quedaría roto).
export const mostrarContacto = (c?: Cliente | null) =>
  !c?.telefono ? '' : esIdUsuarioWhatsApp(c.telefono) ? contactoVisible(c.telefono, c.wa_username) : c.telefono;
export const enlaceWhatsApp = (c?: Cliente | null) =>
  c?.telefono && !esIdUsuarioWhatsApp(c.telefono) ? `https://wa.me/${c.telefono}` : undefined;
export type UltimoMensaje = { contenido: string; tipo: string; tipo_wa: string; enviado_por?: string | null; created_at: string };
export type Conversacion = {
  id: string; estado: string; created_at: string; updated_at: string;
  cliente: Cliente; ultimo_mensaje: UltimoMensaje | null;
  bot_activo?: boolean;
  etiqueta?: string | null;
  estado_atencion?: 'bot' | 'pendiente' | 'en_atencion';
  asignado_a?: string | null;
  asignado_nombre?: string | null;
  pendiente_desde?: string | null;
  motivo_transferencia?: string | null;
  esperando_respuesta?: boolean;
};
export type Mensaje = {
  id: string; conversacion_id: string; tipo: 'user' | 'bot';
  contenido: string; created_at: string;
  metadata?: {
    tipo_wa?: string; media_url?: string; media_id?: string; media_mime_type?: string;
    caption?: string; filename?: string; plantilla?: string; referencia_id?: string;
    estado_envio?: string; enviado_por?: string; whatsapp_message_id?: string;
    asesor?: string; asesor_nombre?: string; error_wa?: string;
    interactive_title?: string; error?: string; latitude?: number; longitude?: number;
    estado_wa?: 'sent' | 'delivered' | 'read' | 'failed';
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function iniciales(nombre?: string) {
  if (!nombre?.trim()) return '?';
  // Por caracteres completos: w[0] partía los emojis por la mitad y salía "�"
  const palabras = nombre.trim().split(/\s+/);
  const letras = palabras.map((w) => Array.from(w).find((c) => /\p{L}|\p{N}/u.test(c)) || '').filter(Boolean);
  if (letras.length) return letras.slice(0, 2).join('').toUpperCase();
  // Nombre hecho solo de emojis ("🥰"): se muestra el primero
  return Array.from(palabras[0])[0] || '?';
}

export const TZ = 'America/Bogota';

export function fmtHora(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'ahora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  if (diff < 604800000) return d.toLocaleDateString('es-CO', { weekday: 'short', timeZone: TZ });
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: TZ });
}

export function fmtFechaCompleta(iso: string) {
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: TZ,
  });
}

const PLANTILLA_LABELS: Record<string, string> = {
  confirmacion_pago: '✅ Confirmación de pago',
  recordatorio_pago: '⏰ Recordatorio de pago',
  carrito_abandonado: '🛒 Recuperación de carrito',
  pedido_en_camino: '🚚 Pedido en camino',
  pedido_recoger_sede: '🏬 Pedido para recoger',
  lead_mayorista: '🏪 Lead mayorista',
  pedido_confirmado: '🎉 Pedido confirmado',
  pedido_cancelado: '❌ Pedido cancelado',
  pedido_enviado: '🚚 Pedido enviado',
};


export const ETIQUETAS: Record<string, { label: string; emoji: string; cls: string }> = {
  compro:       { label: 'Compró',       emoji: '💰', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  notificado:   { label: 'Notificado',   emoji: '📤', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  cerro_venta:  { label: 'Cerró venta',  emoji: '✅', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  perdido:      { label: 'Perdido',      emoji: '❌', cls: 'bg-red-100 text-red-600 border-red-200' },
  mayorista:    { label: 'Mayorista',    emoji: '🏪', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  empresarial:  { label: 'Empresa',      emoji: '🏢', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
};


// ─── Audio Player ─────────────────────────────────────────────────────────────
function AudioPlayer({ src }: { src: string }) {
  return (
    <audio controls className="max-w-[220px] h-10 rounded-full" preload="none">
      <source src={src} />
    </audio>
  );
}

// ─── Chulitos estilo WhatsApp ─────────────────────────────────────────────────
function ChecksWA({ estado }: { estado?: string }) {
  // 1 chulito gris = enviado al API
  // 2 chulitos grises = entregado al dispositivo
  // 2 chulitos azules = leído por el destinatario
  const leido = estado === 'read';
  const entregado = estado === 'delivered' || leido;
  const color = leido ? '#53bdeb' : 'rgba(255,255,255,0.6)';

  if (!entregado) {
    // 1 solo chulito
    return (
      <svg viewBox="0 0 16 11" width="14" height="11" fill="none">
        <path d="M11.071.653 4.42 7.3 1.943 4.822" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // 2 chulitos
  return (
    <svg viewBox="0 0 18 11" width="16" height="11" fill="none">
      <path d="M1 5.5 5.5 10 17 1" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 5.5 9.5 10 17 3" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Burbuja de mensaje ───────────────────────────────────────────────────────
export function MensajeBurbuja({ msg }: { msg: Mensaje }) {
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
          <p className="text-[10px] text-white/80 font-semibold mb-0.5 tracking-wide">
            {msg.metadata?.asesor_nombre || 'Asesor'}
          </p>
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

        <p className={`text-[10px] mt-1 text-right flex items-center justify-end gap-1 ${esUser ? 'text-slate-400' : 'text-white/50'}`}>
          {fmtFechaCompleta(msg.created_at)}
          {!esUser && msg.metadata?.whatsapp_message_id && (
            <ChecksWA estado={msg.metadata?.estado_wa} />
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Modal Nueva Conversación ─────────────────────────────────────────────────
export function ModalNuevaConversacion({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: (convId: string, aviso?: string) => void;
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
      } else if (json.conversacion_id) {
        // Pasaron 24 h: se abre la conversación para enviar una plantilla
        onCreada(json.conversacion_id, json.error);
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
                        <p className="text-xs text-slate-400">{mostrarContacto(c)}</p>
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
                <p className="text-xs text-commerk-green">{mostrarContacto(clienteSeleccionado)}</p>
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

export function SeparadorFecha({ fecha }: { fecha: string }) {
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

