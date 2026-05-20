// ============================================
// LÓGICA DEL BOT - Máquina de estados completa
// ============================================
// Estados del pedido (guardados en metadata del último mensaje bot):
//   awaiting: 'compra'       → mostró producto, esperando si compra
//   awaiting: 'cantidad'     → esperando cuántas unidades
//   awaiting: 'carrito'      → ítem agregado, mostró carrito, esperando agregar más o pagar
//   awaiting: 'direccion'    → esperando dirección de envío
//   awaiting: 'confirmacion' → resumen mostrado, esperando confirmar/cancelar
//   awaiting: 'link_enviado' → link de pago ya fue enviado
// ============================================

import type { BotContext, BotResponse, Producto } from '@/types';
import { obtenerProductosCache, actualizarCliente } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto } from './shopify';
import { procesarMensajeSofi } from './ai-sofi';

// Sofi IA activa siempre que ANTHROPIC_API_KEY esté configurada
const USE_AI = !!process.env.ANTHROPIC_API_KEY;

const COSTO_ENVIO = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA_ENVIOS = (process.env.SHIPPING_COVERAGE || '').split(',').map((c) => c.trim());

export interface CartItem {
  shopify_id: string;
  titulo: string;
  precio: number;
  cantidad: number;
}

export interface PedidoPendiente {
  items: CartItem[];
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
  const pendingCatalogIds: string[] = ultimoBot?.metadata?.pending_catalog_ids || [];
  const pendingCart: CartItem[] = ultimoBot?.metadata?.pending_cart || [];
  const pendingTotal: number = ultimoBot?.metadata?.pending_total || 0;
  const pendingSubtotal: number = ultimoBot?.metadata?.pending_subtotal || 0;
  const pendingCostoEnvio: number = ultimoBot?.metadata?.pending_costo_envio || 0;

  // ── POLÍTICAS: cliente nuevo debe aceptar antes de interactuar ─────
  if (!context.cliente.politicas_aceptadas) {
    if (/^(acepto|si acepto|accept|aceptar|de acuerdo|ok acepto|sí acepto)$/i.test(textoLower)) {
      await actualizarCliente(context.cliente.id, { politicas_aceptadas: true });
      return {
        texto:
          `✅ *¡Gracias por aceptar nuestras políticas!*\n\n` +
          `🏪 *¿Cuál es la sede más cercana a ti?*\n\n` +
          `*1.* 🌐 Virtual (envío a domicilio)\n` +
          `*2.* 🏬 CC Tesoro\n` +
          `*3.* 🏬 CC Gran Manzana\n` +
          `*4.* 🏬 Mall Indiana\n` +
          `*5.* 🏬 Apartadó\n` +
          `*6.* 🏬 Itagüi\n` +
          `*7.* 🏬 CC Fabricato\n\n` +
          `_Escribe el número de tu sede._`,
        metadata: { awaiting: 'sede' },
      };
    }
    return {
      texto:
        `¡Hola! 👋 Bienvenido a *Tienda Commerk Antioquia*.\n\n` +
        `Antes de continuar, debes aceptar nuestras *políticas de privacidad*:\n` +
        `🔒 https://tiendacommerkant.com.co/policies/privacy-policy\n\n` +
        `🌐 Visita nuestra tienda: https://tiendacommerkant.com.co\n\n` +
        `Responde *ACEPTO* para continuar. Al hacerlo, aceptas el tratamiento de tus datos personales conforme a nuestra política de privacidad.`,
      metadata: { awaiting: 'politicas' },
    };
  }

