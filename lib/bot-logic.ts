// ============================================
// LÓGICA DEL BOT - Máquina de estados completa
// ============================================
// Estados (guardados en metadata del último mensaje bot):
//   awaiting: 'compra'           → mostró producto, esperando si compra
//   awaiting: 'cantidad'         → esperando cuántas unidades
//   awaiting: 'carrito'          → ítem agregado, esperando agregar más o pagar
//   awaiting: 'direccion'        → esperando dirección de envío
//   awaiting: 'confirmacion'     → resumen mostrado, esperando confirmar/cancelar
//   awaiting: 'link_enviado'     → link de pago Wompi ya enviado en el chat
//   awaiting: 'mayorista_sede'   → detección mayorista, esperando sede del cliente
// NOTA: El método de pago lo elige el cliente directamente en el link de Wompi
//       (Tarjeta, PSE, Nequi, Daviplata) — no se pregunta en el chat.
// ============================================

import type { BotContext, BotResponse, Producto } from '@/types';
import { obtenerProductosCache, actualizarCliente, supabaseAdmin } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto } from './shopify';
import { procesarMensajeSofi } from './ai-sofi';
import { enviarMensajeWhatsApp } from './whatsapp';

const USE_AI = !!process.env.OPENAI_API_KEY;

const COSTO_ENVIO = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA_ENVIOS = (process.env.SHIPPING_COVERAGE || '').split(',').map((c) => c.trim());

// Sedes físicas con teléfonos para lead mayorista
const SEDES_FISICAS: Record<string, { nombre: string; telefono: string }> = {
  '1': { nombre: 'CC Tesoro', telefono: '573156125533' },
  '2': { nombre: 'CC Fabricato', telefono: '573175402082' },
  '3': { nombre: 'Autopista Sur - Itagüí', telefono: '573183349171' },
  '4': { nombre: 'Gran Manzana - Itagüí', telefono: '573156125765' },
  '5': { nombre: 'Mall Indiana', telefono: '573185608348' },
  '6': { nombre: 'Urabá - Apartadó', telefono: '573160173928' },
};

