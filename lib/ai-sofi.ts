// ============================================================
// SOFI — Agente IA de ventas de Tienda Commerk
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

// Extrae JSON de la respuesta de Claude — tolerante a texto extra, backticks, etc.
function extraerJSON(raw: string): { texto: string; accion?: string; producto_id?: string } | null {
  // Limpiar bloques de código markdown
  const limpio = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Intentar parsear JSON directo
  const match = limpio.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }

  // Si Claude devolvió texto plano sin JSON (ocurre con mensajes muy cortos),
  // envolverlo como respuesta normal
  const texto = limpio.replace(/^["']|["']$/g, '').trim();
  if (texto.length > 2) {
    return { texto, accion: 'continuar' };
  }

  return null;
}

export async function procesarMensajeSofi(
  mensaje: string,
  context: BotContext,
  pendingCart: CartItem[] = []
): Promise<BotResponse> {
  const productos = await obtenerProductosCache();

  // Catálogo en tiempo real — solo con precio, disponibles primero
  const disponibles = productos.filter((p) => p.precio > 0 && p.inventario > 0);
  const agotados    = productos.filter((p) => p.precio > 0 && p.inventario <= 0);

  const formatarProducto = (p: typeof productos[0]) => {
    const emoji = asignarEmojiProducto(p.titulo);
    const desc  = p.descripcion ? ` — ${p.descripcion.slice(0, 90)}` : '';
    return `• [ID:${p.shopify_id}] ${emoji} ${p.titulo} | ${formatearPrecioCOP(p.precio)}${desc}`;
  };

  const catalogoTexto =
    `DISPONIBLES:\n${disponibles.map(formatarProducto).join('\n') || 'Ninguno por ahora.'}\n\n` +
    (agotados.length ? `AGOTADOS (ofrecer alternativa):\n${agotados.map((p) => `• ${p.titulo}`).join('\n')}` : '');

  // Estado del carrito
  let carritoInfo = 'Sin ítems en el carrito.';
  if (pendingCart.length > 0) {
    const sub   = pendingCart.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const envio = sub >= ENVIO_GRATIS_DESDE ? 0 : COSTO_ENVIO;
    carritoInfo =
      `${pendingCart.length} ítem(s):\n` +
      pendingCart.map((i) => `  • ${i.titulo} ×${i.cantidad} = ${formatearPrecioCOP(i.precio * i.cantidad)}`).join('\n') +
      `\n  Total: ${formatearPrecioCOP(sub + envio)}${envio === 0 ? ' (envío GRATIS)' : ''}`;
  }

  // Historial de conversación (últimos 16 mensajes)
  const historial = context.mensajes_previos
    .slice(-16)
    .filter((m) => m.contenido?.trim())
    .map((m) => ({
      role: m.tipo === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.contenido,
    }));

  const nombre = context.cliente.nombre?.split(' ')[0] ?? null;
  const sede   = context.cliente.sede_preferida ?? null;

  const systemPrompt = `Eres Sofi, la asesora de ventas digital de ${BUSINESS_NAME}. Eres cálida, cercana, entusiasta y muy experta en los productos de la tienda. Hablas en español colombiano natural — nada de respuestas robóticas.${nombre ? `\nCliente: ${nombre}.` : ''}${sede ? ` Sede preferida: ${sede}.` : ''}

━━━ NEGOCIO ━━━
Nombre: ${BUSINESS_NAME}
Web: https://tiendacommerkant.com.co
Sedes físicas: CC Tesoro · CC Gran Manzana · Mall Indiana · Apartadó · Itagüi · CC Fabricato
Horario: Lunes a Sábado
Cobertura envíos: ${COBERTURA.join(', ')} y municipios del Área Metropolitana de Medellín
Costo envío: ${formatearPrecioCOP(COSTO_ENVIO)} — GRATIS en compras > ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)}
Tiempo entrega: 24–48 horas hábiles
Pagos: Tarjeta crédito/débito, PSE, Nequi, Daviplata — plataforma Wompi (100% seguro)
Políticas y devoluciones: https://tiendacommerkant.com.co/policies/privacy-policy

━━━ CATÁLOGO ACTUAL ━━━
${catalogoTexto}

━━━ CARRITO DEL CLIENTE ━━━
${carritoInfo}

━━━ CAPACIDADES ━━━
1. Responder CUALQUIER pregunta sobre la tienda, envíos, pagos, sedes, horarios, políticas.
2. Recomendar productos según la necesidad:
   - Regalo → preguntar para quién, ocasión y presupuesto (si no lo dio). Con esa info recomendar 2-3 opciones disponibles.
   - Presupuesto → filtrar productos en ese rango.
   - Ocasiones (cumpleaños, Día Madre, San Valentín, amor y amistad, grado) → adaptar recomendación.
   - "No sé qué llevar" → hacer 1-2 preguntas clave y recomendar.
3. Cuando el cliente quiera comprar un producto específico → accion "iniciar_compra" + producto_id.
4. Si el cliente pide hablar con persona/asesor/humano, o tiene un reclamo/devolución → accion "transferir".

━━━ MANEJO DE RESPUESTAS CORTAS Y AMBIGÜAS ━━━
Cuando el cliente responda "si", "no", "ok", "dale", "claro", "bueno", "listo", "¿y?", etc.:
- Interpreta SIEMPRE en el contexto del mensaje anterior.
- Si dijiste "¿Te puedo ayudar con algo más?" y responde "si" → pregunta en qué.
- Si dijiste algo sobre envíos y responde "si estoy en Medellín" → confirma y ofrece ayuda.
- Si la respuesta es una sola palabra sin contexto claro → pide amablemente más detalles.
- NUNCA falles en silencio. Siempre responde algo útil.

━━━ REGLAS ━━━
- Máximo 4 líneas por mensaje (WhatsApp, no email).
- Emojis solo cuando aporten, no en cada frase.
- NUNCA inventes precios, productos ni información que no esté arriba.
- Si un producto está AGOTADO → ofrece siempre una alternativa disponible.
- No digas que eres IA/Claude a menos que insistan.
- Si hay ítems en el carrito → menciónalos cuando sea relevante.
- Si no sabes algo → admítelo y ofrece transferir al asesor.

━━━ FORMATO DE RESPUESTA ━━━
OBLIGATORIO: responde ÚNICAMENTE con un objeto JSON válido. Nada de texto fuera del JSON.
Ejemplo correcto:
{"texto": "¡Hola! ¿En qué te puedo ayudar?", "accion": "continuar"}

Estructura:
{
  "texto": "tu respuesta al cliente (máximo 4 líneas)",
  "accion": "continuar" | "iniciar_compra" | "transferir",
  "producto_id": "shopify_id exacto — SOLO si accion es iniciar_compra"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        ...historial,
        { role: 'user', content: mensaje },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
    console.log('[Sofi] raw response:', rawText.slice(0, 200));

    const parsed = extraerJSON(rawText);
    if (!parsed) throw new Error('No se pudo extraer respuesta de Sofi');

    const textoFinal = parsed.texto?.trim() || '¿Me puedes repetir? 😊';

    if (parsed.accion === 'transferir') {
      return {
        texto: textoFinal,
        accion: 'transferir_a_asesor',
        metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
      };
    }

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
      // Producto no encontrado o agotado — continuar conversación normalmente
    }

    return {
      texto: textoFinal,
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };

  } catch (error: any) {
    console.error('[Sofi IA] Error:', error?.message);
    return {
      texto: 'Disculpa, tuve un problema. ¿Me repites lo que necesitas? 😊',
      metadata: { awaiting: '', sofi_ia: true, pending_cart: pendingCart },
    };
  }
}