  // ── SEDE: cliente aceptó políticas pero no ha elegido sede ─────────
  if (awaiting === 'sede' || !context.cliente.sede_preferida) {
    const SEDES: Record<string, string> = {
      '1': 'Virtual', '2': 'CC Tesoro', '3': 'CC Gran Manzana',
      '4': 'Mall Indiana', '5': 'Apartadó', '6': 'Itagüi', '7': 'CC Fabricato',
    };
    const sedeElegida = SEDES[texto.trim()];
    if (sedeElegida) {
      await actualizarCliente(context.cliente.id, { sede_preferida: sedeElegida });
      const nombre = context.cliente.nombre ? ` ${context.cliente.nombre.split(' ')[0]}` : '';
      return {
        texto:
          `🏪 *Sede ${sedeElegida}* seleccionada. ¡Perfecto${nombre}!\n\n` +
          `Soy Sofi, tu asistente de ventas 24/7 🤖✨\n\n` +
          `📋 *catálogo* — Ver todos los productos\n` +
          `🚚 *envíos* — Cobertura y costos\n` +
          `🌐 *tienda* — Ver tienda online\n\n` +
          `¿En qué te puedo ayudar?`,
        metadata: { awaiting: '' },
      };
    }
    if (awaiting === 'sede') {
      return {
        texto: `Por favor elige tu sede escribiendo el número:\n\n*1.* 🌐 Virtual\n*2.* 🏬 CC Tesoro\n*3.* 🏬 CC Gran Manzana\n*4.* 🏬 Mall Indiana\n*5.* 🏬 Apartadó\n*6.* 🏬 Itagüi\n*7.* 🏬 CC Fabricato`,
        metadata: { awaiting: 'sede' },
      };
    }
  }

  // ── CANCELAR siempre disponible ───────────────────────────────────
  if (/^(cancelar|cancel|no quiero|no gracias|salir|stop)$/i.test(textoLower)) {
    return {
      texto: '✅ Pedido cancelado. Cuando quieras comprar, solo dime el nombre del producto.\n\nEscribe *catálogo* para ver lo que tenemos.',
      metadata: { awaiting: '' },
    };
  }

  // ── VER CARRITO: comando disponible en cualquier momento ──────────
  if (/^(carrito|mi carrito|ver carrito|ver pedido)$/i.test(textoLower)) {
    if (pendingCart.length === 0) {
      return {
        texto: '🛒 Tu carrito está vacío.\n\nEscribe *catálogo* para ver los productos disponibles.',
        metadata: { awaiting: '' },
      };
    }
    return respuestaCarrito(pendingCart);
  }

  // ── CATÁLOGO siempre disponible ───────────────────────────────────
  if (esCatalogo(textoLower)) {
    try {
      console.log('[Bot] Catálogo solicitado por:', context.cliente.telefono);
      return await respuestaCatalogo(0, pendingCart);
    } catch (err) {
      console.error('[Bot] Error en respuestaCatalogo:', err);
      return {
        texto: 'Disculpa, tuve un problema cargando el catálogo. Escribe el nombre del producto que buscas y te ayudo. 😊',
        metadata: { awaiting: '', pending_cart: pendingCart },
      };
    }
  }

  // ── SOFI IA: maneja toda conversación libre (sin estado de checkout activo)
  if (USE_AI && awaiting === '') {
    return await procesarMensajeSofi(texto, context, pendingCart);
  }

  // ── MÁQUINA DE ESTADOS ─────────────────────────────────────────

