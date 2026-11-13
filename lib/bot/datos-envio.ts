// ============================================
// DATOS DE ENVÍO DEL DOMICILIO
// ============================================
// Pedido del equipo (13 nov): para despachar y facturar necesitan nombre,
// cédula, correo, teléfono, dirección, barrio y si el cliente quiere factura
// electrónica. Antes Sofi solo pedía la dirección y el equipo tenía que
// escribirle al cliente después. Ahora el bot manda la misma plantilla que usa
// el equipo y entiende la respuesta como la mande el cliente: llenando la
// plantilla, un dato por línea, todo en una línea con comas o solo lo que
// falte. Sin dependencias de red: se prueba de forma aislada.
import { esNombreDeMunicipio } from '../cobertura';

export interface DatosEnvio {
  nombre?: string;
  cedula?: string;
  correo?: string;
  telefono?: string;
  direccion?: string;
  barrio?: string;
  municipio?: string;
  factura?: 'SI' | 'NO';
}
export type CampoEnvio = keyof DatosEnvio;

/** Los datos que se piden, en el orden de la plantilla del equipo. */
export const CAMPOS_PEDIDOS: CampoEnvio[] = ['nombre', 'cedula', 'correo', 'telefono', 'direccion', 'barrio', 'factura'];

const LINEA: Record<CampoEnvio, string> = {
  nombre: '🏷️ *Nombre:*',
  cedula: '🪪 *Cédula:*',
  correo: '📧 *Correo electrónico:*',
  telefono: '📲 *Teléfono:*',
  direccion: '📍 *Dirección:*',
  barrio: '🗾 *Barrio:*',
  municipio: '🏙️ *Municipio:*',
  factura: '🧾 *¿Factura electrónica? SI/NO*',
};

/** Lista de campos para que el cliente la copie y la llene. */
export function lineasCampos(campos: CampoEnvio[]): string {
  return campos.map((c) => LINEA[c]).join('\n');
}

/** Correo que acepta Shopify (uno mal escrito haría fallar el pedido). */
export const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const SIN_CORREO = 'No tiene';

// Minúsculas sin tildes, con el MISMO largo (para cortar el texto original)
const TILDES: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
function plano(s: string): string {
  return s.toLowerCase().replace(/[áéíóúüñ]/g, (c) => TILDES[c]);
}

// Etiquetas de la plantilla y sus variantes ("C.C.", "Celular", "Email"…)
const ETIQUETAS: Array<[CampoEnvio, RegExp]> = [
  ['factura', /^¿?\s*(factura(cion)?)( electronica)?\s*\??(\s*\(?\s*si\s*\/\s*no\s*\)?)?/],
  ['correo', /^(correo( electronico)?|e-?mail|mail)\b/],
  ['cedula', /^(cedula( de ciudadania)?|c\.\s?c\b\.?|cc\b|documento( de identidad)?|identificacion|nit\b)/],
  ['telefono', /^(telefono|celular|cel\b|whatsapp|movil|numero de (contacto|celular|telefono))/],
  ['direccion', /^(direccion( de (envio|entrega))?|dir\b)/],
  ['barrio', /^barrio\b/],
  ['municipio', /^(municipio|ciudad)\b/],
  ['nombre', /^(nombres?( completo)?( y apellidos?)?|quien recibe)\b/],
];
// Etiqueta con dos puntos en mitad de una línea: "Nombre: Juan Cédula: 123"
const CORTE_ETIQUETA = /(?=(?:¿\s*)?\b(?:nombres?|c[eé]dula|correo|e-?mail|tel[eé]fono|celular|direcci[oó]n|barrio|ciudad|municipio|factura)\b[^:\n]{0,25}:)/i;

