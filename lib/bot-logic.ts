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
import { obtenerProductosCache, actualizarCliente, supabaseAdmin, obtenerPedidosClienteShopify } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto, obtenerPedidoShopifyPorId } from './shopify';
import { procesarMensajeSofi } from './ai-sofi';
import { enviarMensajeWhatsApp } from './whatsapp';
import { enviarLeadMayorista } from './whatsapp-templates';
import { SEDES_FISICAS, SEDES_MAYORISTA, PREFIJO_RECOGIDA, MENU_SEDES, MENU_SEDES_MAYORISTA, esRecogidaEnTienda, nombreSedeDesdeDireccion, encontrarSede } from './sedes';

const USE_AI = !!process.env.ANTHROPIC_API_KEY;

const COSTO_ENVIO = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA_ENVIOS = (process.env.SHIPPING_COVERAGE || '').split(',').map((c) => c.trim());

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
  let awaiting: string = ultimoBot?.metadata?.awaiting || '';

  // Expirar flujos de checkout abandonados: si el último mensaje del bot es
  // viejo, no dejamos al cliente "atascado" en un menú. Entra fresco y lo
  // atiende Sofi de forma conversacional (el carrito se conserva para retomarlo).
  const ESTADOS_CHECKOUT = ['compra', 'cantidad', 'carrito', 'tipo_entrega', 'recoger_sede', 'direccion', 'confirmacion', 'link_enviado', 'mayorista_sede'];
  if (awaiting && ESTADOS_CHECKOUT.includes(awaiting) && ultimoBot?.created_at) {
    const horasInactivo = (Date.now() - new Date(ultimoBot.created_at).getTime()) / 3_600_000;
    if (horasInactivo > 6) awaiting = '';
  }

  const pendingProductId: string = ultimoBot?.metadata?.pending_product_id || '';
  // Cola de productos cuando el cliente pide varios a la vez ("una botella y una garrafa")
  const pendingQueue: string[] = ultimoBot?.metadata?.pending_queue || [];
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
  // Solo pedir sede cuando NO hay un flujo activo (sin esto, un "3" para
  // cantidad se interpretaba como selección de sede #3).
  if (awaiting === 'sede' || (awaiting === '' && !context.cliente.sede_preferida)) {
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
  // Frases claras de cancelación total. La cancelación conversacional más
  // suelta ("no quiero ese", "quítalo") la maneja cada estado de menú.
  // OJO: en 'carrito' preguntamos "¿algo más?", así que "no gracias"/"no quiero"
  // ahí significan "nada más" (finalizar), no cancelar el pedido.
  const cancelarAmbiguo = awaiting === 'carrito' ? /^(cancelar|cancel|salir|stop)$/i : /^(cancelar|cancel|no quiero|no gracias|salir|stop)$/i;
  if (cancelarAmbiguo.test(textoLower) ||
      /cancela(r)?\s+(el\s+|mi\s+|la\s+)?(pedido|carrito|compra|todo|orden)/i.test(textoLower)) {
    return {
      texto: '✅ Pedido cancelado. Cuando quieras, cuéntame qué necesitas y te ayudo. 😊',
      metadata: { awaiting: '', pending_cart: [] },
    };
  }

  // ── VER CARRITO: comando disponible en cualquier momento ──────────
  if (/^(carrito|mi carrito|ver carrito|ver pedido)$/i.test(textoLower)) {
    // Si estamos esperando cantidad, pedir primero el número
    if ((awaiting === 'cantidad' || awaiting === 'compra') && pendingProductId) {
      const productos = await obtenerProductosCache();
      const prod = productos.find((p) => p.shopify_id === pendingProductId);
      if (prod) {
        return {
          texto: `¿Cuántas unidades de *${prod.titulo}* quieres agregar? Escribe el número y luego puedes ver el carrito. 😊`,
          metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId, pending_cart: pendingCart },
        };
      }
    }
    if (pendingCart.length === 0) {
      return {
        texto: '🛒 Tu carrito está vacío. Cuéntame qué producto te interesa y te ayudo. 😊',
        metadata: { awaiting: '' },
      };
    }
    return respuestaCarrito(pendingCart);
  }

  // ── ESTADO DE PEDIDO: consulta Shopify en tiempo real ─────────────
  // Solo sin carrito activo (con carrito, "finalizar mi pedido" es pago, no consulta).
  if (awaiting === '' && pendingCart.length === 0 && esConsultaPedido(textoLower)) {
    return await respuestaEstadoPedido(context);
  }

  // ── MAYORISTA: detección antes de Sofi (solo sin flujo activo de compra) ─
  if (awaiting === '' && esMayorista(textoLower)) {
    return respuestaMayoristaOpciones(context, texto);
  }

  // ── PAGO CON CARRITO ACTIVO: interceptar ANTES de Sofi ────────────
  // IMPORTANTE: solo cuando awaiting === '' (sin estado activo).
  // Si hay un estado activo (compra/confirmacion/cantidad), la máquina de estados
  // lo maneja abajo. Sin esta condición, "SI" en confirmación se intercepta aqui.
  if (awaiting === '' && pendingCart.length > 0 && esIntencionPago(textoLower)) {
    return preguntarTipoEntrega(pendingCart);
  }

  // ── COMPRA DIRECTA: solo cuando hay alias ESPECÍFICO del banco de términos
  // No activar con búsquedas genéricas como "ron viejo" que pueden cogerse mal
  if (USE_AI && awaiting === '' && esIntencionCompra(textoLower)) {
    const tieneAliasEspecifico = ALIASES_PRODUCTO.some((a) =>
      a.palabrasClave.some((k) => incluyeTermino(textoLower, k))
    );
    if (tieneAliasEspecifico) {
      const productoDirecto = await detectarProducto(textoLower);
      if (productoDirecto && productoDirecto.inventario > 0) {
        return {
          texto: `¡Perfecto! ¿Cuántas unidades de *${productoDirecto.titulo}* quieres?\n\nEscribe el número (ej: *1*, *2*, *3*).`,
          metadata: {
            awaiting: 'cantidad',
            pending_product_id: productoDirecto.shopify_id,
            pending_cart: pendingCart,
          },
        };
      }
    }
    // Sin alias específico → Sofi pregunta cuál exactamente
  }

  // ── SOFI IA: maneja toda conversación libre (sin estado de checkout activo)
  if (USE_AI && awaiting === '') {
    const respuestaSofi = await procesarMensajeSofi(texto, context, pendingCart);

    // Sofi detectó que el cliente quiere cerrar → el CÓDIGO toma el control
    // del checkout (entrega → dirección → confirmación → link de Wompi).
    const cierre = await checkoutDesdeSofi(respuestaSofi, pendingCart, pendingProductId, pendingCantidad);
    if (cierre) return cierre;

    return respuestaSofi;
  }

  // ── MÁQUINA DE ESTADOS ─────────────────────────────────────────

  // Estado: esperando elección de sede mayorista
  if (awaiting === 'mayorista_sede') {
    const sede = encontrarSede(texto, SEDES_MAYORISTA);
    if (sede) {
      const mensajeOriginal: string = ultimoBot?.metadata?.pending_mayorista_mensaje || '';
      await enviarLeadASede(sede, context, mensajeOriginal);
      return {
        texto:
          `✅ ¡Listo! Ya le pasé tus datos a nuestra sede *${sede.nombre}*.\n\n` +
          `Un asesor de compras al por mayor te va a escribir a este mismo número (+${context.cliente.telefono}) para darte precios y condiciones especiales. 😊\n\n` +
          `Mientras tanto, si quieres, cuéntame qué productos te interesan y te voy adelantando información.`,
        metadata: { awaiting: '' },
      };
    }
    return {
      texto:
        `Por favor escribe el *número* de la sede:\n\n` +
        MENU_SEDES_MAYORISTA,
      metadata: {
        awaiting: 'mayorista_sede',
        pending_mayorista_mensaje: ultimoBot?.metadata?.pending_mayorista_mensaje || '',
      },
    };
  }

  // Estado: esperando confirmación de compra (sí/no)
  // Sofi ahora va directo a 'cantidad', pero 'compra' sigue como fallback
  if (awaiting === 'compra') {
    if (esNegacion(textoLower)) {
      return {
        texto: pendingCart.length > 0
          ? `¡Sin problema! 😊\n\n${textoCarritoResumen(pendingCart)}\n\nEscribe *pagar* para finalizar o cuéntame qué más necesitas.`
          : '¡Sin problema! 😊 Cuéntame qué más necesitas o pregúntame por otro producto.',
        metadata: { awaiting: pendingCart.length > 0 ? 'carrito' : '', pending_cart: pendingCart },
      };
    }
    // Cualquier respuesta afirmativa o número → ir directo a cantidad
    const productos = await obtenerProductosCache();
    const producto = productos.find((p) => p.shopify_id === pendingProductId);
    if (!producto) return respuestaDefault(pendingCart);
    return {
      texto: `¿Cuántas unidades de *${producto.titulo}* quieres?\n\nEscribe el número (ej: *1*, *2*, *3*).`,
      metadata: {
        awaiting: 'cantidad',
        pending_product_id: producto.shopify_id,
        pending_cart: pendingCart,
      },
    };
  }

  // Estado: esperando cantidad
  if (awaiting === 'cantidad') {
    // "una y una" → [1,1]: si pidió varios productos, aplica cantidades en orden
    const cantidades = extraerCantidades(texto);
    const cantidad = cantidades[0] ?? null;

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
          texto: `⚠️ Solo tenemos *${producto.inventario}* unidades disponibles.\n\n¿Cuántas quieres? (máximo ${producto.inventario})`,
          metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId, pending_queue: pendingQueue, pending_cart: pendingCart },
        };
      }

      let updatedCart = agregarAlCarrito(pendingCart, producto, cantidad);

      // Quedan productos en cola (el cliente pidió varios a la vez)
      if (pendingQueue.length > 0) {
        const siguienteId = pendingQueue[0];
        const restoCola = pendingQueue.slice(1);
        const siguiente = productos.find((p) => p.shopify_id === siguienteId);

        if (siguiente) {
          // Si ya dio todas las cantidades de una ("una y una"), aplicarlas sin volver a preguntar
          const cantSiguiente = cantidades[1];
          if (cantSiguiente && cantSiguiente > 0 && cantSiguiente <= 12 && siguiente.inventario >= cantSiguiente) {
            updatedCart = agregarAlCarrito(updatedCart, siguiente, cantSiguiente);
            // Continuar con el resto de la cola, si queda
            if (restoCola.length > 0) {
              const tercero = productos.find((p) => p.shopify_id === restoCola[0]);
              if (tercero) {
                return {
                  texto: `¡Listo! Ahora, ¿cuántas unidades de *${tercero.titulo}* quieres?`,
                  metadata: { awaiting: 'cantidad', pending_product_id: tercero.shopify_id, pending_queue: restoCola.slice(1), pending_cart: updatedCart },
                };
              }
            }
            return respuestaCarrito(updatedCart);
          }

          return {
            texto: `¡Listo! Agregué *${producto.titulo}* ×${cantidad}.\n\nAhora, ¿cuántas unidades de *${siguiente.titulo}* quieres?`,
            metadata: { awaiting: 'cantidad', pending_product_id: siguienteId, pending_queue: restoCola, pending_cart: updatedCart },
          };
        }
      }

      return respuestaCarrito(updatedCart);
    }

    // No es un número — si quiere cancelar o cambiar, resetear
    if (esNegacion(textoLower) || /cancelar|otro producto|no quiero ese|cambiar/i.test(textoLower)) {
      return {
        texto: '¡Sin problema! Cuéntame qué producto te interesa. 😊',
        metadata: { awaiting: '', pending_cart: pendingCart },
      };
    }

    // Nunca llamar a Sofi cuando hay un flujo de cantidad activo — solo pedir el número
    const productos2 = await obtenerProductosCache();
    const prod2 = productos2.find((p) => p.shopify_id === pendingProductId);
    const nombreProd = prod2?.titulo || 'ese producto';
    return {
      texto: `¿Cuántas unidades de *${nombreProd}* quieres?\n\nEscribe solo el número (ej: *1*, *2*, *3*). Si quieres otro producto escribe *cancelar*.`,
      metadata: { awaiting: 'cantidad', pending_product_id: pendingProductId, pending_queue: pendingQueue, pending_cart: pendingCart },
    };
  }

  // Estado: carrito mostrado — atención conversacional (sin menús de opciones)
  if (awaiting === 'carrito') {
    // 1) "Nada más" → finalizar. Va PRIMERO porque aquí preguntamos "¿algo más?",
    //    así que "no", "no gracias" o "no quiero nada" significan cerrar el pedido.
    const nadaMas = /^(no|nop|no gracias|no quiero( nada)?( m[aá]s)?|nada m[aá]s|ya no|eso es todo|es todo|as[ií] est[aá] bien|ya est[aá]|listo as[ií])$/i.test(texto.trim());
    if (
      nadaMas ||
      esConfirmacion(textoLower) ||
      /(pagar|pago|finalizar|finalicemos|finaliza|proceder|checkout|cerrar|terminar|termina|nada m[aá]s|eso es todo)/i.test(textoLower)
    ) {
      return preguntarTipoEntrega(pendingCart);
    }
    // 2) Se arrepintió / quiere quitar algo
    if (esCancelacion(textoLower)) {
      // "cancela todo" / "todo" → vaciar sin preguntar
      const quiereTodo = /(todo|el pedido completo|la compra|el carrito)/i.test(textoLower);
      if (quiereTodo) {
        return {
          texto: 'Listo, cancelé el pedido completo 😊\n\nCuando quieras retomamos, cuéntame qué necesitas.',
          metadata: { awaiting: '', pending_cart: [] },
        };
      }

      // ¿Nombró un producto puntual del carrito? → quitar solo ese
      const prodMencionado = await detectarProducto(textoLower);
      if (prodMencionado && pendingCart.some((i) => i.shopify_id === prodMencionado.shopify_id)) {
        const nuevoCart = pendingCart.filter((i) => i.shopify_id !== prodMencionado.shopify_id);
        if (nuevoCart.length === 0) {
          return {
            texto: `Listo, quité *${prodMencionado.titulo}* 👌\n\nCuéntame qué estás buscando y te ayudo a encontrar algo que te guste. 😊`,
            metadata: { awaiting: '', pending_cart: [] },
          };
        }
        const r = respuestaCarrito(nuevoCart);
        return { ...r, texto: `Listo, quité *${prodMencionado.titulo}* 👌\n\n${r.texto}` };
      }

      // Varios productos y no dijo cuál → preguntamos en vez de borrar todo
      if (pendingCart.length > 1) {
        return {
          texto: `Claro 😊 ¿Quieres que quite algún producto en particular o prefieres que cancelemos todo el pedido?`,
          metadata: { awaiting: 'carrito', pending_cart: pendingCart },
        };
      }

      return {
        texto: 'Listo, sin problema 😊 Te quité el pedido.\n\nCuéntame qué estás buscando y con gusto te ayudo a encontrar algo que te guste.',
        metadata: { awaiting: '', pending_cart: [] },
      };
    }
    // 3) Quiere añadir algo más
    if (/(agregar|agrego|añadir|a[ñn]ado|sumar|seguir|otro|otra|algo m[aá]s|una cosa m[aá]s|tambi[eé]n quiero|ver m[aá]s)/i.test(textoLower)) {
      return {
        texto: '¡Claro! Cuéntame qué más te gustaría llevar. 😊',
        metadata: { awaiting: '', pending_cart: pendingCart },
      };
    }
    // 4) Cualquier otra cosa (una pregunta, otro producto...) → que la atienda Sofi.
    //    Si Sofi entiende que quiere cerrar, arranca el checkout de verdad.
    if (USE_AI) {
      const r = await procesarMensajeSofi(texto, context, pendingCart);
      const cierre = await checkoutDesdeSofi(r, pendingCart, pendingProductId, pendingCantidad);
      return cierre ?? r;
    }
    return respuestaCarrito(pendingCart);
  }

  // Estado: elegir tipo de entrega (domicilio o recoger en tienda)
  if (awaiting === 'tipo_entrega') {
    if (esCancelacion(textoLower)) {
      return {
        texto: '✅ Listo, cancelé tu pedido. Cuando quieras seguimos. 😊',
        metadata: { awaiting: '', pending_cart: [] },
      };
    }
    // Recoger en tienda (se evalúa primero: "paso por él" es más específico)
    if (/^2$/.test(textoLower) || /(recoger|recojo|recoge|recogerlo|paso por|pasar por|paso a|retiro|retirar|en tienda|en la tienda|tienda f[ií]sica|f[ií]sica|recogida|voy por)/i.test(textoLower)) {
      return preguntarSedeRecogida(pendingCart);
    }
    // Domicilio
    if (/^1$/.test(textoLower) || /(domicilio|env[ií]o|env[ií]en|env[ií]ar|env[ií]amelo|mandar|m[aá]ndamelo|a mi casa|a casa|entrega|que llegue)/i.test(textoLower)) {
      return {
        texto:
          `📍 Perfecto, ¿a qué dirección te lo enviamos?\n\n` +
          `Escríbeme la dirección completa con barrio o municipio.\n` +
          `_Ejemplo: Calle 50 #30-20, Barrio El Poblado, Medellín_\n\n` +
          `Cubrimos: ${COBERTURA_ENVIOS.join(', ')}`,
        metadata: { awaiting: 'direccion', pending_cart: pendingCart },
      };
    }
    // No quedó claro (ej. "¿cuánto vale el envío?") → Sofi resuelve la duda,
    // pero seguimos esperando la elección de entrega.
    if (USE_AI) {
      const r = await procesarMensajeSofi(texto, context, pendingCart);
      if (!r.accion && !r.metadata?.awaiting) {
        return {
          texto: `${r.texto}\n\n¿Entonces te lo enviamos a domicilio o lo recoges en tienda?`,
          metadata: { awaiting: 'tipo_entrega', pending_cart: pendingCart },
        };
      }
      return r;
    }
    return preguntarTipoEntrega(pendingCart);
  }

  // Estado: elegir sede para recoger en tienda
  if (awaiting === 'recoger_sede') {
    if (esCancelacion(textoLower)) {
      return {
        texto: '✅ Listo, cancelé tu pedido. Cuando quieras seguimos. 😊',
        metadata: { awaiting: '', pending_cart: [] },
      };
    }
    const sede = encontrarSede(texto, SEDES_FISICAS);
    if (!sede) {
      return preguntarSedeRecogida(pendingCart);
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

    // Recoger en tienda = SIN costo de envío
    const subtotal = cart.reduce((s, item) => s + item.precio * item.cantidad, 0);
    const costoEnvio = 0;
    const total = subtotal;

    let resumen = `🛒 *RESUMEN DE TU PEDIDO*\n\n`;
    cart.forEach((item) => {
      resumen += `${asignarEmojiProducto(item.titulo)} *${item.titulo}*\n`;
      resumen += `  ${item.cantidad} ud × ${formatearPrecioCOP(item.precio)} = *${formatearPrecioCOP(item.precio * item.cantidad)}*\n\n`;
    });
    resumen += `─────────────────────\n`;
    resumen += `Subtotal: ${formatearPrecioCOP(subtotal)}\n`;
    resumen += `Entrega: 🏪 *Recoges en ${sede.nombre}*\n`;
    resumen += `*TOTAL: ${formatearPrecioCOP(total)}*\n\n`;
    resumen += `¿Confirmamos el pedido?\n*SI* para pagar | *NO* para cancelar`;

    return {
      texto: resumen,
      metadata: {
        awaiting: 'confirmacion',
        pending_cart: cart,
        pending_direccion: `${PREFIJO_RECOGIDA}${sede.nombre}`,
        pending_subtotal: subtotal,
        pending_costo_envio: costoEnvio,
        pending_total: total,
      },
    };
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
    if (esNegacion(textoLower) || esCancelacion(textoLower)) {
      return {
        texto: '❌ Pedido cancelado. Cuando quieras, cuéntame qué necesitas y te ayudo. 😊',
        metadata: { awaiting: '', pending_cart: [] },
      };
    }
    // Dijo otra cosa (una duda): Sofi responde y CONSERVAMOS el pedido armado,
    // si no se perderían dirección y totales y habría que empezar de cero.
    const metaConfirmacion = {
      awaiting: 'confirmacion',
      pending_cart: pendingCart,
      pending_direccion: pendingDireccion,
      pending_subtotal: pendingSubtotal,
      pending_costo_envio: pendingCostoEnvio,
      pending_total: pendingTotal,
    };
    if (USE_AI) {
      const r = await procesarMensajeSofi(texto, context, pendingCart);
      return {
        texto: `${r.texto}\n\n¿Confirmamos entonces tu pedido? Responde *SI* para pagar.`,
        metadata: metaConfirmacion,
      };
    }
    return {
      texto: '¿Confirmamos tu pedido? Responde *SI* para pagar o *NO* para cancelar.',
      metadata: metaConfirmacion,
    };
  }

  // Estado: link ya enviado — el cliente debe usar el link que recibió en el chat
  if (awaiting === 'link_enviado') {
    if (/(pagu[eé]|ya pagu[eé]|hice el pago|realic[eé] el pago|pag[ué])/i.test(textoLower)) {
      return {
        texto: '✅ ¡Perfecto! En cuanto Wompi confirme el pago, te avisamos aquí mismo y procesamos tu pedido. ¡Gracias por comprar con nosotros! 🎉',
        metadata: { awaiting: 'link_enviado', pending_cart: pendingCart },
      };
    }
    // Si el cliente pregunta por el link, recordarle que ya fue enviado
    if (/(link|enlace|pago|pagar|donde|c[oó]mo pago)/i.test(textoLower)) {
      return {
        texto: '🔗 El link de pago ya fue enviado arriba en esta misma conversación. ¡Solo haz clic en él para pagar con Nequi, Daviplata, PSE o Tarjeta! 💳\n\n_Si no lo ves, desplázate hacia arriba._',
        metadata: { awaiting: 'link_enviado', pending_cart: pendingCart },
      };
    }
    // Cualquier otra duda: la responde Sofi sin sacar al cliente del proceso de pago
    if (USE_AI) {
      const r = await procesarMensajeSofi(texto, context, pendingCart);
      if (!r.accion && !r.metadata?.awaiting) {
        return { texto: r.texto, metadata: { awaiting: 'link_enviado', pending_cart: pendingCart } };
      }
      return r;
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
      MENU_SEDES_MAYORISTA,
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

  // 1) Plantilla aprobada: llega siempre, incluso fuera de la ventana de 24h
  let entregado = await enviarLeadMayorista(
    sede.telefono,
    sede.nombre,
    nombre,
    `+${telefono}`,
    mensajeOriginal || 'Compra al por mayor'
  ).catch(() => false);

  // 2) Respaldo en texto libre mientras Meta aprueba la plantilla
  if (!entregado) {
    try {
      const res: any = await enviarMensajeWhatsApp(sede.telefono, mensajeLead);
      entregado = res !== false;
    } catch (e: any) {
      console.error(`[Lead sede] FALLÓ el envío a ${sede.nombre} (${sede.telefono}):`, e?.message);
    }
  }
  if (!entregado) {
    console.error(`[Lead sede] El lead de ${nombre} (+${telefono}) NO llegó a ${sede.nombre}. Revisar plantilla lead_mayorista / ventana 24h.`);
  }

  const { error } = await supabaseAdmin
    .from('leads_sedes')
    .insert({
      cliente_id: context.cliente.id,
      telefono_cliente: telefono,
      nombre_cliente: nombre,
      sede: sede.nombre,
      telefono_sede: sede.telefono,
      mensaje_original: mensajeOriginal || 'compra al por mayor',
      conversacion_id: context.conversacion?.id || null,
    });
  if (error) console.error('[Lead sede] Error guardando:', error.message);
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
function esIntencionPago(t: string) {
  // SOLO frases explícitas de pago — NO incluir "si/ok/listo/dale/confirmar"
  // porque esas palabras son respuestas de confirmación en la máquina de estados.
  return /(^pagar$|^pago$|^finalizar$|^proceder$|^checkout$|proceder con el pago|quiero pagar|finalizar (la |mi )?compra|finalizar (el |mi )?pedido|realizar (el |mi )?pago|completar (la |mi )?compra|completar (el |mi )?pedido|ir a pagar|procesar (el |mi )?pago|quiero proceder|listo para pagar|dame el total|quiero el total)/i.test(t.trim());
}
function esConsultaEnvio(t: string) {
  return /(envio|env[íi]o|entregan|llevan|despachan|cobertura|domicilio|delivery)/i.test(t);
}
function esConsultaPedido(t: string): boolean {
  return /(estado (de )?(mi|el)? ?(pedido|orden|compra|env[íi]o)|c[oó]mo va mi (pedido|orden|compra|env[íi]o)|d[oó]nde (está|va) mi (pedido|orden|compra|env[íi]o)|mi (pedido|orden|compra)|ya (lo )?(enviaron|despacharon|mandaron)|cu[aá]ndo (me )?(llega|lo entregan|lo reciben)|rastrear|rastreo|seguimiento|tracking|gu[íi]a de env[íi]o|n[uú]mero de gu[íi]a)/i.test(t.trim());
}

// Traducción de estados de Shopify a español
function estadoPagoEspanol(fin?: string | null): string {
  const m: Record<string, string> = {
    paid: 'Confirmado ✅',
    pending: 'Pendiente ⏳',
    authorized: 'Autorizado',
    partially_paid: 'Pago parcial',
    refunded: 'Reembolsado',
    partially_refunded: 'Reembolso parcial',
    voided: 'Anulado',
    cancelled: 'Cancelado ❌',
  };
  return m[fin || ''] || (fin || 'Por confirmar');
}
function estadoEnvioEspanol(ful?: string | null): string {
  if (!ful || ful === 'null') return 'En preparación 📦';
  const m: Record<string, string> = {
    fulfilled: 'Despachado 🚚',
    partial: 'Despacho parcial 🚚',
    restocked: 'Reintegrado',
    unfulfilled: 'En preparación 📦',
  };
  return m[ful] || ful;
}

async function respuestaEstadoPedido(context: BotContext): Promise<BotResponse> {
  const telefono = context.cliente.telefono;
  const pedidos = await obtenerPedidosClienteShopify(telefono, context.cliente.id);

  if (pedidos.length === 0) {
    return {
      texto:
        `🔎 No encuentro pedidos asociados a tu número. 🤔\n\n` +
        `Si compraste hace pocos minutos, dame un momentico y vuelve a preguntar. ` +
        `Si tienes el *número de pedido*, escríbemelo y lo reviso. 😊`,
      metadata: { awaiting: '', pending_cart: [] },
    };
  }

  // Tomar el pedido más reciente y consultar Shopify en TIEMPO REAL
  const ultimo = pedidos[0];
  const orderRT = await obtenerPedidoShopifyPorId(ultimo.shopify_order_id);

  const numero = orderRT?.order_number ?? ultimo.shopify_order_number;
  const finStatus = orderRT?.financial_status ?? ultimo.estado_financiero;
  const fulStatus = orderRT?.fulfillment_status ?? ultimo.estado_fulfillment;
  const total = orderRT ? parseFloat(orderRT.total_price) : Number(ultimo.total);
  const items = orderRT?.line_items ?? ultimo.items ?? [];
  const direccion = ultimo.direccion_envio;

  const lineas = (items as any[])
    .map((i) => `• ${i.title} × ${i.quantity}`)
    .join('\n');

  // Tracking si ya fue despachado
  const fulfillment = orderRT?.fulfillments?.[0];
  const trackingNum = fulfillment?.tracking_number;
  const trackingCompany = fulfillment?.tracking_company;
  const trackingUrl = fulfillment?.tracking_url || fulfillment?.tracking_urls?.[0];

  const esRecoge = typeof direccion === 'string' && esRecogidaEnTienda(direccion);
  const entregaLinea = esRecoge
    ? `🏪 Recoges en: *${nombreSedeDesdeDireccion(direccion as string)}*`
    : `🚚 Envío: *${estadoEnvioEspanol(fulStatus)}*`;

  let texto =
    `📦 *Pedido #${numero}*\n` +
    `${lineas}\n\n` +
    `💳 Pago: *${estadoPagoEspanol(finStatus)}*\n` +
    `${entregaLinea}\n` +
    `💵 Total: *${formatearPrecioCOP(total)}*\n`;

  if (trackingNum) {
    texto += `\n📍 Guía: *${trackingCompany || 'Transportadora'} ${trackingNum}*\n`;
    if (trackingUrl) texto += `${trackingUrl}\n`;
  }

  texto += `\n¿Te ayudo con algo más? 😊`;

  return {
    texto,
    metadata: { awaiting: '', pending_cart: [] },
  };
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
// Cancelar/quitar en lenguaje natural ("no quiero ese", "quítalo", "me arrepentí", "cambié de opinión")
function esCancelacion(t: string): boolean {
  const s = t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /(cancel(a|ar|o|emos)?|anul(a|ar|o)|no\s+(lo\s+|los\s+|me\s+)?quiero|ya\s+no\s+(lo\s+)?quiero|quita(me|lo|los|r)?|saca(me|lo|los|r)?|borra(lo|los|r|me)?|elimina(lo|los|r)?|olvida(lo|r)?|mejor\s+no|dejalo\s+asi|empezar\s+de\s+(nuevo|cero)|reinicia(r)?|vaciar?\s+(el\s+)?carrito|me\s+arrepent(i|im)|me\s+arrepiento|cambie\s+de\s+(opinion|idea|parecer)|ya\s+no\s+lo\s+llevo|dev(u|o)elve)/i.test(s);
}
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

// Agrega un producto al carrito (suma la cantidad si ya existe)
function agregarAlCarrito(cart: CartItem[], producto: Producto, cantidad: number): CartItem[] {
  const idx = cart.findIndex((i) => i.shopify_id === producto.shopify_id);
  if (idx >= 0) {
    return cart.map((item, i) => (i === idx ? { ...item, cantidad: item.cantidad + cantidad } : item));
  }
  return [...cart, { shopify_id: producto.shopify_id, titulo: producto.titulo, precio: producto.precio, cantidad }];
}

// Extrae TODAS las cantidades en orden: "una y una" → [1,1] · "2 y 3" → [2,3]
function extraerCantidades(t: string): number[] {
  const lower = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

function extraerCantidad(t: string): number | null {
  return extraerCantidades(t)[0] ?? null;
}

function quitarAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Match por palabra completa (evita que "5 años" coincida dentro de "15 años")
function incluyeTermino(texto: string, termino: string): boolean {
  const t = quitarAcentos(texto.toLowerCase());
  const k = quitarAcentos(termino.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${k}(\\W|$)`).test(t);
}

async function detectarProducto(texto: string): Promise<Producto | null> {
  const productos = await obtenerProductosCache();
  const t = quitarAcentos(texto);

  // Primero: banco de alias del brief
  for (const alias of ALIASES_PRODUCTO) {
    const coincide = alias.palabrasClave.some((k) => incluyeTermino(texto, k));
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
  // Atención humana: preguntamos con naturalidad, sin menú de opciones.
  const msg = textoCarritoResumen(cart) + `\n\n¿Finalizamos tu pedido o quieres añadir algo más? 😊`;

  return {
    texto: msg,
    metadata: { awaiting: 'carrito', pending_cart: cart },
  };
}

/**
 * Sofi solo DETECTA que el cliente quiere cerrar; el checkout lo ejecuta el
 * código. Si la señal llegó, devuelve la respuesta del flujo; si no, null.
 */
async function checkoutDesdeSofi(
  respuestaSofi: BotResponse,
  pendingCart: CartItem[],
  pendingProductId: string,
  pendingCantidad: number
): Promise<BotResponse | null> {
  if ((respuestaSofi as any).accion !== 'iniciar_checkout') return null;

  // Usar el carrito, o reconstruirlo desde el producto pendiente
  let cart = pendingCart;
  if (cart.length === 0 && pendingProductId) {
    const productos = await obtenerProductosCache();
    const prod = productos.find((p) => p.shopify_id === pendingProductId);
    if (prod) {
      cart = [{ shopify_id: prod.shopify_id, titulo: prod.titulo, precio: prod.precio, cantidad: pendingCantidad || 1 }];
    }
  }
  if (cart.length === 0) return null;

  // Arrancamos por la entrega (no saltamos pasos del flujo real)
  const entrega = preguntarTipoEntrega(cart);
  const intro = respuestaSofi.texto?.trim();
  return intro ? { ...entrega, texto: `${intro}\n\n${entrega.texto}` } : entrega;
}

function preguntarTipoEntrega(cart: CartItem[]): BotResponse {
  return {
    texto: `¡Perfecto! ¿Te lo enviamos a domicilio o prefieres recogerlo en una de nuestras tiendas? 🛵🏪`,
    metadata: { awaiting: 'tipo_entrega', pending_cart: cart },
  };
}

function preguntarSedeRecogida(cart: CartItem[]): BotResponse {
  return {
    texto:
      `¡Buenísimo! ¿En cuál de nuestras tiendas te queda mejor recogerlo? 🏪\n\n` +
      `${MENU_SEDES}\n\n` +
      `Dime el nombre o el número de la que prefieras.`,
    metadata: { awaiting: 'recoger_sede', pending_cart: cart },
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
