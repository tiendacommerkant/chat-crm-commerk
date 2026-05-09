// ============================================
// LÓGICA DEL BOT - Máquina de estados completa
// ============================================
// Estados del pedido (guardados en metadata del último mensaje bot):
//   awaiting: 'compra'       → mostró producto, esperando si compra
//   awaiting: 'cantidad'     → esperando cuántas unidades
//   awaiting: 'direccion'    → esperando dirección de envío
//   awaiting: 'confirmacion' → resumen mostrado, esperando confirmar/cancelar
//   awaiting: 'link_enviado' → link de pago ya fue enviado
// ============================================

import type { BotContext, BotResponse, Producto } from '@/types';
import { obtenerProductosCache } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto } from './shopify';

const COSTO_ENVIO = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA_ENVIOS = (process.env.SHIPPING_COVERAGE || '').split(',').map((c) => c.trim());

export interface PedidoPendiente {
  producto: Producto;
  cantidad: number;
  direccion: string;
  subtotal: number;
  costo_envio: number;
  total: number;
}

export async function procesarMensajeBot(
  mensaje: string,
  context: BotContext
): Promise<BotResponse> {
  const texto = mensaje.trim();
  const textoLower = texto.toLowerCase();

  // Detectar estado actual leyendo el último mensaje del bot
  const ultimoBot = [...context.mensajes_previos].reverse().find((m) => m.tipo === 'bot');
  const awaiting: string = ultimoBot?.metadata?.awaiting || '';
  const pendingProductId: string = ultimoBot?.metadata?.pending_product_id || '';
  const pendingCantidad: number = ultimoBot?.metadata?.pending_cantidad || 1;
  const pendingDireccion: string = ultimoBot?.metadata?.pending_direccion || '';

  // ── CANCELAR siempre disponible ────────────────────────────────
  if (/^(cancelar|cancel|no quiero|no gracias|salir|stop)$/i.test(textoLower)) {
    return {
      texto: '✅ Pedido cancelado. Cuando quieras comprar, solo dime el nombre del producto.\n\nEscribe *catálogo* para ver lo que tenemos.',
      metadata: { awaiting: '' },
    };
  }

  // ── MÁQUINA DE ESTADOS ─────────────────────────────────────────

  // Estado: esperando confirmación de compra (sí/no)
  if (awaiting === 'compra') {
    if (esConfirmacion(textoLower)) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (!producto) return respuestaDefault();
      return {
        texto: `¿Cuántas unidades de *${producto.titulo}* quieres?\n\nResponde con el número (ej: *1*, *2*, *3*) o escribe la cantidad.`,
        metadata: {
          awaiting: 'cantidad',
          pending_product_id: producto.shopify_id,
        },
      };
    }
    if (esNegacion(textoLower)) {
      return {
        texto: '¡Sin problema! 😊 ¿Te gustaría ver otros productos?\n\nEscribe *catálogo* para explorar.',
        metadata: { awaiting: '' },
      };
    }
  }

  // Estado: esperando cantidad
  if (awaiting === 'cantidad') {
    const cantidad = extraerCantidad(texto);
    if (cantidad && cantidad > 0 && cantidad <= 20) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (!producto) return respuestaDefault();

      if (producto.inventario < cantidad) {
        return {
          texto: `⚠️ Solo tenemos *${producto.inventario}* unidades disponibles de este producto.\n\n¿Cuántas quieres? (máximo ${producto.inventario})`,
          metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId },
        };
      }

      return {
        texto: `📍 *¿A qué dirección te enviamos?*\n\nEscribe tu dirección completa con barrio/municipio.\n_Ejemplo: Calle 50 #30-20, Barrio El Poblado, Medellín_\n\nCobertura: ${COBERTURA_ENVIOS.join(', ')}`,
        metadata: {
          awaiting: 'direccion',
          pending_product_id: pendingProductId,
          pending_cantidad: cantidad,
        },
      };
    }
    return {
      texto: '¿Cuántas unidades quieres? Escribe solo el número (ej: *1*, *2*, *3*)',
      metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId },
    };
  }

  // Estado: esperando dirección
  if (awaiting === 'direccion') {
    if (texto.length < 10) {
      return {
        texto: '📍 Por favor escribe la dirección completa con ciudad.\n_Ejemplo: Calle 50 #30-20, El Poblado, Medellín_',
        metadata: { awaiting: 'direccion', pending_product_id: pendingProductId, pending_cantidad: pendingCantidad },
      };
    }
    const productos = await obtenerProductosCache();
    const producto = productos.find((p) => p.shopify_id === pendingProductId);
    if (!producto) return respuestaDefault();

    const subtotal = producto.precio * pendingCantidad;
    const costoEnvio = subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;
    const total = subtotal + costoEnvio;

    const resumen =
      `🛒 *RESUMEN DE TU PEDIDO*\n\n` +
      `${asignarEmojiProducto(producto.titulo)} ${producto.titulo}\n` +
      `Cantidad: ${pendingCantidad} unidad${pendingCantidad > 1 ? 'es' : ''}\n` +
      `Precio unit: ${formatearPrecioCOP(producto.precio)}\n` +
      `Subtotal: ${formatearPrecioCOP(subtotal)}\n` +
      `Envío: ${costoEnvio === 0 ? '🎁 *GRATIS*' : formatearPrecioCOP(costoEnvio)}\n` +
      `*TOTAL: ${formatearPrecioCOP(total)}*\n\n` +
      `📍 Dirección: ${texto}\n\n` +
      `¿Confirmamos el pedido?\n*SI* para pagar | *NO* para cancelar`;

    return {
      texto: resumen,
      metadata: {
        awaiting: 'confirmacion',
        pending_product_id: pendingProductId,
        pending_cantidad: pendingCantidad,
        pending_direccion: texto,
        pending_subtotal: subtotal,
        pending_costo_envio: costoEnvio,
        pending_total: total,
      },
    };
  }

  // Estado: esperando confirmación final del pedido
  if (awaiting === 'confirmacion') {
    if (esConfirmacion(textoLower)) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (!producto) return respuestaDefault();

      const subtotal = producto.precio * pendingCantidad;
      const costoEnvio = subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;
      const total = subtotal + costoEnvio;

      return {
        texto: '⏳ Generando tu link de pago seguro...',
        accion: 'generar_link_pago',
        metadata: {
          awaiting: 'link_enviado',
          pending_product_id: pendingProductId,
          pending_cantidad: pendingCantidad,
          pending_direccion: pendingDireccion,
          pending_total: total,
          pending_subtotal: subtotal,
          pending_costo_envio: costoEnvio,
          producto: {
            shopify_id: producto.shopify_id,
            titulo: producto.titulo,
            precio: producto.precio,
          },
        },
      };
    }
    if (esNegacion(textoLower)) {
      return {
        texto: '❌ Pedido cancelado. Cuando quieras, escribe el nombre del producto que deseas.\n\nEscribe *catálogo* para ver todos los productos.',
        metadata: { awaiting: '' },
      };
    }
  }

  // Estado: link ya enviado, cliente puede estar preguntando algo
  if (awaiting === 'link_enviado') {
    if (/(pagué|ya pagué|hice el pago|realicé el pago)/i.test(textoLower)) {
      return {
        texto: '✅ ¡Perfecto! En cuanto Wompi confirme el pago, te avisamos aquí mismo y procesamos tu pedido. ¡Gracias por comprar con nosotros! 🎉',
        metadata: { awaiting: 'link_enviado' },
      };
    }
  }

  // ── FLUJO NORMAL (sin estado pendiente) ───────────────────────

  if (esSaludo(textoLower)) return respuestaSaludo(context);

  if (esCatalogo(textoLower)) return await respuestaCatalogo();

  if (esConsultaEnvio(textoLower)) return respuestaEnvio();

  if (esAgradecimiento(textoLower)) return respuestaAgradecimiento();

  // Detección de producto por nombre
  const productoMatch = await detectarProducto(textoLower);
  if (productoMatch) return respuestaProducto(productoMatch);

  // Intención de compra genérica sin producto seleccionado
  if (esIntencionCompra(textoLower)) {
    return {
      texto: '¿Qué producto te gustaría comprar? Escribe su nombre o escribe *catálogo* para ver todas las opciones.',
      metadata: { awaiting: '' },
    };
  }

  return respuestaDefault();
}