// Banco de términos por producto (brief)
const ALIASES_PRODUCTO: Array<{ palabrasClave: string[]; tituloContiene: string }> = [
  { palabrasClave: ['esencial', 'caldas esencial', 'licor caldas', 'licor de ron'], tituloContiene: 'esencial' },
  { palabrasClave: ['3 años', 'tres años', 'tradicional', 'ron viejo tradicional', 'caldas tradicional'], tituloContiene: 'tradicional' },
  { palabrasClave: ['oscuro', 'caldas oscuro', 'ron oscuro', 'nuevo ron oscuro'], tituloContiene: 'oscuro' },
  { palabrasClave: ['juan de la cruz', '5 años', 'cinco años', 'juan cruz', 'caldas 5 años', 'caldas juan'], tituloContiene: 'juan' },
  { palabrasClave: ['carta de oro', '8 años', 'ocho años', 'caldas 8 años', 'caldas carta'], tituloContiene: 'carta de oro' },
  { palabrasClave: ['gran reserva', '15 años', 'quince años', 'gre', 'gran reserva especial', 'caldas gran reserva'], tituloContiene: 'gran reserva' },
  { palabrasClave: ['leon dormido', 'léon dormido', '21 años', 'veintiun años', 'doble roble'], tituloContiene: 'dormido' },
  { palabrasClave: ['molendero', 'licor de caña', 'caña molendero'], tituloContiene: 'molendero' },
  { palabrasClave: ['cheers', 'crema ron', 'crema caldas', 'crema de ron'], tituloContiene: 'cheers' },
  { palabrasClave: ['roble blanco', 'ron blanco', 'caldas blanco', 'cocteleria', 'cocteleria'], tituloContiene: 'roble blanco' },
  { palabrasClave: ['amarillo', 'manzanares', 'aguardiente amarillo', 'amarillo de manzanares', 'aguardiente caldas'], tituloContiene: 'amarillo' },
];

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

  // Leer estado actual del último mensaje bot
  const ultimoBot = [...context.mensajes_previos].reverse().find((m) => m.tipo === 'bot');
  const awaiting: string = ultimoBot?.metadata?.awaiting || '';
  const pendingProductId: string = ultimoBot?.metadata?.pending_product_id || '';
  const pendingCantidad: number = ultimoBot?.metadata?.pending_cantidad || 1;
  const pendingDireccion: string = ultimoBot?.metadata?.pending_direccion || '';
  const pendingCart: CartItem[] = ultimoBot?.metadata?.pending_cart || [];
  const pendingTotal: number = ultimoBot?.metadata?.pending_total || 0;
  const pendingSubtotal: number = ultimoBot?.metadata?.pending_subtotal || 0;
  const pendingCostoEnvio: number = ultimoBot?.metadata?.pending_costo_envio || 0;

  // ── POLÍTICAS: cliente nuevo debe aceptar antes de interactuar ─────
  if (!context.cliente.politicas_aceptadas) {
    if (/^(acepto|si acepto|accept|aceptar|de acuerdo|ok acepto|s[íi] acepto)$/i.test(textoLower)) {
      await actualizarCliente(context.cliente.id, { politicas_aceptadas: true });
      return {
        texto:
          `✅ *¡Gracias por aceptar nuestras políticas!*\n\n` +
          `🏪 *¿Cuál es la sede más cercana a ti?*\n\n` +
          `*1.* 🌐 Virtual (envío a domicilio)\n` +
          `*2.* 🏬 CC Tesoro\n` +
          `*3.* 🏬 CC Fabricato\n` +
          `*4.* 🏬 Autopista Sur - Itagüí\n` +
          `*5.* 🏬 Gran Manzana - Itagüí\n` +
          `*6.* 🏬 Mall Indiana\n` +
          `*7.* 🏬 Urabá - Apartadó\n\n` +
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
    const SEDES_REGISTRO: Record<string, string> = {
      '1': 'Virtual',
      '2': 'CC Tesoro',
      '3': 'CC Fabricato',
      '4': 'Autopista Sur - Itagüí',
      '5': 'Gran Manzana - Itagüí',
      '6': 'Mall Indiana',
      '7': 'Urabá - Apartadó',
    };
    const sedeElegida = SEDES_REGISTRO[texto.trim()];
    if (sedeElegida) {
      await actualizarCliente(context.cliente.id, { sede_preferida: sedeElegida });
      const nombre = context.cliente.nombre ? ` ${context.cliente.nombre.split(' ')[0]}` : '';
      return {
        texto:
          `🏪 *Sede ${sedeElegida}* seleccionada. ¡Perfecto${nombre}!\n\n` +
          `Soy Sofi, tu asesora de ventas 24/7 ✨\n\n` +
          `Cuéntame, ¿en qué te puedo ayudar hoy? Puedes preguntarme por cualquier producto, presupuesto de regalo, envíos o lo que necesites. 😊`,
        metadata: { awaiting: '' },
      };
    }
    if (awaiting === 'sede') {
      return {
        texto:
          `Por favor elige tu sede escribiendo el número:\n\n` +
          `*1.* 🌐 Virtual\n*2.* 🏬 CC Tesoro\n*3.* 🏬 CC Fabricato\n` +
          `*4.* 🏬 Autopista Sur - Itagüí\n*5.* 🏬 Gran Manzana - Itagüí\n` +
          `*6.* 🏬 Mall Indiana\n*7.* 🏬 Urabá - Apartadó`,
        metadata: { awaiting: 'sede' },
      };
    }
  }

  // ── CANCELAR siempre disponible ───────────────────────────────────
  if (/^(cancelar|cancel|no quiero|no gracias|salir|stop)$/i.test(textoLower)) {
    return {
      texto: '✅ Pedido cancelado. Cuando quieras, cuéntame qué necesitas y te ayudo. 😊',
      metadata: { awaiting: '' },
    };
  }

  // ── VER CARRITO: comando disponible en cualquier momento ──────────
  if (/^(carrito|mi carrito|ver carrito|ver pedido)$/i.test(textoLower)) {
    if (pendingCart.length === 0) {
      return {
        texto: '🛒 Tu carrito está vacío. Cuéntame qué producto te interesa y te ayudo. 😊',
        metadata: { awaiting: '' },
      };
    }
    return respuestaCarrito(pendingCart);
  }

  // ── MAYORISTA: detección antes de Sofi (solo sin flujo activo de compra) ─
  if (awaiting === '' && esMayorista(textoLower)) {
    return respuestaMayoristaOpciones(context, texto);
  }

  // ── SOFI IA: maneja toda conversación libre (sin estado de checkout activo)
  if (USE_AI && awaiting === '') {
    return await procesarMensajeSofi(texto, context, pendingCart);
  }

  // ── MÁQUINA DE ESTADOS ─────────────────────────────────────────

  // Estado: esperando elección de sede mayorista
  if (awaiting === 'mayorista_sede') {
    const sede = SEDES_FISICAS[texto.trim()];
    if (sede) {
      const mensajeOriginal: string = ultimoBot?.metadata?.pending_mayorista_mensaje || '';
      await enviarLeadASede(sede, context, mensajeOriginal);
      return {
        texto:
          `✅ ¡Perfecto! Tu consulta fue enviada a nuestra sede *${sede.nombre}*.\n\n` +
          `Un asesor especializado en compras al por mayor te contactará pronto. 😊\n\n` +
          `_Tienda Commerk Antioquia_`,
        metadata: { awaiting: '' },
      };
    }
    return {
      texto:
        `Por favor escribe el *número* de la sede:\n\n` +
        `*1.* 🏬 CC Tesoro\n*2.* 🏬 CC Fabricato\n*3.* 🏬 Autopista Sur - Itagüí\n` +
        `*4.* 🏬 Gran Manzana - Itagüí\n*5.* 🏬 Mall Indiana\n*6.* 🏬 Urabá - Apartadó`,
      metadata: {
        awaiting: 'mayorista_sede',
        pending_mayorista_mensaje: ultimoBot?.metadata?.pending_mayorista_mensaje || '',
      },
    };
  }

  // Estado: esperando confirmación de compra (sí/no)
  if (awaiting === 'compra') {
    if (esConfirmacion(textoLower)) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (!producto) return respuestaDefault(pendingCart);
      return {
        texto: `¿Cuántas unidades de *${producto.titulo}* quieres?\n\nResponde con el número (ej: *1*, *2*, *3*).`,
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
          ? `¡Sin problema! 😊\n\n${textoCarritoResumen(pendingCart)}\n\nEscribe *pagar* para finalizar o cuéntame qué más necesitas.`
          : '¡Sin problema! 😊 Cuéntame qué más necesitas o pregúntame por otro producto.',
        metadata: { awaiting: pendingCart.length > 0 ? 'carrito' : '', pending_cart: pendingCart },
      };
    }
  }

  // Estado: esperando cantidad
  if (awaiting === 'cantidad') {
    const cantidad = extraerCantidad(texto);

    // Mayorista: más de 12 unidades
    if (cantidad && cantidad > 12) {
      return respuestaMayoristaOpciones(context, `Quiero ${cantidad} unidades`);
    }

    if (cantidad && cantidad > 0 && cantidad <= 12) {
      const productos = await obtenerProductosCache();
      const producto = productos.find((p) => p.shopify_id === pendingProductId);
      if (!producto) return respuestaDefault(pendingCart);

      if (producto.inventario < cantidad) {
        return {
          texto: `⚠️ Solo tenemos *${producto.inventario}* unidades disponibles de este producto.\n\n¿Cuántas quieres? (máximo ${producto.inventario})`,
          metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId, pending_cart: pendingCart },
        };
      }

      // Agregar ítem al carrito (suma si ya existe)
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
    if (/^(agregar|seguir|m[aá]s|otro|añadir|agregar m[aá]s|m[aá]s productos|seguir comprando)$/i.test(textoLower)) {
      return {
        texto: '¡Claro! Cuéntame qué más te gustaría agregar. 😊',
        metadata: { awaiting: '', pending_cart: pendingCart },
      };
    }
    if (/^(pagar|pago|finalizar|proceder|checkout|ok|listo|si|s[íi]|dale|confirmar|adelante)$/i.test(textoLower)) {
      return {
        texto:
          `📍 *¿A qué dirección te enviamos?*\n\n` +
          `Escribe tu dirección completa con barrio/municipio.\n` +
          `_Ejemplo: Calle 50 #30-20, Barrio El Poblado, Medellín_\n\n` +
          `Cobertura: ${COBERTURA_ENVIOS.join(', ')}`,
        metadata: { awaiting: 'direccion', pending_cart: pendingCart },
      };
    }
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

      // ✅ Generar link directo en el chat — el cliente elige método de pago en Wompi
      return {
        texto: '⏳ *Generando tu link de pago...*\n\nEn unos segundos te envío el enlace para que pagues de forma segura con Nequi, Daviplata, PSE o Tarjeta. 🔐',
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
        texto: '❌ Pedido cancelado. Cuando quieras, cuéntame qué necesitas y te ayudo. 😊',
        metadata: { awaiting: '' },
      };
    }
  }

  // Estado: link ya enviado — el cliente debe usar el link que recibió en el chat
  if (awaiting === 'link_enviado') {
    if (/(pagu[eé]|ya pagu[eé]|hice el pago|realic[eé] el pago|pag[ué])/i.test(textoLower)) {
      return {
        texto: '✅ ¡Perfecto! En cuanto Wompi confirme el pago, te avisamos aquí mismo y procesamos tu pedido. ¡Gracias por comprar con nosotros! 🎉',
        metadata: { awaiting: 'link_enviado' },
      };
    }
    // Si el cliente pregunta por el link, recordarle que ya fue enviado
    if (/(link|enlace|pago|pagar|donde|c[oó]mo pago)/i.test(textoLower)) {
      return {
        texto: '🔗 El link de pago ya fue enviado arriba en esta misma conversación. ¡Solo haz clic en él para pagar con Nequi, Daviplata, PSE o Tarjeta! 💳\n\n_Si no lo ves, desplázate hacia arriba._',
        metadata: { awaiting: 'link_enviado' },
      };
    }
  }

  // ── FLUJO NORMAL (sin estado pendiente) ───────────────────────
  if (esSaludo(textoLower)) return respuestaSaludo(context, pendingCart);
  if (esConsultaEnvio(textoLower)) return respuestaEnvio(pendingCart);

  if (/^(tienda|web|sitio|p[aá]gina|website|online|comprar online)$/i.test(textoLower)) {
    return {
      texto: `🌐 *Visita nuestra tienda online:*\nhttps://tiendacommerkant.com.co\n\nEncuentra todos nuestros productos, promociones y más. 🛍️`,
      metadata: { awaiting: '', pending_cart: pendingCart },
    };
  }

  if (esAgradecimiento(textoLower)) return respuestaAgradecimiento(pendingCart);

  // Detección de producto por nombre o alias del banco de términos
  const productoMatch = await detectarProducto(textoLower);
  if (productoMatch) return respuestaProducto(productoMatch, pendingCart);

  if (esIntencionCompra(textoLower)) {
    if (USE_AI) return await procesarMensajeSofi(texto, context, pendingCart);
    return {
      texto: '¿Qué producto te gustaría comprar? Cuéntame el nombre o para qué ocasión es y te recomiendo. 😊',
      metadata: { awaiting: '', pending_cart: pendingCart },
    };
  }

  return respuestaDefault(pendingCart);
}