const VIA = /\b(calle|cll?|carrera|cra|kra?|cr|avenida|av|avda|diagonal|diag|dg|transversal|transv|tv|tr|circular|circ|cq|autopista|km|kilometro|vereda|manzana|mz|lote|finca)\b/;
const NUMERACION = /\d+\s*[a-z]?\s*(#|n[°º]|no\.|nro\.?)\s*\d+/;
const COMPLEMENTO = /^(apto|apartamento|apt|casa|torre|interior|int|piso|bloque|bl|unidad|edificio|edif|local|oficina|of|porteria|urbanizacion|conjunto|etapa)\b/;
const RELLENO = /^(hola|buenas( tardes| noches| dias)?|buen dia|ok|okey|listo|gracias|muchas gracias|vale|perfecto|claro|dale|de una|bueno|aqui (estan|van)|ahi (estan|van)|(estos son )?mis datos|los datos)\b/;
const IGNORAR = /(domicilio en|cubrimos|puedes copiar|indicame|ind[ií]came|para enviarte)/;

function limpiarValor(v: string): string {
  return v
    .replace(/[*_~]/g, '')
    .replace(/^[\s:=\-–.]+/, '')
    .replace(/[^\p{L}\p{N}@.)\]#-]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "sí", "Si señor", "no gracias"… → SI/NO; null si no es una respuesta de sí o no. */
export function siNo(v: string): 'SI' | 'NO' | null {
  const p = plano(v).replace(/[¡!.,]/g, '').trim();
  if (/^no se\b/.test(p)) return null; // "no sé todavía" es una duda, no un no
  if (/^(no|nop|nope|ninguna|no requiero|no necesito|no gracias)\b/.test(p)) return 'NO';
  if (/^(si+|claro|por favor|porfa|obvio|dale|yes|la requiero|requiero|la necesito|necesito|quiero)\b/.test(p)) return 'SI';
  return null;
}

// Palabras de una pregunta o un comentario, no de un nombre ni de un barrio
const NO_ES_DATO = /\b(cuanto|que|como|donde|cuando|vale|cuesta|demora|tarda|envio|envian|precio|quiero|necesito|tienen|hay|puedo|pago|pagar|link|gracias|domicilio|pedido|favor|ayuda|asesor)\b/;

function soloLetras(v: string): boolean {
  return /^[\p{L}][\p{L}\s'.-]{1,59}$/u.test(v) && v.split(/\s+/).length <= 6 && !NO_ES_DATO.test(plano(v));
}

function sinPresentacion(v: string): string {
  return v.replace(/^(me llamo|mi nombre es|soy|a nombre de)\s+/i, '');
}

/** Teléfono colombiano de 10 dígitos, o null. */
function telefonoDe(digitos: string): string | null {
  if (digitos.length === 12 && digitos.startsWith('57')) return digitos.slice(2);
  if (digitos.length === 10 && (digitos.startsWith('3') || digitos.startsWith('60'))) return digitos;
  return null;
}

/** Cédula o NIT tal como se escribe sin puntos (NIT con su dígito: 900123456-7). */
function cedulaDe(v: string): string | null {
  const s = v.replace(/[\s.]/g, '');
  const m = s.match(/^(\d{5,11})(-\d)?$/);
  return m ? s : null;
}

/** Valida y normaliza el valor de un campo; null si no sirve para ese campo. */
export function validarCampo(campo: CampoEnvio, valor: string): string | null {
  const v = limpiarValor(valor);
  if (!v) return null;
  switch (campo) {
    case 'nombre': {
      const n = sinPresentacion(v);
      return soloLetras(n) && !RELLENO.test(plano(n)) ? n : null;
    }
    case 'barrio':
    case 'municipio': return /\p{L}{3,}/u.test(v) && v.length <= 60 ? v : null;
    case 'cedula': return cedulaDe(v);
    case 'telefono': return telefonoDe(v.replace(/\D/g, '')) || (/^\d{7}$/.test(v.replace(/\D/g, '')) ? v.replace(/\D/g, '') : null);
    case 'correo': {
      if (/\bno (tengo|tiene|manejo|uso)\b|sin correo|ningun/.test(plano(v))) return SIN_CORREO;
      const m = v.match(/[^\s@,;:]+@[^\s@,;:]+\.[^\s@,;:]{2,}/);
      return m ? m[0].toLowerCase() : null;
    }
    case 'direccion': return /\d/.test(v) && v.length >= 6 ? v : null;
    case 'factura': return siNo(v);
  }
  return null;
}

/** Separa "Calle 10 # 40-20, El Poblado, Medellín" en dirección, barrio y municipio. */
function partirDireccion(texto: string, d: DatosEnvio, cobertura: string[]) {
  let direccion = texto;
  const conBarrio = texto.split(/\s*,?\s*\bbarrio\b\s*:?\s*/i);
  if (conBarrio.length > 1) {
    direccion = conBarrio[0];
    const [barrio, ...resto] = conBarrio.slice(1).join(' ').split(/\s*,\s*/);
    if (!d.barrio && validarCampo('barrio', barrio)) d.barrio = limpiarValor(barrio);
    for (const r of resto) if (!d.municipio && esNombreDeMunicipio(r, cobertura)) d.municipio = limpiarValor(r);
  } else {
    const partes = texto.split(/\s*,\s*/);
    const calle: string[] = [];
    for (const p of partes) {
      if (!calle.length || /\d/.test(p) || COMPLEMENTO.test(plano(p))) { calle.push(p); continue; }
      if (esNombreDeMunicipio(p, cobertura)) { if (!d.municipio) d.municipio = limpiarValor(p); continue; }
      if (!d.barrio && soloLetras(limpiarValor(p))) { d.barrio = limpiarValor(p); continue; }
      calle.push(p);
    }
    direccion = calle.join(', ');
  }
  d.direccion = limpiarValor(direccion);
}

/**
 * Lee el mensaje del cliente y completa los datos que ya se tenían.
 * Devuelve los datos y qué campos llegaron en este mensaje.
 */
export function extraerDatosEnvio(
  texto: string,
  previos: DatosEnvio = {},
  cobertura: string[] = []
): { datos: DatosEnvio; nuevos: CampoEnvio[] } {
  const d: DatosEnvio = { ...previos };
  const antes = { ...previos };
  const faltabanAntes = CAMPOS_PEDIDOS.filter((c) => !previos[c]);

  // Segmentos: una línea, partida si trae varias etiquetas o es una lista con comas
  const segmentos: string[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    // Líneas del mensaje del bot que el cliente pegó con sus datos
    if (IGNORAR.test(plano(linea))) continue;
    for (const parte of linea.split(CORTE_ETIQUETA)) {
      const etiquetada = ETIQUETAS.some(([, re]) => re.test(plano(parte.replace(/^[^\p{L}\p{N}¿]+/u, '').trim())));
      // Lista con comas ("Juan, 1036…, Calle 10…") o "Zúñiga, Envigado" sin números
      const lista = (parte.match(/,/g) || []).length >= 3 || (/[,;]/.test(parte) && !/\d/.test(parte));
      if (!etiquetada && lista) segmentos.push(...parte.split(/\s*[,;]\s*/));
      else segmentos.push(parte);
    }
  }

  // Dirección escrita en ESTE mensaje: lo que va después suele ser el barrio
  let vistaDireccion = false;
  let complemento = '';
  const sueltos: string[] = [];

  for (const crudo of segmentos) {
    const seg = crudo.replace(/^[^\p{L}\p{N}¿+]+/u, '').trim();
    if (!seg) continue;
    const p = plano(seg);
    if (IGNORAR.test(p)) continue;

    // 1) Con etiqueta: "Cédula: 1.036.654.321"
    const etiqueta = ETIQUETAS.find(([, re]) => re.test(p));
    if (etiqueta) {
      const [campo, re] = etiqueta;
      const valor = seg.slice(p.match(re)![0].length);
      if (campo === 'direccion') {
        if (validarCampo('direccion', valor)) { partirDireccion(limpiarValor(valor), d, cobertura); vistaDireccion = true; }
        continue;
      }
      const v = validarCampo(campo, valor);
      if (v) (d as any)[campo] = v;
      continue;
    }

    // 2) Sin etiqueta: se reconoce por la forma. Una pregunta nunca es un dato
    //    ("¿llega a la calle 10?" no cambia la dirección)
    if (/[?¿]/.test(seg)) { sueltos.push(seg); continue; }
    const correo = seg.match(/[^\s@,;:]+@[^\s@,;:]+\.[^\s@,;:]{2,}/);
    if (correo) {
      d.correo = correo[0].toLowerCase();
      const resto = seg.replace(correo[0], '').trim();
      if (resto.length >= 3) sueltos.push(resto);
      continue;
    }
    if (!d.correo && /\bno (tengo|tiene|manejo|uso) (correo|e-?mail)|sin correo/.test(p)) { d.correo = SIN_CORREO; continue; }
    if (/\d/.test(seg) && (VIA.test(p) || NUMERACION.test(p) || seg.includes('#'))) {
      // "Calle 10, # 20-30" partido por las comas: es la misma dirección
      if (vistaDireccion && !VIA.test(p) && d.direccion) d.direccion = `${d.direccion} ${limpiarValor(seg)}`;
      else partirDireccion(seg, d, cobertura);
      vistaDireccion = true;
      continue;
    }
    if (/\d/.test(seg) && COMPLEMENTO.test(p)) { complemento = `${complemento} ${limpiarValor(seg)}`.trim(); continue; }
    const numero = seg.match(/\d[\d.\s-]{3,}\d/);
    if (numero && seg.replace(numero[0], '').replace(/[^\p{L}]/gu, '').length <= 12) {
      const digitos = numero[0].replace(/\D/g, '');
      // Un celular (3xx, 10 dígitos) nunca es una cédula: las de 10 dígitos empiezan por 1.
      // Si da otro número de contacto, reemplaza el del WhatsApp.
      const tel = telefonoDe(digitos);
      const cc = cedulaDe(numero[0]);
      if (tel) d.telefono = tel;
      else if (cc) d.cedula = cc;
      continue;
    }
    // Sin etiqueta, solo una respuesta corta de sí o no ("no", "sí por favor") es la factura
    if (!d.factura && /^(si+|no|claro|obvio|dale)( (gracias|senor|senora|por favor|porfa|la necesito|la requiero|requiero|necesito|quiero)( factura)?)?$/.test(p.replace(/[¡!.,]/g, '').trim())) {
      d.factura = siNo(seg)!;
      continue;
    }
    if (RELLENO.test(p) && seg.split(/\s+/).length <= 4) continue;
    const letras = sinPresentacion(limpiarValor(seg));
    if (soloLetras(letras)) {
      if (!d.municipio && esNombreDeMunicipio(letras, cobertura)) { d.municipio = letras; continue; }
      if (!d.nombre && !vistaDireccion) { d.nombre = letras; continue; }
      if (!d.barrio) { d.barrio = letras; continue; }
      if (!d.nombre) { d.nombre = letras; continue; }
    }
    sueltos.push(seg);
  }
  if (complemento) d.direccion = d.direccion ? `${d.direccion} ${complemento}` : undefined;

  // Respuesta a "me falta tu cédula": el mensaje entero es ese dato
  const faltan = CAMPOS_PEDIDOS.filter((c) => !d[c]);
  const llegoAlgo = CAMPOS_PEDIDOS.some((c) => d[c] !== antes[c]) || d.municipio !== antes.municipio;
  if (!llegoAlgo && faltabanAntes.length && faltan.length === 1 && texto.trim().length <= 80) {
    const v = validarCampo(faltan[0], texto.trim());
    if (v) (d as any)[faltan[0]] = v;
  }

  const nuevos = (Object.keys(d) as CampoEnvio[]).filter((c) => d[c] !== antes[c]);
  return { datos: d, nuevos };
}

/** Campos que todavía faltan (el teléfono se toma del WhatsApp si no lo da). */
export function camposFaltantes(d: DatosEnvio): CampoEnvio[] {
  return CAMPOS_PEDIDOS.filter((c) => !d[c]);
}

/** Dirección completa para la cobertura, la venta y el link de pago. */
export function direccionCompleta(d: DatosEnvio): string {
  const dir = d.direccion || '';
  const n = plano(dir);
  const partes = [dir];
  if (d.barrio && !n.includes(plano(d.barrio))) partes.push(`barrio ${d.barrio}`);
  if (d.municipio && !n.includes(plano(d.municipio))) partes.push(d.municipio);
  return partes.filter(Boolean).join(', ');
}

/** Teléfono del WhatsApp en 10 dígitos (vacío si el cliente oculta su número). */
export function telefonoDeWhatsApp(telefono: string | null | undefined): string {
  return telefonoDe(String(telefono || '').replace(/\D/g, '')) || '';
}

/** Los datos para el resumen del pedido. */
export function resumenDatosEnvio(d: DatosEnvio): string {
  return [
    `📍 *Envío a:* ${direccionCompleta(d)}`,
    `🏷️ ${d.nombre} · 🪪 ${d.cedula}`,
    `📧 ${d.correo} · 📲 ${d.telefono}`,
    `🧾 Factura electrónica: *${d.factura === 'SI' ? 'SÍ' : 'NO'}*`,
  ].join('\n');
}