// ──────────────────────────────────────────
// DETECTORES
// ──────────────────────────────────────────

function esSaludo(t: string) {
  return /^(hola|buenas|buenos|hey|ola|saludos|buen día|buen dia|buenas tardes|buenas noches)/i.test(t);
}
function esCatalogo(t: string) {
  return /(catalogo|catálogo|productos|que tienen|que venden|opciones|menu|menú|carta|ver todo)/i.test(t);
}
function esIntencionCompra(t: string) {
  return /(comprar|quiero comprar|quiero pedir|quiero uno|dame uno|me interesa|añadir|agregar)/i.test(t);
}
function esConsultaEnvio(t: string) {
  return /(envio|envío|entregan|llevan|despachan|cobertura|domicilio|delivery)/i.test(t);
}
function esAgradecimiento(t: string) {
  return /^(gracias|muchas gracias|chevere|chévere|excelente|perfecto|genial|ok gracias|listo gracias)/i.test(t);
}
function esConfirmacion(t: string) {
  return /^(si|sí|yes|dale|ok|listo|confirmar|confirmo|proceder|adelante|claro|por supuesto|va|s[íi])$/i.test(t.trim());
}
function esNegacion(t: string) {
  return /^(no|nope|cancel|cancelar|no gracias|dejalo|déjalo)$/i.test(t.trim());
}
function extraerCantidad(t: string): number | null {
  const num = parseInt(t.replace(/[^0-9]/g, ''));
  return isNaN(num) ? null : num;
}