// ──────────────────────────────────────────
// MAYORISTA
// ──────────────────────────────────────────

function esMayorista(t: string): boolean {
  return /(compra al mayor|mayorista|para mi negocio|para el negocio|volumen|precio especial|por mayor|al por mayor)/i.test(t);
}

function respuestaMayoristaOpciones(context: BotContext, mensajeOriginal: string): BotResponse {
  const nombre = context.cliente.nombre?.split(' ')[0];
  return {
    texto:
      `¡Hola${nombre ? ` ${nombre}` : ''}! Para compras al por mayor te conectamos directamente con la sede más cercana. 🏪\n\n` +
      `¿Cuál tienda te queda más cerca?\n\n` +
      `*1.* 🏬 CC Tesoro\n` +
      `*2.* 🏬 CC Fabricato\n` +
      `*3.* 🏬 Autopista Sur - Itagüí\n` +
      `*4.* 🏬 Gran Manzana - Itagüí\n` +
      `*5.* 🏬 Mall Indiana\n` +
      `*6.* 🏬 Urabá - Apartadó`,
    metadata: { awaiting: 'mayorista_sede', pending_mayorista_mensaje: mensajeOriginal },
  };
}

async function enviarLeadASede(
  sede: { nombre: string; telefono: string },
  context: BotContext,
  mensajeOriginal: string
) {
  const nombre = context.cliente.nombre || 'Sin nombre';
  const telefono = context.cliente.telefono;

  const mensajeLead =
    `📋 *Nuevo lead mayorista — Commerk Bot*\n\n` +
    `👤 Cliente: ${nombre}\n` +
    `📱 Tel: +${telefono}\n` +
    `💬 Consulta: "${mensajeOriginal || 'compra al por mayor'}"\n\n` +
    `_Responde directamente a este número para atender al cliente._`;

  await enviarMensajeWhatsApp(sede.telefono, mensajeLead);

  await supabaseAdmin
    .from('leads_sedes')
    .insert({
      cliente_id: context.cliente.id,
      telefono_cliente: telefono,
      nombre_cliente: nombre,
      sede: sede.nombre,
      telefono_sede: sede.telefono,
      mensaje_original: mensajeOriginal || 'compra al por mayor',
      conversacion_id: context.conversacion?.id || null,
    })
    .then(({ error }) => {
      if (error) console.error('[Lead sede] Error guardando:', error.message);
    });
}

