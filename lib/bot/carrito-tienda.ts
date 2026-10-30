// ============================================
// RESPUESTA AL RECORDATORIO DE CARRITO DE LA TIENDA ONLINE
// ============================================
//
// La plantilla carrito_abandonado dice "Escríbenos y lo dejamos listo para
// ti". Si el cliente responde justo después del recordatorio, el bot le manda
// el link de su carrito de Shopify (guardado en el mensaje del recordatorio,
// ver lib/recuperacion.ts). Va antes de pedir las políticas: solo le
// devolvemos su propio link, sin pedirle datos; lo demás sigue igual.

import type { BotContext, BotResponse } from '@/types';
import { esConfirmacion, esIntencionCompra, esIntencionPago, esNegacion, esSaludo } from './intenciones';

const VIGENCIA_MS = 72 * 3_600_000;

export type RespuestaCarrito = 'si' | 'luego' | 'no' | 'ya_compro' | null;

export function clasificarRespuestaCarrito(t: string): RespuestaCarrito {
  const s = t.trim().toLowerCase();
  if (/ya (lo |la |los |las )?(compr|pagu|ped[ií])|ya hice (el |mi )?(pedido|compra)/.test(s)) return 'ya_compro';
  if (/(despu[eé]s|luego|m[aá]s tarde|otro d[ií]a|ahorita no|por ahora no|en estos d[ií]as|la otra semana|el otro mes)/.test(s)) return 'luego';
  if (esNegacion(s) || /(no me interesa|ya no (lo |la |los )?(quiero|necesito)|no gracias|no,? gracias|no por el momento)/.test(s)) return 'no';
  const sobreElCarrito = /(carrito|link|enlace|terminar|completar|finalizar|retomar|pagar|comprar|lo quiero|los quiero|la quiero|las quiero|me interesa|de una|h[aá]gale|me lo (env|mand)|c[oó]mo (lo )?(compro|pago|termino))/.test(s);
  if (sobreElCarrito || esIntencionCompra(s) || esIntencionPago(s)) return 'si';
  // Un "sí" o un saludo corto es respuesta al recordatorio; una pregunta sobre
  // otra cosa ("buenas, ¿hacen envíos a Rionegro?") la atiende el flujo normal.
  const corto = s.split(/\s+/).filter(Boolean).length <= 6 && !s.includes('?');
  if (corto && (esConfirmacion(s) || esSaludo(s) || /^(s[ií]|claro|dale|listo|ok|va|bueno|porfa|por favor)(?=$|[\s,.!])/.test(s))) return 'si';
  return null;
}

/** Recordatorio de carrito al que el cliente aún no ha respondido, si es el último mensaje del bot. */
export function recordatorioPendiente(context: BotContext, ahora = Date.now()) {
  const ultimoBot = [...context.mensajes_previos].reverse().find((m) => m.tipo === 'bot');
  const md = ultimoBot?.metadata as Record<string, any> | undefined;
  if (!ultimoBot || md?.evento !== 'carrito_recuperacion' || !md?.carrito_url) return null;
  if (ahora - new Date(ultimoBot.created_at).getTime() > VIGENCIA_MS) return null;
  return { url: String(md.carrito_url), productos: String(md.carrito_productos || 'tus productos'), total: String(md.carrito_total || '') };
}

export function respuestaRecordatorioCarrito(texto: string, context: BotContext, ahora = Date.now()): BotResponse | null {
  const carrito = recordatorioPendiente(context, ahora);
  if (!carrito) return null;
  const tipo = clasificarRespuestaCarrito(texto);
  if (!tipo) return null;

  const primerNombre = context.cliente.nombre?.split(' ')[0];
  const nombre = primerNombre ? `, ${primerNombre}` : '';
  // Conserva el estado del bot (un carrito suyo a medias, por ejemplo)
  const metadata = { ...(context.estado?.datos || {}), evento: 'carrito_respuesta' };

  if (tipo === 'si') {
    return {
      texto:
        `¡Claro${nombre}! 🛒 Tu carrito sigue guardado:\n\n` +
        `• ${carrito.productos}${carrito.total ? `\n💰 *Total: ${carrito.total}*` : ''}\n\n` +
        `Termina tu compra aquí 👇\n${carrito.url}\n\n` +
        `Si quieres cambiar algo o tienes alguna duda, escríbeme por aquí 😊`,
      metadata,
    };
  }
  if (tipo === 'luego') {
    return {
      texto: `¡Claro, sin afán${nombre}! 😊 Tu carrito queda guardado. Cuando quieras terminar tu compra, entra aquí:\n${carrito.url}`,
      metadata,
    };
  }
  if (tipo === 'ya_compro') {
    return { texto: `¡Qué bien${nombre}! 🙌 Gracias por tu compra. Si necesitas algo con tu pedido, escríbenos por aquí.`, metadata };
  }
  return { texto: `¡Entendido${nombre}! Gracias por contarnos 🙌 Si más adelante necesitas algo, aquí estamos.`, metadata };
}
