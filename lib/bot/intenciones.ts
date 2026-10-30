// ============================================
// DETECTORES DE INTENCIÓN — qué quiere decir el cliente
// ============================================
// Funciones puras (sin base de datos ni IA): reconocen saludos, pagos,
// cancelaciones, cantidades, clientes molestos, etc. Se prueban en tests/.

import type { BotContext } from '@/types';

// Cantidades escritas en palabras ("dos", "una")
const PALABRAS_NUM: Record<string, number> = {
  'un': 1, 'una': 1, 'uno': 1,
  'dos': 2,
  'tres': 3,
  'cuatro': 4,
  'cinco': 5,
  'seis': 6,
  'siete': 7,
  'ocho': 8,
  'nueve': 9,
  'diez': 10,
  'once': 11,
  'doce': 12,
};

export function esSaludo(t: string) {
  return /^(hola|buenas|buenos|hey|ola|saludos|buen d[íi]a|buenas tardes|buenas noches)/i.test(t);
}

export function esIntencionCompra(t: string) {
  return /(comprar|quiero comprar|quiero pedir|quiero uno|dame uno|me interesa|añadir|agregar)/i.test(t);
}

export function esIntencionPago(t: string) {
  // SOLO frases explícitas de pago — NO incluir "si/ok/listo/dale/confirmar"
  // porque esas palabras son respuestas de confirmación en la máquina de estados.
  return /(^pagar$|^pago$|^finalizar$|^proceder$|^checkout$|proceder con el pago|quiero pagar|finalizar (la |mi )?compra|finalizar (el |mi )?pedido|realizar (el |mi )?pago|completar (la |mi )?compra|completar (el |mi )?pedido|ir a pagar|procesar (el |mi )?pago|quiero proceder|listo para pagar|dame el total|quiero el total)/i.test(t.trim());
}

/** El cliente no logra pagar con el link o pide otro medio de pago. */
export function esProblemaDePago(t: string): boolean {
  return /(contra ?entrega|pagar? al recibir|pago al recibir|cuando (me )?llegue|en efectivo|efectivo|transferencia|consignaci[oó]n|consignar|bancolombia|dat[aá]fono|otro medio|otra forma de pago|otro m[eé]todo|no me (da|deja|sirve|funciona|abre|carga|aparece|sale)|no (pude|puedo|logro|alcanc[eé] a) pagar|no (me )?(pas[oó]|entr[oó]) el pago|rechaz|fall[oó] el pago|error (en|con|al) (el )?pago|me sale error)/i.test(t);
}

/**
 * Cliente molesto con la atención del bot: lo dice claramente o repite el
 * mismo mensaje por tercera vez (el bot no le está entendiendo).
 */
export function esFrustracion(t: string, context?: BotContext): boolean {
  const molesto = /(no me (est[aá]s )?entiende(s)?|no entiendes( nada)?|no me est[aá]s ayudando|eres un (bot|robot)|p[eé]sim[oa] (servicio|atenci[oó]n)|mal[ií]sim[oa] (servicio|atenci[oó]n)|qu[eé] mal(a)? (servicio|atenci[oó]n)|terrible (servicio|atenci[oó]n)|llevo (un )?(rato|horas|mucho tiempo|toda la (ma[ñn]ana|tarde)) esperando|nadie (me )?(responde|contesta|atiende)|est[uú]pid|in[uú]til|me tienen (cansad|aburrid)|qu[eé] fastidio|no sirves|esto no sirve)/i;
  if (molesto.test(t)) return true;
  if (!context || t.trim().length < 4) return false;
  const anteriores = context.mensajes_previos.filter((m) => m.tipo === 'user').slice(-2).map((m) => (m.contenido || '').trim().toLowerCase());
  return anteriores.length === 2 && anteriores.every((m) => m === t.trim());
}

export function esConsultaEnvio(t: string) {
  return /(envio|env[íi]o|entregan|llevan|despachan|cobertura|domicilio|delivery)/i.test(t);
}

export function esConsultaPedido(t: string): boolean {
  return /(estado (de )?(mi|el)? ?(pedido|orden|compra|env[íi]o)|c[oó]mo va mi (pedido|orden|compra|env[íi]o)|d[oó]nde (está|va) mi (pedido|orden|compra|env[íi]o)|mi (pedido|orden|compra)|ya (lo )?(enviaron|despacharon|mandaron)|cu[aá]ndo (me )?(llega|lo entregan|lo reciben)|rastrear|rastreo|seguimiento|tracking|gu[íi]a de env[íi]o|n[uú]mero de gu[íi]a)/i.test(t.trim());
}

export function esAgradecimiento(t: string) {
  return /^(gracias|muchas gracias|chevere|ch[eé]vere|excelente|perfecto|genial|ok gracias|listo gracias)/i.test(t);
}

export function esConfirmacion(t: string) {
  return /^(si|s[íi]|yes|dale|ok|listo|confirmar|confirmo|proceder|adelante|claro|por supuesto|va)$/i.test(t.trim());
}

export function esNegacion(t: string) {
  return /^(no|nope|cancel|cancelar|no gracias|dejalo|d[eé]jalo)$/i.test(t.trim());
}

export function esCancelacion(t: string): boolean {
  const s = t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /(cancel(a|ar|o|emos)?|anul(a|ar|o)|no\s+(lo\s+|los\s+|me\s+)?quiero|ya\s+no\s+(lo\s+)?quiero|quita(me|lo|los|r)?|saca(me|lo|los|r)?|borra(lo|los|r|me)?|elimina(lo|los|r)?|olvida(lo|r)?|mejor\s+no|dejalo\s+asi|empezar\s+de\s+(nuevo|cero)|reinicia(r)?|vaciar?\s+(el\s+)?carrito|me\s+arrepent(i|im)|me\s+arrepiento|cambie\s+de\s+(opinion|idea|parecer)|ya\s+no\s+lo\s+llevo|dev(u|o)elve)/i.test(s);
}

export function extraerCantidades(t: string): number[] {
  const lower = quitarNumerosDeProducto(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const palabras = Object.keys(PALABRAS_NUM).join('|');
  const re = new RegExp(`\\b(\\d+|${palabras})\\b`, 'g');
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const token = m[1];
    const num = /^\d+$/.test(token) ? parseInt(token) : PALABRAS_NUM[token];
    if (!isNaN(num) && num > 0) out.push(num);
  }
  return out;
}

export function quitarNumerosDeProducto(t: string): string {
  return t
    .replace(/\d+(?:[.,]\d+)?\s*(?:años?|anos?|ml|mililitros?|cc|litros?|lts?|cl|oz|onzas?|%|grados?|°)(?![a-z])/gi, ' ')
    .replace(/\b(?:350|375|500|700|750|1000|1500|1750|2000)\b/g, ' ');
}

export function quitarAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function incluyeTermino(texto: string, termino: string): boolean {
  const t = quitarAcentos(texto.toLowerCase());
  const k = quitarAcentos(termino.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${k}(\\W|$)`).test(t);
}