// ──────────────────────────────────────────
// DETECTORES
// ──────────────────────────────────────────

function esSaludo(t: string) {
  return /^(hola|buenas|buenos|hey|ola|saludos|buen d[íi]a|buenas tardes|buenas noches)/i.test(t);
}
function esIntencionCompra(t: string) {
  return /(comprar|quiero comprar|quiero pedir|quiero uno|dame uno|me interesa|añadir|agregar)/i.test(t);
}
function esConsultaEnvio(t: string) {
  return /(envio|env[íi]o|entregan|llevan|despachan|cobertura|domicilio|delivery)/i.test(t);
}
function esAgradecimiento(t: string) {
  return /^(gracias|muchas gracias|chevere|ch[eé]vere|excelente|perfecto|genial|ok gracias|listo gracias)/i.test(t);
}
function esConfirmacion(t: string) {
  return /^(si|s[íi]|yes|dale|ok|listo|confirmar|confirmo|proceder|adelante|claro|por supuesto|va)$/i.test(t.trim());
}
function esNegacion(t: string) {
  return /^(no|nope|cancel|cancelar|no gracias|dejalo|d[eé]jalo)$/i.test(t.trim());
}
function extraerCantidad(t: string): number | null {
  const num = parseInt(t.replace(/[^0-9]/g, ''));
  return isNaN(num) ? null : num;
}

function quitarAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function detectarProducto(texto: string): Promise<Producto | null> {
  const productos = await obtenerProductosCache();
  const t = quitarAcentos(texto);

  // Primero: banco de alias del brief
  for (const alias of ALIASES_PRODUCTO) {
    const coincide = alias.palabrasClave.some((k) => t.includes(quitarAcentos(k)));
    if (coincide) {
      const prod = productos.find((p) =>
        quitarAcentos(p.titulo.toLowerCase()).includes(quitarAcentos(alias.tituloContiene))
      );
      if (prod) return prod;
    }
  }

  // Fallback: palabras largas del título
  return (
    productos.find((p) => {
      const titulo = quitarAcentos(p.titulo.toLowerCase());
      const palabras = titulo.split(' ').filter((w) => w.length > 3);
      return palabras.some((w) => t.includes(w));
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
      `Soy Sofi, tu asesora de ventas 24/7 ✨\n\n` +
      `Cuéntame, ¿en qué te puedo ayudar? Puedes preguntarme por productos, precios, regalos, envíos o lo que necesites. 😊` +
      avisoCarrito,
    metadata: { awaiting: '', pending_cart: cart },
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
      : `\n¿Lo quieres? Responde *SI* para comprar o pregúntame por otro producto.`;
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
      `¿Necesitas algo más? Cuéntame. 😊` + avisoCarrito,
    metadata: { awaiting: cart.length > 0 ? 'carrito' : '', pending_cart: cart },
  };
}

function respuestaAgradecimiento(cart: CartItem[] = []): BotResponse {
  const avisoCarrito = cart.length > 0
    ? `\n\n🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito. Escribe *carrito* para verlo._`
    : '';
  return {
    texto: '¡De nada! 😊 Aquí estoy 24/7 para lo que necesites.' + avisoCarrito,
    metadata: { awaiting: cart.length > 0 ? 'carrito' : '', pending_cart: cart },
  };
}

function respuestaDefault(cart: CartItem[] = []): BotResponse {
  const avisoCarrito = cart.length > 0
    ? `\n\n🛒 _Tienes ${cart.length} producto${cart.length !== 1 ? 's' : ''} en tu carrito. Escribe *carrito* para verlo._`
    : '';
  return {
    texto:
      `Disculpa, no entendí bien. 🤔\n\n` +
      `Puedes preguntarme por cualquier producto, presupuesto de regalo, envíos o lo que necesites.\n\n` +
      `¿En qué te puedo ayudar?` + avisoCarrito,
    metadata: { awaiting: cart.length > 0 ? 'carrito' : '', pending_cart: cart },
  };
}
