'use client';

// Columna izquierda del chat center: bandejas de atención y lista de conversaciones
import { ETIQUETAS, iniciales, fmtHora, mostrarContacto, type Conversacion } from './base';

export type BandejaId = 'pendientes' | 'mias' | 'bot' | 'todas';

export const MOTIVOS: Record<string, string> = {
  cliente_pidio_asesor: 'Pidió un asesor',
  mayorista: 'Por mayor',
  pago: 'Ayuda con el pago',
  sofi: 'Sofi no pudo resolver',
  manual: 'Tomada por un asesor',
  frustracion: 'Cliente molesto',
};

/** Minutos de espera → texto y color según urgencia. */
export function tiempoEspera(desde: string | null | undefined, ahora: number) {
  if (!desde) return null;
  const min = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 60000));
  const texto = min < 1 ? 'recién' : min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.floor(min / 1440)} d`;
  const cls = min < 5 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : min < 15 ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-red-50 text-red-600 border-red-200';
  return { min, texto, cls };
}

function vistaPrevia(conv: Conversacion): string {
  const u = conv.ultimo_mensaje;
  if (!u) return 'Sin mensajes';
  const quien = u.tipo === 'user' ? '' : u.enviado_por === 'agente' ? 'Asesor: ' : 'Sofi: ';
  const cuerpo = u.tipo_wa === 'image' ? '📷 Imagen'
    : u.tipo_wa === 'audio' ? '🎤 Nota de voz'
    : u.tipo_wa === 'video' ? '🎥 Video'
    : u.tipo_wa === 'document' ? '📄 Documento'
    : u.tipo_wa === 'template' ? '📤 Plantilla enviada'
    : (u.contenido || '');
  return (quien + cuerpo).replace(/\s+/g, ' ');
}

export function Bandeja(props: {
  conversaciones: Conversacion[];
  activaId: string | null;
  bandeja: BandejaId;
  onBandeja: (b: BandejaId) => void;
  contadores: { pendientes: number | null; mias: number | null };
  busqueda: string;
  onBusqueda: (q: string) => void;
  filtroEtiqueta: string;
  onFiltroEtiqueta: (e: string) => void;
  onSeleccionar: (c: Conversacion) => void;
  onNueva: () => void;
  cargando: boolean;
  noLeidos: Record<string, number>;
  ahora: number;
}) {
  const pestañas: { id: BandejaId; label: string; contador?: number | null; alerta?: boolean }[] = [
    { id: 'pendientes', label: 'Pendientes', contador: props.contadores.pendientes, alerta: !!props.contadores.pendientes },
    { id: 'mias', label: 'Mías', contador: props.contadores.mias },
    { id: 'bot', label: 'Bot' },
    { id: 'todas', label: 'Todas' },
  ];

  return (
    <>
      <div className="p-4 border-b border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-commerk-navy leading-tight">Bandeja de atención</h2>
            <p className="text-[11px] text-slate-400">WhatsApp · Tienda Commerk</p>
          </div>
          <button
            onClick={props.onNueva}
            className="h-8 px-3 rounded-xl bg-commerk-navy text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-commerk-navy/90 transition-colors shadow-sm"
            title="Escribirle a un cliente"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            Nueva
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-xl">
          {pestañas.map((p) => (
            <button key={p.id} onClick={() => props.onBandeja(p.id)}
              className={`relative py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                props.bandeja === p.id ? 'bg-white text-commerk-navy shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {p.label}
              {!!p.contador && (
                <span className={`absolute -top-1.5 -right-1 inline-flex min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold items-center justify-center ring-2 ring-slate-100 ${
                  p.alerta ? 'bg-red-500 text-white' : 'bg-commerk-navy/10 text-commerk-navy'
                }`}>{p.contador > 99 ? '99+' : p.contador}</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={props.busqueda} onChange={(e) => props.onBusqueda(e.target.value)}
            placeholder="Buscar cliente, teléfono o mensaje…"
            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-commerk-navy/40 focus:bg-white" />
        </div>

        <div className="flex gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {[['', { label: 'Todas', emoji: '🏷️', cls: '' }] as const,
            ['empresarial', ETIQUETAS.empresarial] as const,
            ...Object.entries(ETIQUETAS).filter(([k]) => k !== 'empresarial')].map(([k, e]) => (
            <button key={k || 'todas'} onClick={() => props.onFiltroEtiqueta(k)}
              className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                props.filtroEtiqueta === k
                  ? (k ? e.cls : 'bg-commerk-navy text-white border-commerk-navy')
                  : 'border-slate-200 text-slate-500 hover:bg-slate-100'
              }`}>{e.emoji} {e.label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {props.cargando && props.conversaciones.length === 0 ? (
          <div className="flex justify-center items-center h-24">
            <div className="w-5 h-5 border-2 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" />
          </div>
        ) : props.conversaciones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-xl mb-2">
              {props.bandeja === 'pendientes' ? '✅' : '💬'}
            </div>
            <p className="text-sm font-semibold text-slate-600">
              {props.bandeja === 'pendientes' ? 'Nadie está esperando' : props.bandeja === 'mias' ? 'No tienes conversaciones asignadas' : 'Sin conversaciones'}
            </p>
            {props.bandeja === 'pendientes' && <p className="text-xs text-slate-400 mt-1">Cuando el bot pase un cliente a un asesor, aparecerá aquí.</p>}
          </div>
        ) : props.conversaciones.map((conv) => {
          const activa = props.activaId === conv.id;
          const nombre = conv.cliente?.nombre || mostrarContacto(conv.cliente) || 'Cliente';
          const noLeidos = props.noLeidos[conv.id] || 0;
          const etiq = conv.etiqueta ? ETIQUETAS[conv.etiqueta] : null;
          const espera = conv.estado_atencion === 'pendiente' ? tiempoEspera(conv.pendiente_desde || conv.updated_at, props.ahora) : null;
          return (
            <button key={conv.id} onClick={() => props.onSeleccionar(conv)}
              className={`w-full flex items-start gap-3 pl-[13px] pr-4 py-3 text-left transition-colors border-b border-slate-50 border-l-[3px] ${
                activa ? 'bg-commerk-navy/[0.06] border-l-commerk-navy' : 'border-l-transparent hover:bg-slate-50'
              }`}>
              <div className="relative shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                  conv.estado_atencion === 'pendiente' ? 'bg-red-50 text-red-600 ring-2 ring-red-200'
                  : conv.estado_atencion === 'en_atencion' ? 'bg-amber-50 text-amber-700'
                  : 'bg-commerk-navy/10 text-commerk-navy'
                }`}>{iniciales(conv.cliente?.nombre)}</div>
                {conv.esperando_respuesta && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white" title="El cliente espera respuesta" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm truncate ${noLeidos ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{nombre}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    {noLeidos > 0 && !activa && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-commerk-green text-white text-[10px] font-bold flex items-center justify-center">{noLeidos > 9 ? '9+' : noLeidos}</span>
                    )}
                    {conv.ultimo_mensaje && <span className="text-[10px] text-slate-400">{fmtHora(conv.ultimo_mensaje.created_at)}</span>}
                  </div>
                </div>
                <p className={`text-xs truncate mt-0.5 ${noLeidos ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>{vistaPrevia(conv)}</p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {espera && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${espera.cls}`}>⏱ {espera.texto}</span>
                  )}
                  {conv.estado_atencion === 'pendiente' && conv.motivo_transferencia && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{MOTIVOS[conv.motivo_transferencia] || conv.motivo_transferencia}</span>
                  )}
                  {conv.estado_atencion === 'en_atencion' && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">👤 {conv.asignado_nombre || 'Asesor'}</span>
                  )}
                  {conv.estado_atencion === 'bot' && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">🤖 Sofi</span>
                  )}
                  {etiq && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${etiq.cls}`}>{etiq.emoji} {etiq.label}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-slate-100 text-center">
        <p className="text-[11px] text-slate-400">{props.conversaciones.length} conversaciones</p>
      </div>
    </>
  );
}
