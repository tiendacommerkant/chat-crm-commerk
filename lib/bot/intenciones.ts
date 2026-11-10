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

// Repetir lo mismo solo cuenta como molestia si fue seguido: un "Hola" de hoy
// y otro de la semana pasada no son un cliente atascado.
const VENTANA_REPETICION_MS = 15 * 60_000;

/**
 * Cliente molesto con la atención del bot: lo dice claramente o repite el
 * mismo mensaje por tercera vez en pocos minutos (el bot no le está entendiendo).
 * Los saludos repetidos no cuentan: antes, quien volvía y saludaba con "Hola"
 * pasaba a un asesor con un "Lamento mucho la experiencia".
 */
export function esFrustracion(t: string, context?: BotContext): boolean {
  const molesto = /(no me (est[aá]s )?entiende(s)?|no entiendes( nada)?|no me est[aá]s ayudando|eres un (bot|robot)|p[eé]sim[oa] (servicio|atenci[oó]n)|mal[ií]sim[oa] (servicio|atenci[oó]n)|qu[eé] mal(a)? (servicio|atenci[oó]n)|terrible (servicio|atenci[oó]n)|llevo (un )?(rato|horas|mucho tiempo|toda la (ma[ñn]ana|tarde)) esperando|nadie (me )?(responde|contesta|atiende)|est[uú]pid|in[uú]til|me tienen (cansad|aburrid)|qu[eé] fastidio|no sirves|esto no sirve)/i;
  if (molesto.test(t)) return true;
  const actual = t.trim().toLowerCase();
  if (!context || actual.length < 4 || esSaludo(actual)) return false;

  const previos = context.mensajes_previos;
  const delCliente = previos.filter((m) => m.tipo === 'user');
  // El webhook guarda el mensaje antes de leer el historial: si el último del
  // historial es este mismo mensaje, no es una repetición anterior
  const ultimo = delCliente[delCliente.length - 1];
  if (ultimo && ultimo === previos[previos.length - 1] && (ultimo.contenido || '').trim().toLowerCase() === actual) {
    delCliente.pop();
  }
  const ahora = Date.now();
  const anteriores = delCliente.slice(-2);
  return anteriores.length === 2 && anteriores.every((m) =>
    (m.contenido || '').trim().toLowerCase() === actual &&
    ahora - new Date(m.created_at).getTime() < VENTANA_REPETICION_MS);
}

/** Botón "Avísame por WhatsApp" de La Hora Roja en la tienda (Black Week). */
export function esAvisoHoraRoja(t: string): boolean {
  const s = quitarAcentos(t.toLowerCase());
  return /hora roja/.test(s) && /(avisa|avisen|aviso|avisame|recuerda|notifica)/.test(s);
}

export function esConsultaEnvio(t: string) {
  return /(envio|env[íi]o|entregan|llevan|despachan|cobertura|domicilio|delivery)/i.test(t);
}

/** Desde cuántas unidades de un mismo producto la compra es por mayor (una caja de licor son 12 botellas). */
export const UNIDADES_MAYORISTA = 12;

/** "Calle 45 # 77-68 oficina 202": los números de una dirección no son cantidades ni pedidos. */
export function pareceDireccion(t: string): boolean {
  return /\b(calle|cll|carrera|cra|cr|cl|avenida|av|transversal|diagonal|circular|barrio|apto|apartamento|oficina|ofic|torre|piso|manzana|mz|bloque|interior|km)\b|#|n[°º]/i.test(t);
}

/**
 * Pedido "por caja" de un producto del catálogo: "la caja x12 de 750", "2 cajas
 * de amarillo", "precio por caja", "cuánto sale la caja". Una caja de licor son
 * 12 o 24 botellas y su precio NO es el unitario multiplicado: lo da el equipo
 * de ventas por mayor. No cuenta la caja de regalo ni el empaque ("caja de
 * regalo", "caja cartón", "¿me lo envían en una caja?").
 */
