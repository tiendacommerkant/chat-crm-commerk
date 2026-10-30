'use client';

// Chat center: bandeja de atención (izquierda), chat (centro) y ficha del cliente (derecha)
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  ETIQUETAS, iniciales, mostrarContacto, enlaceWhatsApp, fmtFechaCompleta,
  MensajeBurbuja, ModalNuevaConversacion, SeparadorFecha,
  type Conversacion, type Mensaje,
} from '@/components/chat/base';
import { Bandeja, MOTIVOS, tiempoEspera, type BandejaId } from '@/components/chat/Bandeja';
import { Compositor, type RespuestaRapida } from '@/components/chat/Compositor';
import { FichaCliente, type Ficha, type Usuario } from '@/components/chat/FichaCliente';
import { ModalPlantilla } from '@/components/chat/ModalPlantilla';
import { ModalRespuestas } from '@/components/chat/ModalRespuestas';

type Nota = { id: string; conversacion_id: string; autor: string; autor_nombre?: string | null; contenido: string; created_at: string };

// Aviso sonoro corto (sin archivos): dos tonos al llegar un cliente a Pendientes
function sonarAviso() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i ? 880 : 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.17);
    });
  } catch { /* el navegador bloqueó el audio */ }
}

function leerPreferencia(clave: string, porDefecto: string) {
  try { return localStorage.getItem(clave) || porDefecto; } catch { return porDefecto; }
}
function guardarPreferencia(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

export default function ConversacionesPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="w-8 h-8 border-4 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" /></div>}>
      <ChatCenter />
    </Suspense>
  );
}