  // Estado: esperando confirmación de compra (sí/no)
  if (awaiting === 'compra') {
    if (esConfirmacion(textoLower)) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (!producto) return respuestaDefault(pendingCart);
      return {
        texto: `¿Cuántas unidades de *${producto.titulo}* quieres?\n\nResponde con el número (ej: *1*, *2*, *3*) o escribe la cantidad.`,
        metadata: {
          awaiting: 'cantidad',
          pending_product_id: producto.shopify_id,
          pending_cart: pendingCart,
        },
      };
    }
    if (esNegacion(textoLower)) {
      return {
        texto: pendingCart.length > 0
          ? `¡Sin problema! 😊\n\n${textoCarritoResumen(pendingCart)}\n\nEscribe *pagar* para finalizar o *catálogo* para seguir explorando.`
          : '¡Sin problema! 😊 ¿Te gustaría ver otros productos?\n\nEscribe *catálogo* para explorar.',
        metadata: { awaiting: pendingCart.length > 0 ? 'carrito' : '', pending_cart: pendingCart },
      };
    }
  }

  // Estado: esperando cantidad
  if (awaiting === 'cantidad') {
    const cantidad = extraerCantidad(texto);
    if (cantidad && cantidad > 0 && cantidad <= 20) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (!producto) return respuestaDefault(pendingCart);

      if (producto.inventario < cantidad) {
        return {
          texto: `⚠️ Solo tenemos *${producto.inventario}* unidades disponibles de este producto.\n\n¿Cuántas quieres? (máximo ${producto.inventario})`,
          metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId, pending_cart: pendingCart },
        };
      }

      // Agregar ítem al carrito (si ya existe el mismo producto, sumar cantidad)
      const itemExistente = pendingCart.findIndex((i) => i.shopify_id === producto.shopify_id);
      let updatedCart: CartItem[];
      if (itemExistente >= 0) {
        updatedCart = pendingCart.map((item, idx) =>
          idx === itemExistente ? { ...item, cantidad: item.cantidad + cantidad } : item
        );
      } else {
        updatedCart = [
          ...pendingCart,
          { shopify_id: producto.shopify_id, titulo: producto.titulo, precio: producto.precio, cantidad },
        ];
      }

      return respuestaCarrito(updatedCart);
    }
    return {
      texto: '¿Cuántas unidades quieres? Escribe solo el número (ej: *1*, *2*, *3*)',
      metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId, pending_cart: pendingCart },
    };
  }

  // Estado: carrito mostrado — esperando "agregar más" o "pagar"
  if (awaiting === 'carrito') {
    // Agregar más productos → mostrar catálogo numerado directamente
    if (/^(agregar|seguir|más|mas|otro|añadir|agregar más|más productos|seguir comprando|ver catálogo)$/i.test(textoLower)) {
      return await respuestaCatalogo(0, pendingCart);
    }
    // Proceder al pago
    if (/^(pagar|pago|finalizar|proceder|checkout|ok|listo|si|sí|dale|confirmar|adelante)$/i.test(textoLower)) {
      return {
        texto:
          `📍 *¿A qué dirección te enviamos?*\n\n` +
          `Escribe tu dirección completa con barrio/municipio.\n` +
          `_Ejemplo: Calle 50 #30-20, Barrio El Poblado, Medellín_\n\n` +
          `Cobertura: ${COBERTURA_ENVIOS.join(', ')}`,
        metadata: { awaiting: 'direccion', pending_cart: pendingCart },
      };
    }
    // Si escribe algo más, re-mostrar el carrito con las opciones
    return respuestaCarrito(pendingCart);
  }

  // Estado: esperando dirección
  if (awaiting === 'direccion') {
    if (texto.length < 10) {
      return {
        texto: '📍 Por favor escribe la dirección completa con ciudad.\n_Ejemplo: Calle 50 #30-20, El Poblado, Medellín_',
        metadata: { awaiting: 'direccion', pending_cart: pendingCart },
      };
    }

    // Compatibilidad hacia atrás: si no hay carrito pero hay pending_product_id (flujo antiguo)
    let cart = pendingCart;
    if (cart.length === 0 && pendingProductId) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (producto) {
        cart = [{ shopify_id: producto.shopify_id, titulo: producto.titulo, precio: producto.precio, cantidad: pendingCantidad }];
      }
    }
    if (cart.length === 0) return respuestaDefault();

    const subtotal = cart.reduce((s, item) => s + item.precio * item.cantidad, 0);
    const costoEnvio = subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;
    const total = subtotal + costoEnvio;

    let resumen = `🛒 *RESUMEN DE TU PEDIDO*\n\n`;
    cart.forEach((item) => {
      resumen += `${asignarEmojiProducto(item.titulo)} *${item.titulo}*\n`;
      resumen += `  ${item.cantidad} ud × ${formatearPrecioCOP(item.precio)} = *${formatearPrecioCOP(item.precio * item.cantidad)}*\n\n`;
    });
    resumen += `─────────────────────\n`;
    resumen += `Subtotal: ${formatearPrecioCOP(subtotal)}\n`;
    resumen += `Envío: ${costoEnvio === 0 ? '🎁 *GRATIS*' : formatearPrecioCOP(costoEnvio)}\n`;
    resumen += `*TOTAL: ${formatearPrecioCOP(total)}*\n\n`;
    resumen += `📍 Dirección: ${texto}\n\n`;
    resumen += `¿Confirmamos el pedido?\n*SI* para pagar | *NO* para cancelar`;

    return {
      texto: resumen,
      metadata: {
        awaiting: 'confirmacion',
        pending_cart: cart,
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
      // Compatibilidad hacia atrás
      let cart = pendingCart;
      if (cart.length === 0 && pendingProductId) {
        const productos = await obtenerProductosCache();
        const producto = productos.find((p) => p.shopify_id === pendingProductId);
        if (producto) {
          cart = [{ shopify_id: producto.shopify_id, titulo: producto.titulo, precio: producto.precio, cantidad: pendingCantidad }];
        }
      }
      if (cart.length === 0) return respuestaDefault();

      const subtotal = pendingSubtotal || cart.reduce((s, i) => s + i.precio * i.cantidad, 0);
      const costoEnvio = pendingCostoEnvio !== undefined ? pendingCostoEnvio : (subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO);
      const total = pendingTotal || subtotal + costoEnvio;

      return {
        texto: '⏳ Generando tu link de pago seguro...',
        accion: 'generar_link_pago',
        metadata: {
          awaiting: 'link_enviado',
          pending_cart: cart,
          pending_direccion: pendingDireccion,
          pending_subtotal: subtotal,
          pending_costo_envio: costoEnvio,
          pending_total: total,
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

  // Estado: esperando número de selección del catálogo
  if (awaiting === 'catalogo_numero') {
    if (/^(más|mas|siguiente|next|ver más|ver mas|\+)$/i.test(textoLower)) {
      const paginaActual: number = ultimoBot?.metadata?.pending_catalog_page || 0;
      return await respuestaCatalogo(paginaActual + 1, pendingCart);
    }
    const num = extraerCantidad(texto);
    if (num && num >= 1 && num <= pendingCatalogIds.length) {
      const shopifyId = pendingCatalogIds[num - 1];
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === shopifyId);
      if (producto) return respuestaProducto(producto, pendingCart);
    }
    return {
      texto: `Escribe el *número* del producto (ej: *1*, *2*) o *más* para ver más.\n\nEscribe *catálogo* para volver al inicio.`,
      metadata: {
        awaiting: 'catalogo_numero',
        pending_catalog_ids: pendingCatalogIds,
        pending_catalog_page: ultimoBot?.metadata?.pending_catalog_page || 0,
        pending_cart: pendingCart,
      },
    };
  }

  // Estado: link ya enviado
  if (awaiting === 'link_enviado') {
    if (/(pagué|ya pagué|hice el pago|realicé el pago)/i.test(textoLower)) {
      return {
        texto: '✅ ¡Perfecto! En cuanto Wompi confirme el pago, te avisamos aquí mismo y procesamos tu pedido. ¡Gracias por comprar con nosotros! 🎉',
        metadata: { awaiting: 'link_enviado' },
      };
    }
  }

  // ── FLUJO NORMAL (sin estado pendiente) ───────────────────────

  if (esSaludo(textoLower)) return respuestaSaludo(context, pendingCart);

  if (esConsultaEnvio(textoLower)) return respuestaEnvio(pendingCart);

  if (/^(tienda|web|sitio|página|pagina|website|online|comprar online)$/i.test(textoLower)) {
    return {
      texto: `🌐 *Visita nuestra tienda online:*\nhttps://tiendacommerkant.com.co\n\nEncuentra todos nuestros productos, promociones y más. 🛍️`,
      metadata: { awaiting: '', pending_cart: pendingCart },
    };
  }

  if (esAgradecimiento(textoLower)) return respuestaAgradecimiento(pendingCart);

  // Detección de producto por nombre
  const productoMatch = await detectarProducto(textoLower);
  if (productoMatch) return respuestaProducto(productoMatch, pendingCart);

  // Intención de compra genérica sin producto seleccionado
  if (esIntencionCompra(textoLower)) {
    return {
      texto: '¿Qué producto te gustaría comprar? Escribe su nombre o escribe *catálogo* para ver todas las opciones.',
      metadata: { awaiting: '', pending_cart: pendingCart },
    };
  }

  return respuestaDefault(pendingCart);
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
// HELPERS DE CARRITO
// ──────────────────────────────────────────

function calcularTotalesCarrito(cart: CartItem[]) {
  const subtotal = cart.reduce((s, item) => s + item.precio * item.cantidad, 0);
  const costoEnvio = subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;
  const total = subtotal + costoEnvio;
  return { subtotal, costoEnvio, total };
}

function textoCarritoResumen(cart: CartItem[]): string {
  const { subtotal, costoEnvio, total } = calcularTotalesCarrito(cart);
  let msg = `🛒 *Tu carrito (${cart.length} producto${cart.length !== 1 ? 's' : ''}):*\n`;
  cart.forEach((item, i) => {
    msg += `${i + 1}. ${asignarEmojiProducto(item.titulo)} ${item.titulo} × ${item.cantidad} = ${formatearPrecioCOP(item.precio * item.cantidad)}\n`;
  });
  msg += `\nSubtotal: ${formatearPrecioCOP(subtotal)}`;
  msg += `\nEnvío: ${costoEnvio === 0 ? '🎁 GRATIS' : formatearPrecioCOP(costoEnvio)}`;
  msg += `\n*TOTAL: ${formatearPrecioCOP(total)}*`;
  return msg;
}

function respuestaCarrito(cart: CartItem[]): BotResponse {
  const msg =
    textoCarritoResumen(cart) +
    `\n\n¿Qué deseas hacer?\n` +
    `🛍️ *agregar* — Añadir otro producto\n` +
    `✅ *pagar* — Finalizar y pagar\n` +
    `❌ *cancelar* — Cancelar pedido`;

  return {
    texto: msg,
    metadata: { awaiting: 'carrito', pending_cart: cart },
  };
}

// ──────────────────────────────────────────
// RESPUESTAS
// ──────────────────────────────────────────

function respuestaSaludo(context: BotContext, cart: CartItem[] = []): BotResponse {
  const nombre = context.cliente.nombre ? ` ${context.cliente.nombre.split(' ')[0]}` : '';
  const avisoCarrito = cart.length > 0
    ? `\n\n🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito. Escribe *carrito* para verlo._`
    : '';
  return {
    texto:
      `¡Hola${nombre}! 👋 Bienvenido a *Tienda Commerk Antioquia*.\n\n` +
      `Soy tu asistente de ventas 24/7. Puedo ayudarte con:\n\n` +
      `📋 *catálogo* — Ver todos los productos\n` +
      `🚚 *envíos* — Cobertura y costos\n` +
      `🛒 Escribe el nombre del producto para comprarlo\n\n` +
      `¿En qué te puedo ayudar?` + avisoCarrito,
    metadata: { awaiting: '', pending_cart: cart },
  };
}

const CATALOGO_POR_PAGINA = 10;

async function respuestaCatalogo(pagina = 0, cart: CartItem[] = []): Promise<BotResponse> {
  const productos = await obtenerProductosCache();
  const conPrecio = productos.filter((p) => p.precio > 0);
  const todos = [
    ...conPrecio.filter((p) => p.inventario > 0),
    ...conPrecio.filter((p) => p.inventario <= 0),
  ];
  console.log('[Bot] Productos con precio:', todos.length, '| página:', pagina);

  if (todos.length === 0) {
    return { texto: '📋 No hay productos disponibles ahora. Escríbenos directamente y te ayudamos.', metadata: { awaiting: '', pending_cart: cart } };
  }

  const paginaReal = (pagina * CATALOGO_POR_PAGINA) >= todos.length ? 0 : pagina;
  const inicioReal = paginaReal * CATALOGO_POR_PAGINA;
  const finReal = Math.min(inicioReal + CATALOGO_POR_PAGINA, todos.length);
  const pagActual = todos.slice(inicioReal, finReal);
  const hayMas = finReal < todos.length;

  const encabezado = todos.length > CATALOGO_POR_PAGINA
    ? `📋 *CATÁLOGO COMMERK* (${inicioReal + 1}-${finReal} de ${todos.length})\n\n`
    : `📋 *CATÁLOGO COMMERK*\n\n`;

  let msg = encabezado;
  pagActual.forEach((p, i) => {
    const num = inicioReal + i + 1;
    const emoji = asignarEmojiProducto(p.titulo);
    const stock = p.inventario > 0 ? '✅' : '❌';
    msg += `*${num}.* ${emoji} ${p.titulo}\n💵 ${formatearPrecioCOP(p.precio)} ${stock}\n\n`;
  });

  if (cart.length > 0) {
    msg += `🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito._\n\n`;
  }

  if (hayMas) {
    msg += `_Escribe el *número* para ver el producto o *más* para ver los siguientes ${Math.min(CATALOGO_POR_PAGINA, todos.length - finReal)}._`;
  } else {
    msg += `_Escribe el *número* del producto para ver detalles y comprarlo._`;
  }

  return {
    texto: msg,
    metadata: {
      awaiting: 'catalogo_numero',
      pending_catalog_ids: todos.map((p) => p.shopify_id),
      pending_catalog_page: paginaReal,
      pending_cart: cart,
    },
  };
}

function respuestaProducto(producto: Producto, cart: CartItem[] = []): BotResponse {
  const emoji = asignarEmojiProducto(producto.titulo);
  const disponible = producto.inventario > 0;
  let msg = `${emoji} *${producto.titulo}*\n\n`;
  msg += `💵 Precio: *${formatearPrecioCOP(producto.precio)}*\n`;
  msg += disponible ? `✅ Disponible\n` : `❌ Agotado temporalmente\n`;
  if (producto.descripcion) msg += `\n${producto.descripcion.substring(0, 200)}\n`;
  msg += `\n📦 Envío gratis comprando más de ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}\n`;

  if (cart.length > 0) {
    msg += `\n🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito._\n`;
  }

  if (disponible) {
    msg += cart.length > 0
      ? `\n¿Lo agregas al carrito? Responde *SI* para agregar o *carrito* para ver tu pedido.`
      : `\n¿Lo quieres? Responde *SI* para comprar o *catálogo* para ver más.`;
  }

  return {
    texto: msg,
    metadata: {
      awaiting: disponible ? 'compra' : '',
      pending_product_id: producto.shopify_id,
      pending_cart: cart,
    },
  };
}

function respuestaEnvio(cart: CartItem[] = []): BotResponse {
  const avisoCarrito = cart.length > 0
    ? `\n\n🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito. Escribe *pagar* para finalizar._`
    : '';
  return {
    texto:
      `🚚 *COBERTURA DE ENVÍOS*\n\n` +
      `Municipios: ${COBERTURA_ENVIOS.join(', ')}\n\n` +
      `💵 Costo de envío: ${formatearPrecioCOP(COSTO_ENVIO)}\n` +
      `🎁 *GRATIS* en compras mayores a ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}\n\n` +
      `⏰ Entregas L-S en 24-48 horas\n\n` +
      `¿Te gustaría ver el catálogo? Escribe *catálogo*` + avisoCarrito,
    metadata: { awaiting: cart.length > 0 ? 'carrito' : '', pending_cart: cart },
  };
}

function respuestaAgradecimiento(cart: CartItem[] = []): BotResponse {
  const avisoCarrito = cart.length > 0
    ? `\n\n🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito. Escribe *carrito* para verlo._`
    : '';
  return {
    texto: '¡De nada! 😊 Estoy aquí 24/7 para ayudarte. Si necesitas algo más, solo escríbeme.' + avisoCarrito,
    metadata: { awaiting: cart.length > 0 ? 'carrito' : '', pending_cart: cart },
  };
}

function respuestaDefault(cart: CartItem[] = []): BotResponse {
  const avisoCarrito = cart.length > 0
    ? `\n\n🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito. Escribe *carrito* para verlo._`
    : '';
  return {
    texto:
      `Disculpa, no entendí bien tu mensaje. 🤔\n\n` +
      `Puedes escribir:\n` +
      `📋 *catálogo* — Ver productos\n` +
      `🚚 *envíos* — Cobertura y costos\n` +
      `🛒 *carrito* — Ver tu carrito\n` +
      `Nombre del producto — Para comprarlo\n\n` +
      `¿En qué te puedo ayudar?` + avisoCarrito,
    metadata: { awaiting: cart.length > 0 ? 'carrito' : '', pending_cart: cart },
  };
}