export function esPedidoPorCaja(t: string): boolean {
  const s = quitarAcentos(t.toLowerCase());
  if (!/\bcajas?\b/.test(s)) return false;
  const empaque = /\bcajas?\s+(de\s+|para\s+)?(regalo|regalos|obsequio|carton|madera|decorad\w*|sorpresa|ejecutiva|personalizad\w*|presentacion)\b|\bcajita|\bempaque\b|\ben\s+(una\s+|la\s+|su\s+)?cajas?\b|\bcon\s+(su\s+|la\s+)?cajas?\b(?!\s*(x|por|de|con)\s*\d)/;
  if (empaque.test(s)) return false;
  return (
    /\bcajas?\s*(x|por|de|con)\s*\d{1,3}\b/.test(s) || // caja x12, caja de 24
    /\b(\d{1,3}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media)\s+cajas?\b/.test(s) || // 2 cajas, una caja
    /\b(al\s+)?por\s+cajas?\b/.test(s) || // precio por caja
    /\bcuantas\s+cajas\b/.test(s) ||
    /\b(precio|vale|sale|cuesta|valor|cuanto)\b[^.?!]{0,30}\b(la|las|una|unas)\s+cajas?\b/.test(s) // cuánto sale la caja
  );
}

/**
 * Unidades que pide en el mensaje ("12 botellas", "x24", "una docena"): la
 * mayor; 0 si no dice. Ignora tamaños ("750 ml", "12 años") y direcciones.
 */
export function unidadesPedidas(t: string): number {
  if (pareceDireccion(t)) return 0;
  const s = quitarAcentos(quitarNumerosDeProducto(t).toLowerCase());
  let max = 0;
  for (const m of s.matchAll(/\b(\d{1,3})\s*(unidades|unidad|unds?|uds?|und|botellas|kits|anchetas|garrafas|estuches|combos|cremas|rones|aguardientes|medias)\b|\bx\s*(\d{1,3})\b/g)) {
    const n = parseInt(m[1] || m[3]);
    if (n > max) max = n;
  }
  if (/\bdocenas?\b/.test(s)) max = Math.max(max, 12);
  return max;
}

/**
 * Compra por volumen que suena a empresa regalando a su gente o a sus clientes
 * ("somos una empresa y necesitamos 200 kits para nuestros clientes"): es venta
 * empresarial, no mayorista. Si habla de revender o de su negocio/licorera,
 * manda lo mayorista aunque diga "empresa".
 */
export function pareceCompraEmpresarial(t: string): boolean {
  const s = quitarAcentos(t.toLowerCase());
  if (/\b(revender|reventa|negocio|licorera|estanco|distribuidor\w*|distribuir|mayorista|por mayor|mi tienda|mi bar|discoteca|surtir)\b/.test(s)) return false;
  return /\b(empresa|compania|corporativ\w*|somos|colaboradores|empleados|trabajadores|funcionarios|aguinaldos?|obsequios?|nomina|gerencia|nuestr[oa]s?\s+(clientes|equipo|personal|gente)|regalos?\s+(para|corporativ\w*|empresarial\w*))\b/.test(s);
}

export function esConsultaPedido(t: string): boolean {
  const s = t.trim();
  // "quiero hacer mi pedido", "cancelar mi compra": es una acción, no una consulta de estado
  if (/\b(hacer|armar|realizar|iniciar|empezar|comenzar|cancelar|anular|pagar|finalizar|cerrar|confirmar|cambiar|modificar|agregar|separar|quiero|deseo|hago|voy a)\b[^.?!]{0,25}\bmi (pedido|orden|compra)\b/i.test(s)) return false;
  return /(estado (de )?(mi|el)? ?(pedido|orden|compra|env[íi]o)|c[oó]mo va mi (pedido|orden|compra|env[íi]o)|d[oó]nde (está|va) mi (pedido|orden|compra|env[íi]o)|mi (pedido|orden|compra)|ya (lo )?(enviaron|despacharon|mandaron)|cu[aá]ndo (me )?(llega|lo entregan|lo reciben)|rastrear|rastreo|seguimiento|tracking|gu[íi]a de env[íi]o|n[uú]mero de gu[íi]a)/i.test(s);
}

/** Número de pedido que el cliente escribe ("#2692", "pedido 2692"); null si no hay o si es una dirección. */
export function numeroDePedidoEn(t: string): string | null {
  if (/\b(calle|cll|carrera|cra|cr|avenida|av|transversal|diagonal|circular|barrio|apto|apartamento|oficina|torre|piso)\b/i.test(t)) return null;
  const m = t.match(/(?:#|\b(?:pedido|orden|order|n[uú]mero|no\.?)\s*#?\s*)(\d{3,6})\b/i);
  return m ? m[1] : null;
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