function ChatCenter() {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [contadores, setContadores] = useState<{ pendientes: number | null; mias: number | null }>({ pendientes: null, mias: null });
  const [bandeja, setBandejaState] = useState<BandejaId>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [filtroEtiqueta, setFiltroEtiqueta] = useState('');
  const [cargandoConvs, setCargandoConvs] = useState(true);
  const [activa, setActiva] = useState<Conversacion | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [cargandoMsgs, setCargandoMsgs] = useState(false);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [mostrarFicha, setMostrarFicha] = useState(true);
  // Ficha como panel encima del chat en pantallas angostas (no se guarda como preferencia)
  const [fichaMovil, setFichaMovil] = useState(false);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [yo, setYo] = useState<Usuario | null>(null);
  const [respuestas, setRespuestas] = useState<RespuestaRapida[]>([]);
  const [respuestasEditables, setRespuestasEditables] = useState(false);
  const [noLeidos, setNoLeidos] = useState<Record<string, number>>({});
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [mostrarPlantilla, setMostrarPlantilla] = useState(false);
  const [mostrarRespuestas, setMostrarRespuestas] = useState(false);
  const [mostrarEtiquetas, setMostrarEtiquetas] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ahora, setAhora] = useState(() => Date.now());

  const searchParams = useSearchParams();
  const clienteIdParam = searchParams.get('cliente');
  const finChatRef = useRef<HTMLDivElement>(null);
  const pendientesPrevios = useRef<number | null>(null);
  const activaRef = useRef<Conversacion | null>(null);
  activaRef.current = activa;

  // Bandeja recordada por asesor
  useEffect(() => { setBandejaState(leerPreferencia('crm_bandeja', 'todas') as BandejaId); }, []);
  const setBandeja = (b: BandejaId) => { setBandejaState(b); guardarPreferencia('crm_bandeja', b); };

  // Reloj para los tiempos de espera
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const cargarConversaciones = useCallback(async () => {
    try {
      const params = new URLSearchParams({ bandeja });
      if (filtroEtiqueta) params.set('etiqueta', filtroEtiqueta);
      if (busqueda) params.set('q', busqueda);
      const res = await fetch(`/api/conversaciones?${params}`);
      const json = await res.json();
      if (!json.success) return;
      setConversaciones(json.conversaciones);
      setContadores(json.contadores || { pendientes: null, mias: null });
      if (json.yo) setYo(json.yo);
      // La conversación abierta se actualiza con su estado más reciente
      const abierta = activaRef.current && json.conversaciones.find((c: Conversacion) => c.id === activaRef.current!.id);
      if (abierta) setActiva((prev) => (prev ? { ...prev, ...abierta } : prev));

      // Alerta: llegó alguien nuevo a Pendientes
      const p = json.contadores?.pendientes;
      if (typeof p === 'number') {
        if (pendientesPrevios.current !== null && p > pendientesPrevios.current) {
          sonarAviso();
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🙋 Cliente esperando asesor', { body: 'Hay una conversación nueva en Pendientes', icon: '/logos_favicon.png' });
          }
        }
        pendientesPrevios.current = p;
        document.title = p > 0 ? `(${p}) Pendientes · CRM Commerk` : 'CRM Commerk';
      }
    } finally {
      setCargandoConvs(false);
    }
  }, [bandeja, filtroEtiqueta, busqueda]);

  useEffect(() => { setCargandoConvs(true); cargarConversaciones(); }, [cargarConversaciones]);
  // Respaldo del tiempo real: los contadores se refrescan solos
  useEffect(() => { const t = setInterval(cargarConversaciones, 20_000); return () => clearInterval(t); }, [cargarConversaciones]);
  useEffect(() => () => { document.title = 'CRM Commerk'; }, []);

  const cargarRespuestas = useCallback(async () => {
    const j = await fetch('/api/respuestas-rapidas').then((r) => r.json()).catch(() => null);
    if (j?.success) { setRespuestas(j.respuestas); setRespuestasEditables(!!j.editable); }
  }, []);

  useEffect(() => {
    cargarRespuestas();
    fetch('/api/usuarios').then((r) => r.json()).then((j) => {
      if (j.success) { setUsuarios(j.usuarios); if (j.yo) setYo(j.yo); }
    }).catch(() => {});
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    setMostrarFicha(leerPreferencia('crm_ficha', '1') === '1');
  }, [cargarRespuestas]);

  const cargarMensajes = useCallback(async (id: string) => {
    const [m, n] = await Promise.all([
      fetch(`/api/conversaciones/${id}/messages`).then((r) => r.json()).catch(() => null),
      fetch(`/api/conversaciones/${id}/notas`).then((r) => r.json()).catch(() => null),
    ]);
    if (activaRef.current?.id !== id) return;
    if (m?.success) setMensajes(m.mensajes);
    setNotas(n?.notas || []);
  }, []);

  const cargarFicha = useCallback(async (id: string) => {
    setCargandoFicha(true);
    const j = await fetch(`/api/conversaciones/${id}/ficha`).then((r) => r.json()).catch(() => null);
    if (activaRef.current?.id === id) setFicha(j?.success ? j : null);
    setCargandoFicha(false);
  }, []);

  const seleccionar = useCallback((c: Conversacion) => {
    setActiva(c);
    setMensajes([]); setNotas([]); setFicha(null); setAviso('');
    setMostrarEtiquetas(false);
    setFichaMovil(false);
    setNoLeidos((prev) => ({ ...prev, [c.id]: 0 }));
  }, []);

  useEffect(() => {
    if (!activa?.id) return;
    setCargandoMsgs(true);
    Promise.all([cargarMensajes(activa.id), cargarFicha(activa.id)]).finally(() => setCargandoMsgs(false));
    // Solo al cambiar de conversación
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa?.id]);

  useEffect(() => { finChatRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensajes.length, notas.length]);

  // ?cliente= en la URL abre su conversación
  useEffect(() => {
    if (!clienteIdParam || conversaciones.length === 0 || activa) return;
    const c = conversaciones.find((x) => x.cliente?.id === clienteIdParam);
    if (c) seleccionar(c);
  }, [clienteIdParam, conversaciones, activa, seleccionar]);

  // Tiempo real: mensajes nuevos de cualquier conversación
  useEffect(() => {
    const canal = supabase
      .channel('mensajes-chat-center')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, (payload) => {
        const msg = payload.new as Mensaje;
        const abierta = activaRef.current;
        if (abierta && msg.conversacion_id === abierta.id) {
          setMensajes((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.tipo === 'user') cargarFicha(abierta.id);
        }
        if (msg.tipo === 'user') {
          const otra = !abierta || msg.conversacion_id !== abierta.id;
          if (otra) setNoLeidos((prev) => ({ ...prev, [msg.conversacion_id]: (prev[msg.conversacion_id] || 0) + 1 }));
          if ((otra || document.hidden) && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('💬 Nuevo mensaje', { body: msg.contenido?.slice(0, 100) || 'Nuevo mensaje', icon: '/logos_favicon.png' });
          }
        }
        cargarConversaciones();
      })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [cargarConversaciones, cargarFicha]);

  const refrescarTodo = useCallback(() => {
    if (activaRef.current) { cargarMensajes(activaRef.current.id); cargarFicha(activaRef.current.id); }
    cargarConversaciones();
  }, [cargarMensajes, cargarFicha, cargarConversaciones]);

  const accionAtencion = async (body: Record<string, any>) => {
    if (!activa) return;
    const res = await fetch(`/api/conversaciones/${activa.id}/atencion`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => null);
    if (!res?.success) setAviso(res?.error || 'No se pudo actualizar la atención');
    else if (body.accion === 'devolver_bot') setAviso(res.encuesta ? '✅ Caso resuelto. Se le envió al cliente la encuesta de satisfacción.' : '✅ Caso resuelto. Sofi vuelve a atender esta conversación.');
    refrescarTodo();
  };

  const guardarNota = async (contenido: string) => {
    if (!activa) return false;
    const res = await fetch(`/api/conversaciones/${activa.id}/notas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contenido }),
    }).then((r) => r.json()).catch(() => null);
    if (res?.success) { setNotas((prev) => [...prev, res.nota]); return true; }
    setAviso(res?.error || 'No se pudo guardar la nota');
    return false;
  };

  const guardarEtiqueta = async (etiqueta: string | null) => {
    if (!activa) return;
    setMostrarEtiquetas(false);
    setActiva({ ...activa, etiqueta });
    await fetch(`/api/conversaciones/${activa.id}/etiqueta`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ etiqueta }),
    });
    cargarConversaciones();
  };

  const onConversacionCreada = async (id: string, avisoEnvio?: string) => {
    setMostrarNueva(false);
    setBandeja('todas');
    const res = await fetch('/api/conversaciones?bandeja=todas').then((r) => r.json()).catch(() => null);
    const c = res?.conversaciones?.find((x: Conversacion) => x.id === id);
    if (c) {
      seleccionar(c);
      if (avisoEnvio) { setAviso(avisoEnvio); setMostrarPlantilla(true); }
    }
  };

  const toggleFicha = () => {
    if (!window.matchMedia('(min-width: 1280px)').matches) { setFichaMovil((v) => !v); return; }
    const v = !mostrarFicha; setMostrarFicha(v); guardarPreferencia('crm_ficha', v ? '1' : '0');
  };

  // Mensajes y notas internas en una sola línea de tiempo
  type Item = { k: 'msg'; m: Mensaje } | { k: 'nota'; n: Nota } | { k: 'fecha'; f: string; id: string };
  const linea: Item[] = [];
  const eventos = [
    ...mensajes.map((m) => ({ t: m.created_at, item: { k: 'msg', m } as Item })),
    ...notas.map((n) => ({ t: n.created_at, item: { k: 'nota', n } as Item })),
  ].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  eventos.forEach((e, i) => {
    const prev = eventos[i - 1];
    if (!prev || new Date(e.t).toDateString() !== new Date(prev.t).toDateString()) linea.push({ k: 'fecha', f: e.t, id: `f${i}` });
    linea.push(e.item);
  });

  const estadoAtencion = activa?.estado_atencion || (activa?.bot_activo === false ? 'en_atencion' : 'bot');
  const esperaActiva = estadoAtencion === 'pendiente' ? tiempoEspera(activa?.pendiente_desde, ahora) : null;
  const puedeTomar = estadoAtencion !== 'en_atencion' || activa?.asignado_a !== yo?.email;
  const puedeDevolver = estadoAtencion !== 'bot';

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden">
      {/* Bandeja */}
      <aside className={`w-full md:w-[340px] bg-white border-r border-slate-100 flex-col shrink-0 ${activa ? 'hidden md:flex' : 'flex'}`}>
        <Bandeja
          conversaciones={conversaciones}
          activaId={activa?.id || null}
          bandeja={bandeja}
          onBandeja={setBandeja}
          contadores={contadores}
          busqueda={busqueda}
          onBusqueda={setBusqueda}
          filtroEtiqueta={filtroEtiqueta}
          onFiltroEtiqueta={setFiltroEtiqueta}
          onSeleccionar={seleccionar}
          onNueva={() => setMostrarNueva(true)}
          cargando={cargandoConvs}
          noLeidos={noLeidos}
          ahora={ahora}
        />
      </aside>

      {activa ? (
        <div className="flex-1 flex min-w-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0">
            {/* Encabezado del chat */}
            <div className="bg-white border-b border-slate-100 px-4 py-2.5 flex items-center gap-3 shrink-0">
              <button onClick={() => setActiva(null)} className="md:hidden p-1.5 rounded-xl hover:bg-slate-100 text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              </button>
              <div className="w-9 h-9 rounded-full bg-commerk-navy/10 flex items-center justify-center text-commerk-navy font-bold text-sm shrink-0">{iniciales(activa.cliente?.nombre)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{activa.cliente?.nombre || 'Sin nombre'}</p>
                <div className="flex items-center gap-2 text-xs min-w-0 overflow-hidden whitespace-nowrap">
                  <span className="text-commerk-green shrink-0">{mostrarContacto(activa.cliente)}</span>
                  <span className="text-slate-300">·</span>
                  {estadoAtencion === 'pendiente' && <span className="font-semibold text-red-600">Esperando asesor{esperaActiva ? ` · ${esperaActiva.texto}` : ''}{activa.motivo_transferencia ? ` · ${MOTIVOS[activa.motivo_transferencia] || ''}` : ''}</span>}
                  {estadoAtencion === 'en_atencion' && <span className="font-semibold text-amber-700">👤 {activa.asignado_a === yo?.email ? 'La atiendes tú' : activa.asignado_nombre || 'Asesor'}</span>}
                  {estadoAtencion === 'bot' && <span className="font-semibold text-emerald-700">🤖 Sofi responde</span>}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {puedeTomar && (
                  <button onClick={() => accionAtencion({ accion: 'tomar' })}
                    className="hidden sm:inline-flex px-3 py-1.5 rounded-xl bg-commerk-navy text-white text-xs font-semibold hover:bg-commerk-navy/90">
                    Tomar conversación
                  </button>
                )}
                {puedeDevolver && (
                  <button onClick={() => accionAtencion({ accion: 'devolver_bot' })}
                    className="hidden sm:inline-flex px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100"
                    title="El caso quedó resuelto: Sofi vuelve a responder">
                    ✓ Resuelto · devolver a Sofi
                  </button>
                )}
                <div className="relative">
                  <button onClick={() => setMostrarEtiquetas(!mostrarEtiquetas)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border ${activa.etiqueta && ETIQUETAS[activa.etiqueta] ? ETIQUETAS[activa.etiqueta].cls : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                    {activa.etiqueta && ETIQUETAS[activa.etiqueta] ? `${ETIQUETAS[activa.etiqueta].emoji} ${ETIQUETAS[activa.etiqueta].label}` : '🏷️'}
                  </button>
                  {mostrarEtiquetas && (
                    <div className="absolute right-0 top-full mt-1 z-30 bg-white rounded-xl shadow-xl border border-slate-100 py-1 min-w-[170px]">
                      {Object.entries(ETIQUETAS).map(([k, e]) => (
                        <button key={k} onClick={() => guardarEtiqueta(k)} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-left">
                          <span>{e.emoji}</span>{e.label}{activa.etiqueta === k && <span className="ml-auto text-commerk-green">✓</span>}
                        </button>
                      ))}
                      {activa.etiqueta && <button onClick={() => guardarEtiqueta(null)} className="w-full px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 border-t border-slate-100 text-left">Quitar etiqueta</button>}
                    </div>
                  )}
                </div>
                {enlaceWhatsApp(activa.cliente) && (
                  <a href={enlaceWhatsApp(activa.cliente)} target="_blank" rel="noopener noreferrer" className="p-2 rounded-xl hover:bg-slate-100" title="Abrir en WhatsApp">
                    <svg className="w-5 h-5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.03c-.25.69-1.44 1.32-1.99 1.4-.51.08-1.15.11-1.86-.12-.43-.13-.98-.32-1.69-.62-2.97-1.28-4.91-4.27-5.06-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.6-.37.79-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.84 2.06.92 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.45.52-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.38 1.47.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.74.82 2.04.97.3.15.5.22.57.35.07.12.07.72-.18 1.41z" /></svg>
                  </a>
                )}
                <button onClick={toggleFicha} className={`p-2 rounded-xl hover:bg-slate-100 ${mostrarFicha ? 'text-commerk-navy bg-slate-100' : 'text-slate-400'}`} title="Ficha del cliente">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                </button>
              </div>
            </div>

            {(puedeTomar || puedeDevolver) && (
              <div className="sm:hidden bg-white border-b border-slate-100 px-3 py-2 flex gap-2 shrink-0">
                {puedeTomar && (
                  <button onClick={() => accionAtencion({ accion: 'tomar' })}
                    className="flex-1 py-2 rounded-xl bg-commerk-navy text-white text-xs font-semibold">
                    Tomar conversación
                  </button>
                )}
                {puedeDevolver && (
                  <button onClick={() => accionAtencion({ accion: 'devolver_bot' })}
                    className="flex-1 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold">
                    ✓ Resuelto · a Sofi
                  </button>
                )}
              </div>
            )}

            {aviso && (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-xs text-amber-800">
                <span>⚠️</span><span className="flex-1">{aviso}</span>
                <button onClick={() => setAviso('')} className="text-amber-600 hover:text-amber-800">✕</button>
              </div>
            )}

            {/* Mensajes y notas */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4" style={{ background: 'linear-gradient(135deg, #f8fafc 25%, #f1f5f9 100%)' }}>
              {cargandoMsgs && mensajes.length === 0 ? (
                <div className="flex justify-center items-center h-32"><div className="w-6 h-6 border-2 border-commerk-navy/20 border-t-commerk-navy rounded-full animate-spin" /></div>
              ) : linea.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm">Sin mensajes aún</div>
              ) : linea.map((it) => {
                if (it.k === 'fecha') return <SeparadorFecha key={it.id} fecha={it.f} />;
                if (it.k === 'msg') return <MensajeBurbuja key={it.m.id} msg={it.m} />;
                return (
                  <div key={it.n.id} className="flex justify-center my-2">
                    <div className="max-w-[80%] rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-sm">
                      <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">🔒 Nota interna · {it.n.autor_nombre || it.n.autor}</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap mt-0.5">{it.n.contenido}</p>
                      <p className="text-[10px] text-amber-600/70 mt-1 text-right">{fmtFechaCompleta(it.n.created_at)}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={finChatRef} />
            </div>

            <Compositor
              conversacionId={activa.id}
              ventanaAbierta={ficha ? ficha.ventana.abierta : null}
              cierraEn={ficha?.ventana.cierra_en || null}
              respuestas={respuestas}
              onGestionarRespuestas={() => setMostrarRespuestas(true)}
              onAbrirPlantilla={() => setMostrarPlantilla(true)}
              onEnviado={refrescarTodo}
              onNota={guardarNota}
              estadoAtencion={estadoAtencion}
            />
          </div>

          {mostrarFicha && (
            <aside className="hidden xl:block w-[320px] bg-white border-l border-slate-100 shrink-0">
              <FichaCliente
                ficha={ficha}
                cargando={cargandoFicha}
                usuarios={usuarios}
                yo={yo}
                ahora={ahora}
                onTomar={() => accionAtencion({ accion: 'tomar' })}
                onDevolverBot={() => accionAtencion({ accion: 'devolver_bot' })}
                onAsignar={(u) => accionAtencion({ accion: 'asignar', email: u.email, nombre: u.nombre })}
                onCerrar={toggleFicha}
              />
            </aside>
          )}

          {fichaMovil && (
            <div className="xl:hidden fixed inset-0 z-40 flex justify-end bg-commerk-navy-dark/50" onClick={() => setFichaMovil(false)}>
              <aside className="w-full max-w-sm h-full bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <FichaCliente
                  ficha={ficha}
                  cargando={cargandoFicha}
                  usuarios={usuarios}
                  yo={yo}
                  ahora={ahora}
                  onTomar={() => accionAtencion({ accion: 'tomar' })}
                  onDevolverBot={() => accionAtencion({ accion: 'devolver_bot' })}
                  onAsignar={(u) => accionAtencion({ accion: 'asignar', email: u.email, nombre: u.nombre })}
                  onCerrar={() => setFichaMovil(false)}
                />
              </aside>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 hidden md:flex flex-col items-center justify-center text-center bg-slate-50 px-6">
          <div className="w-20 h-20 rounded-full bg-white shadow flex items-center justify-center mb-4 text-3xl">💬</div>
          <p className="text-sm font-semibold text-slate-600">Selecciona una conversación</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            {contadores.pendientes
              ? `Hay ${contadores.pendientes} cliente${contadores.pendientes === 1 ? '' : 's'} esperando asesor en Pendientes.`
              : 'Las conversaciones de WhatsApp aparecen aquí en tiempo real.'}
          </p>
          {!!contadores.pendientes && bandeja !== 'pendientes' && (
            <button onClick={() => setBandeja('pendientes')} className="mt-3 px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-semibold hover:bg-red-600">Ver pendientes</button>
          )}
        </div>
      )}

      {mostrarNueva && <ModalNuevaConversacion onClose={() => setMostrarNueva(false)} onCreada={onConversacionCreada} />}
      {mostrarPlantilla && activa && (
        <ModalPlantilla
          conversacionId={activa.id}
          clienteNombre={activa.cliente?.nombre}
          onClose={() => setMostrarPlantilla(false)}
          onEnviada={() => { setMostrarPlantilla(false); setAviso(''); refrescarTodo(); }}
        />
      )}
      {mostrarRespuestas && (
        <ModalRespuestas
          respuestas={respuestas}
          editable={respuestasEditables}
          onClose={() => setMostrarRespuestas(false)}
          onCambio={cargarRespuestas}
        />
      )}
    </div>
  );
}
