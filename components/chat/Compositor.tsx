'use client';

// Caja de respuesta del asesor: texto, respuestas rápidas con "/", adjuntos,
// plantillas y notas internas. Respeta la ventana de 24 h de WhatsApp.
import { useEffect, useMemo, useRef, useState } from 'react';

export type RespuestaRapida = { id: string; atajo: string; contenido: string };

const TIPOS_ARCHIVO = 'image/jpeg,image/png,application/pdf';

function tiempoRestante(cierraEn: string | null): string {
  if (!cierraEn) return '';
  const min = Math.floor((new Date(cierraEn).getTime() - Date.now()) / 60000);
  if (min <= 0) return '';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h`;
}

export function Compositor(props: {
  conversacionId: string;
  ventanaAbierta: boolean | null;
  cierraEn: string | null;
  respuestas: RespuestaRapida[];
  onGestionarRespuestas: () => void;
  onAbrirPlantilla: () => void;
  onEnviado: () => void;
  onNota: (contenido: string) => Promise<boolean>;
  estadoAtencion?: string;
}) {
  const [modo, setModo] = useState<'responder' | 'nota'>('responder');
  const [texto, setTexto] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  // Al cambiar de conversación se limpia todo
  useEffect(() => {
    setTexto(''); setArchivo(null); setError(''); setModo('responder');
  }, [props.conversacionId]);

  const ventanaCerrada = props.ventanaAbierta === false;
  const bloqueado = modo === 'responder' && ventanaCerrada;

  // "/" al inicio abre las respuestas rápidas filtradas por atajo
  const filtroAtajo = texto.startsWith('/') && !texto.includes(' ') ? texto.slice(1).toLowerCase() : null;
  const sugerencias = useMemo(() => filtroAtajo === null ? [] :
    props.respuestas.filter((r) => r.atajo.includes(filtroAtajo) || r.contenido.toLowerCase().includes(filtroAtajo)).slice(0, 6),
  [filtroAtajo, props.respuestas]);

  const usarRespuesta = (r: RespuestaRapida) => {
    setTexto(r.contenido);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const enviar = async () => {
    if (enviando) return;
    setError('');
    const contenido = texto.trim();

    if (modo === 'nota') {
      if (!contenido) return;
      setEnviando(true);
      const ok = await props.onNota(contenido);
      setEnviando(false);
      if (ok) setTexto(''); else setError('No se pudo guardar la nota.');
      return;
    }
    if (bloqueado || (!contenido && !archivo)) return;

    setEnviando(true);
    try {
      let res: Response;
      if (archivo) {
        const form = new FormData();
        form.append('archivo', archivo);
        if (contenido) form.append('texto', contenido);
        res = await fetch(`/api/conversaciones/${props.conversacionId}/adjunto`, { method: 'POST', body: form });
      } else {
        res = await fetch(`/api/conversaciones/${props.conversacionId}/reply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: contenido }),
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!json.success) { setError(json.error || 'No se pudo enviar.'); return; }
      setTexto(''); setArchivo(null);
      props.onEnviado();
    } catch {
      setError('Sin conexión. Intenta de nuevo.');
    } finally {
      setEnviando(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (sugerencias.length) usarRespuesta(sugerencias[0]); else enviar();
    }
    if (e.key === 'Escape' && filtroAtajo !== null) setTexto('');
  };

  const restante = tiempoRestante(props.cierraEn);

  return (
    <div className={`border-t px-4 pt-2.5 pb-3 shrink-0 ${modo === 'nota' ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-slate-100'}`}>
      <div className="flex items-center gap-1 mb-2">
        {(['responder', 'nota'] as const).map((m) => (
          <button key={m} onClick={() => setModo(m)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              modo === m
                ? m === 'nota' ? 'bg-amber-100 text-amber-800' : 'bg-commerk-navy text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}>
            {m === 'responder' ? 'Responder' : '🔒 Nota interna'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {modo === 'responder' && props.ventanaAbierta && restante && (
            <span className="text-slate-400" title="WhatsApp permite mensajes libres hasta 24 h después del último mensaje del cliente">
              Ventana abierta · {restante}
            </span>
          )}
          <button onClick={props.onGestionarRespuestas} className="text-commerk-navy/70 hover:text-commerk-navy font-semibold">
            Respuestas rápidas
          </button>
        </div>
      </div>

      {bloqueado && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <span className="text-lg">⏳</span>
          <p className="text-xs text-amber-800 flex-1">
            Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite escribirle con una <b>plantilla aprobada</b>.
          </p>
          <button onClick={props.onAbrirPlantilla} className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">
            Enviar plantilla
          </button>
        </div>
      )}

      {modo === 'responder' && !bloqueado && props.respuestas.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide">
          {props.respuestas.slice(0, 8).map((r) => (
            <button key={r.id} onClick={() => usarRespuesta(r)} title={r.contenido}
              className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 hover:bg-commerk-navy hover:text-white transition-all">
              /{r.atajo}
            </button>
          ))}
        </div>
      )}

      {archivo && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
          <span>{archivo.type === 'application/pdf' ? '📄' : '🖼️'}</span>
          <span className="max-w-[220px] truncate font-medium">{archivo.name}</span>
          <span className="text-slate-400">{(archivo.size / 1024 / 1024).toFixed(1)} MB</span>
          <button onClick={() => setArchivo(null)} className="text-slate-400 hover:text-red-500" title="Quitar">✕</button>
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {sugerencias.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden z-20">
            {sugerencias.map((r) => (
              <button key={r.id} onClick={() => usarRespuesta(r)} className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <p className="text-xs font-bold text-commerk-navy">/{r.atajo}</p>
                <p className="text-xs text-slate-500 truncate">{r.contenido}</p>
              </button>
            ))}
          </div>
        )}

        {modo === 'responder' && (
          <div className="flex items-center gap-1 pb-1">
            <button onClick={() => archivoRef.current?.click()} disabled={bloqueado}
              className="w-9 h-9 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center disabled:opacity-30" title="Adjuntar foto o PDF">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
            </button>
            <button onClick={props.onAbrirPlantilla}
              className="w-9 h-9 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center" title="Enviar plantilla de WhatsApp">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </button>
            <input ref={archivoRef} type="file" accept={TIPOS_ARCHIVO} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setArchivo(f); e.target.value = ''; }} />
          </div>
        )}

        <textarea
          ref={inputRef}
          value={texto}
          disabled={bloqueado}
          onChange={(e) => {
            setTexto(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={modo === 'nota'
            ? 'Nota para el equipo (el cliente no la ve)…'
            : bloqueado ? 'Usa una plantilla para escribirle a este cliente'
            : archivo ? 'Texto que acompaña el archivo (opcional)…'
            : 'Escribe un mensaje… ( / para respuestas rápidas · Enter envía )'}
          className={`flex-1 px-4 py-2.5 text-sm border rounded-2xl resize-none focus:outline-none max-h-36 overflow-y-auto disabled:cursor-not-allowed ${
            modo === 'nota' ? 'bg-white border-amber-200 focus:border-amber-400' : 'bg-slate-50 border-slate-200 focus:border-commerk-navy/40 focus:bg-white'
          }`}
        />
        <button onClick={enviar}
          disabled={enviando || bloqueado || (modo === 'nota' ? !texto.trim() : !texto.trim() && !archivo)}
          className={`h-11 px-4 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-sm ${
            modo === 'nota' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-commerk-navy hover:bg-commerk-navy/90'
          }`}>
          {enviando
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : modo === 'nota' ? 'Guardar' : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            )}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">{error}</p>}
      <p className="text-[10px] text-slate-400 mt-1.5 px-1">
        {modo === 'nota'
          ? 'Las notas solo las ve el equipo. No se envían al cliente ni las lee el bot.'
          : props.estadoAtencion === 'bot'
            ? 'Al responder tomas la conversación y Sofi deja de contestar.'
            : 'Shift + Enter para una nueva línea.'}
      </p>
    </div>
  );
}
