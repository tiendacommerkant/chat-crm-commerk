// ============================================================
// SOFI — Agente IA de ventas de Tienda Commerk
// ============================================================
// Maneja conversación completa: preguntas del negocio,
// recomendaciones inteligentes (regalos, ocasiones, presupuesto),
// detección de intención de compra y transferencia al asesor.
//
// El flujo de checkout (cantidad → dirección → pago) sigue en
// bot-logic.ts para máxima confiabilidad.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { BotContext, BotResponse } from '@/types';
import type { CartItem } from './bot-logic';
import { obtenerProductosCache } from './supabase';
import { formatearPrecioCOP, asignarEmojiProducto } from './shopify';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COSTO_ENVIO        = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA          = (process.env.SHIPPING_COVERAGE || 'Medellín').split(',').map((c) => c.trim());
const BUSINESS_NAME      = process.env.BUSINESS_NAME || 'Tienda Commerk Antioquia';

export async function procesarMensajeSofi(
  mensaje: string,
  context: BotContext,
  pendingCart: CartItem[] = []
): Promise<BotResponse> {
  // 1. Catálogo en tiempo real
  const productos = await obtenerProductosCache();

  const catalogo = productos.length
    ? productos
        .filter((p) => p.precio > 0)
        .map((p) => {
          const emoji = asignarEmojiProducto(p.titulo);
          const stock = p.inventario > 0 ? `✅ ${p.inventario} disponibles` : '❌ AGOTADO';
          const desc = p.descripcion ? ` — ${p.descripcion.slice(0, 100)}` : '';
          return `• [ID: ${p.shopify_id}] ${emoji} ${p.titulo} | ${formatearPrecioCOP(p.precio)} | ${stock}${desc}`;
        })
        .join('\n')
    : 'Sin productos disponibles en este momento.';

  // 2. Estado del carrito actual
  let carritoInfo = 'El cliente no tiene nada en el carrito aún.';
  if (pendingCart.length > 0) {
    const subtotal = pendingCart.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const envio = subtotal >= ENVIO_GRATIS_DESDE ? '🎁 GRATIS' : formatearPrecioCOP(COSTO_ENVIO);
    const total = subtotal + (subtotal >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO);
    carritoInfo =
      `El cliente tiene ${pendingCart.length} producto(s) en el carrito:\n` +
      pendingCart.map((i) => `  • ${i.titulo} × ${i.cantidad} = ${formatearPrecioCOP(i.precio * i.cantidad)}`).join('\n') +
      `\n  Subtotal: ${formatearPrecioCOP(subtotal)} | Envío: ${envio} | Total: ${formatearPrecioCOP(total)}`;
  }

  // 3. Historial reciente (últimos 14 mensajes)
  const historial = context.mensajes_previos
    .slice(-14)
    .filter((m) => m.contenido?.trim())
    .map((m) => ({
      role: m.tipo === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.contenido,
    }));

  const nombreCliente = context.cliente.nombre
    ? context.cliente.nombre.split(' ')[0]
    : null;

  const sedeCliente = context.cliente.sede_preferida || null;

  // 4. System prompt completo de Sofi
  const systemPrompt = `Eres Sofi, la asesora de ventas digital de ${BUSINESS_NAME}. Eres cálida, entusiasta, experta y muy cercana. Hablas en español colombiano natural.${nombreCliente ? `\nEl cliente se llama: ${nombreCliente}.` : ''}${sedeCliente ? `\nSede preferida del cliente: ${sedeCliente}.` : ''}

━━━ INFORMACIÓN DEL NEGOCIO ━━━
Tienda: ${BUSINESS_NAME}
Web: https://tiendacommerkant.com.co
Sedes físicas: CC Tesoro, CC Gran Manzana, Mall Indiana, Apartadó, Itagüi, CC Fabricato
Atención: Lunes a Sábado
Envíos a: ${COBERTURA.join(', ')} y municipios del Área Metropolitana
Costo envío: ${formatearPrecioCOP(COSTO_ENVIO)} — GRATIS en compras mayores a ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}
Tiempo de entrega: 24–48 horas hábiles
Formas de pago: Tarjeta crédito/débito, PSE, Nequi, Daviplata (plataforma Wompi, 100% seguro)
Políticas: https://tiendacommerkant.com.co/policies/privacy-policy

━━━ CATÁLOGO ACTUAL (tiempo real) ━━━
${catalogo}

━━━ ESTADO DEL CARRITO DEL CLIENTE ━━━
${carritoInfo}

━━━ TU MISIÓN ━━━
1. Resolver cualquier pregunta sobre la tienda, productos, envíos y pagos con información exacta.
2. Hacer recomendaciones inteligentes y personalizadas:
   • Si el cliente pide un REGALO → preguntar: ¿para quién? ¿qué ocasión? ¿presupuesto? (si no lo sabe, sugerir con base en lo que diga)
   • Ocasiones especiales (cumpleaños, Día de la Madre, San Valentín, grado, etc.) → adaptar la recomendación
   • Presupuesto limitado → filtrar solo productos en ese rango
   • Si dice "no sé qué regalar" → hacer 1-2 preguntas clave y recomendar
   • Si tiene suficiente info → recomendar directamente sin preguntar más
3. Persuadir con argumentos genuinos: calidad, precio justo, envío rápido, pago seguro.
4. Cuando el cliente decida comprar → usar accion "iniciar_compra" con el producto_id exacto.
5. Si hay ítems en el carrito → mencionarlos cuando sea relevante ("ya tienes X en tu carrito").

━━━ CUÁNDO TRANSFERIR AL ASESOR HUMANO ━━━
Usa accion "transferir" cuando el cliente diga:
• "asesor", "agente", "humano", "persona real", "quiero hablar con alguien", "llamar"
• Tenga un reclamo o problema grave con un pedido anterior
• Solicite devolución, garantía o cambio de producto
• Esté muy molesto o frustrado
• Haga preguntas que no puedas responder con la información disponible

━━━ REGLAS IMPORTANTES ━━━
• Respuestas cortas: máximo 4 líneas (WhatsApp, no email)
• Emojis solo cuando aporten, no en cada línea
• NUNCA inventes precios, productos, ni información que no esté en el catálogo
• Si un producto está AGOTADO, ofrece siempre una alternativa disponible
• Si te preguntan si eres humana: di que eres Sofi, la asistente virtual de Commerk
• No menciones que eres IA o Claude a menos que insistan directamente

━━━ FORMATO DE RESPUESTA (JSON estricto, sin texto fuera del JSON) ━━━
{
  "texto": "tu respuesta para el cliente",
  "accion": "continuar" | "iniciar_compra" | "transferir",
  "producto_id": "el shopify_id exacto si accion es iniciar_compra, de lo contrario omitir"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      messages: [
        ...historial,
        { role: 'user', content: mensaje },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extraer JSON de la respuesta (tolerante a texto extra)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Sofi no devolvió JSON válido');

    const parsed = JSON.parse(jsonMatch[0]) as {
      texto: string;
      accion?: string;
      producto_id?: string;
    };

    const textoFinal = parsed.texto?.trim() || 'Disculpa, ¿me puedes repetir? 😊';

    // Acción: transferir al asesor humano
    if (parsed.accion === 'transferir') {
      return {
        texto: textoFinal,
        accion: 'transferir_a_asesor',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

    // Acción: iniciar proceso de compra (state machine toma el control)
    if (parsed.accion === 'iniciar_compra' && parsed.producto_id) {
      const producto = productos.find((p) => p.shopify_id === parsed.producto_id);
      if (producto && producto.inventario > 0) {
        return {
          texto: textoFinal,
          metadata: {
            awaiting: 'compra',
            pending_product_id: producto.shopify_id,
            pending_cart: pendingCart,
            sofi_ia: true,
          },
        };
      }
      // Producto no encontrado o agotado — continuar conversación
    }

    // Respuesta normal — continuar con Sofi
    return {
      texto: textoFinal,
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };

  } catch (error: any) {
    console.error('[Sofi IA] Error:', error?.message);
    return {
      texto: '¡Ups! Tuve un momento. ¿Me puedes repetir lo que necesitas? 😊',
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };
  }
}