async function detectarProducto(texto: string): Promise<Producto | null> {
  const productos = await obtenerProductosCache();
  return (
    productos.find((p) => {
      const titulo = p.titulo.toLowerCase();
      const palabras = titulo.split(' ').filter((w) => w.length > 3);
      return palabras.some((w) => texto.includes(w));
    }) || null
  );
}

// ──────────────────────────────────────────
// RESPUESTAS
// ──────────────────────────────────────────

function respuestaSaludo(context: BotContext): BotResponse {
  const nombre = context.cliente.nombre ? ` ${context.cliente.nombre.split(' ')[0]}` : '';
  return {
    texto:
      `¡Hola${nombre}! 👋 Bienvenido a *Tienda Commerk Antioquia*.\n\n` +
      `Soy tu asistente de ventas 24/7. Puedo ayudarte con:\n\n` +
      `📋 *catálogo* — Ver todos los productos\n` +
      `🚚 *envíos* — Cobertura y costos\n` +
      `🛒 Escribe el nombre del producto para comprarlo\n\n` +
      `¿En qué te puedo ayudar?`,
    metadata: { awaiting: '' },
  };
}

async function respuestaCatalogo(): Promise<BotResponse> {
  const productos = await obtenerProductosCache();
  if (productos.length === 0) {
    return { texto: 'Lo siento, no hay productos disponibles ahora. Intenta más tarde.', metadata: { awaiting: '' } };
  }
  let msg = '📋 *CATÁLOGO COMMERK*\n\n';
  productos.slice(0, 8).forEach((p) => {
    const emoji = asignarEmojiProducto(p.titulo);
    const stock = p.inventario > 0 ? '✅' : '❌ Agotado';
    msg += `${emoji} *${p.titulo}*\n💵 ${formatearPrecioCOP(p.precio)} ${stock}\n\n`;
  });
  msg += '_Escribe el nombre del producto que te interesa para ver detalles y comprarlo._';
  return { texto: msg, metadata: { awaiting: '' } };
}

function respuestaProducto(producto: Producto): BotResponse {
  const emoji = asignarEmojiProducto(producto.titulo);
  const disponible = producto.inventario > 0;
  let msg = `${emoji} *${producto.titulo}*\n\n`;
  msg += `💵 Precio: *${formatearPrecioCOP(producto.precio)}*\n`;
  msg += disponible ? `✅ Disponible (${producto.inventario} en stock)\n` : `❌ Agotado temporalmente\n`;
  if (producto.descripcion) msg += `\n${producto.descripcion.substring(0, 200)}\n`;
  msg += `\n📦 Envío gratis comprando más de ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}\n`;
  if (disponible) msg += `\n¿Lo quieres? Responde *SI* para comprar o *catálogo* para ver más.`;

  return {
    texto: msg,
    metadata: {
      awaiting: disponible ? 'compra' : '',
      pending_product_id: producto.shopify_id,
    },
  };
}

function respuestaEnvio(): BotResponse {
  return {
    texto:
      `🚚 *COBERTURA DE ENVÍOS*\n\n` +
      `Municipios: ${COBERTURA_ENVIOS.join(', ')}\n\n` +
      `💵 Costo de envío: ${formatearPrecioCOP(COSTO_ENVIO)}\n` +
      `🎁 *GRATIS* en compras mayores a ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}\n\n` +
      `⏰ Entregas L-S en 24-48 horas\n\n` +
      `¿Te gustaría ver el catálogo? Escribe *catálogo*`,
    metadata: { awaiting: '' },
  };
}

function respuestaAgradecimiento(): BotResponse {
  return {
    texto: '¡De nada! 😊 Estoy aquí 24/7 para ayudarte. Si necesitas algo más, solo escríbeme.',
    metadata: { awaiting: '' },
  };
}

function respuestaDefault(): BotResponse {
  return {
    texto:
      `Disculpa, no entendí bien tu mensaje. 🤔\n\n` +
      `Puedes escribir:\n` +
      `📋 *catálogo* — Ver productos\n` +
      `🚚 *envíos* — Cobertura y costos\n` +
      `🛒 Nombre del producto — Para comprarlo\n\n` +
      `¿En qué te puedo ayudar?`,
    metadata: { awaiting: '' },
  };
}
