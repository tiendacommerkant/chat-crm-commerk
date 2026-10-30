// ============================================
// HORARIO DE ATENCIÓN DEL EQUIPO
// ============================================
//
// Lo configura un administrador en el CRM. Mientras no exista, el bot no
// menciona horas: decirle a un cliente un horario equivocado es peor que no
// decir ninguno.

import { supabaseAdmin } from './supabase';

export const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export type Dia = typeof DIAS[number];
export type Franja = { abre: string; cierra: string } | null; // "08:00"–"18:00"; null = cerrado
export type HorarioAtencion = Record<Dia, Franja>;

const NOMBRE_DIA: Record<Dia, string> = {
  lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado', dom: 'domingo',
};

// Colombia no cambia de horario en el año: siempre UTC-5
const OFFSET_COLOMBIA_MS = 5 * 3_600_000;

function horaColombia(fecha: Date): { dia: Dia; minutos: number; base: Date } {
  const local = new Date(fecha.getTime() - OFFSET_COLOMBIA_MS);
  const idx = (local.getUTCDay() + 6) % 7; // 0 = lunes
  return { dia: DIAS[idx], minutos: local.getUTCHours() * 60 + local.getUTCMinutes(), base: local };
}

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** "08:00" → "8:00 a. m."; "18:30" → "6:30 p. m." */
export function formatoHora(hhmm: string): string {
  const total = aMinutos(hhmm);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const sufijo = h24 < 12 ? 'a. m.' : 'p. m.';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`;
}

/** Valida y normaliza un horario recibido del CRM; null si no sirve. */
export function normalizarHorario(valor: any): HorarioAtencion | null {
  if (!valor || typeof valor !== 'object') return null;
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const salida = {} as HorarioAtencion;
  for (const d of DIAS) {
    const f = valor[d];
    if (!f) { salida[d] = null; continue; }
    if (!hora.test(f.abre) || !hora.test(f.cierra) || aMinutos(f.cierra) <= aMinutos(f.abre)) return null;
    salida[d] = { abre: f.abre, cierra: f.cierra };
  }
  return DIAS.some((d) => salida[d]) ? salida : null;
}

export function dentroDeHorario(horario: HorarioAtencion, fecha = new Date()): boolean {
  const { dia, minutos } = horaColombia(fecha);
  const f = horario[dia];
  return !!f && minutos >= aMinutos(f.abre) && minutos < aMinutos(f.cierra);
}

/** Cuándo vuelve a abrir: "hoy a las 2:00 p. m.", "mañana a las 8:00 a. m.", "el lunes a las 8:00 a. m.". */
export function proximaApertura(horario: HorarioAtencion, fecha = new Date()): string | null {
  const { dia, minutos } = horaColombia(fecha);
  const hoy = DIAS.indexOf(dia);
  for (let i = 0; i < 8; i++) {
    const d = DIAS[(hoy + i) % 7];
    const f = horario[d];
    if (!f) continue;
    if (i === 0 && minutos >= aMinutos(f.abre)) continue; // hoy ya abrió (y cerró, si estamos aquí)
    const cuando = i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${NOMBRE_DIA[d]}`;
    return `${cuando} a las ${formatoHora(f.abre)}`;
  }
  return null;
}

/** "lunes a viernes de 8:00 a. m. a 6:00 p. m. y sábado de 9:00 a. m. a 1:00 p. m." */
export function describirHorario(horario: HorarioAtencion): string {
  const grupos: { desde: Dia; hasta: Dia; franja: NonNullable<Franja> }[] = [];
  for (const d of DIAS) {
    const f = horario[d];
    if (!f) continue;
    const ultimo = grupos[grupos.length - 1];
    const consecutivo = ultimo && DIAS.indexOf(ultimo.hasta) === DIAS.indexOf(d) - 1;
    if (ultimo && consecutivo && ultimo.franja.abre === f.abre && ultimo.franja.cierra === f.cierra) ultimo.hasta = d;
    else grupos.push({ desde: d, hasta: d, franja: f });
  }
  const partes = grupos.map((g) => {
    const dias = g.desde === g.hasta ? NOMBRE_DIA[g.desde] : `${NOMBRE_DIA[g.desde]} a ${NOMBRE_DIA[g.hasta]}`;
    return `${dias} de ${formatoHora(g.franja.abre)} a ${formatoHora(g.franja.cierra)}`;
  });
  return partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Aviso para el cliente cuando lo pasan a un asesor fuera de horario; '' si no aplica. */
export function avisoFueraDeHorario(horario: HorarioAtencion | null, fecha = new Date()): string {
  if (!horario || dentroDeHorario(horario, fecha)) return '';
  const vuelve = proximaApertura(horario, fecha);
  return `🕐 En este momento nuestro equipo está fuera de horario (atendemos ${describirHorario(horario)}).` +
    (vuelve ? ` Te escribimos ${vuelve}.` : '');
}

// ─── Configuración guardada ───────────────────────────────────────────────

let cache: { valor: Record<string, any>; hasta: number } | null = null;

/** Lee la tabla configuracion (con 60 s de caché). Sin migración → {}. */
export async function leerConfiguracion(): Promise<Record<string, any>> {
  if (cache && cache.hasta > Date.now()) return cache.valor;
  const { data, error } = await supabaseAdmin.from('configuracion').select('clave, valor');
  const valor: Record<string, any> = {};
  if (!error) for (const fila of (data as any[]) || []) valor[fila.clave] = fila.valor;
  cache = { valor, hasta: Date.now() + 60_000 };
  return valor;
}

export function limpiarCacheConfiguracion() { cache = null; }

export async function obtenerHorario(): Promise<HorarioAtencion | null> {
  return normalizarHorario((await leerConfiguracion()).horario_atencion);
}
