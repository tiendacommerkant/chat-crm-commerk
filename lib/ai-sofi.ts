// ============================================================
// SOFI — Vendedora IA de Tienda Commerk (powered by Claude)
// ============================================================
// Maneja todo el contacto inicial, preguntas, recomendaciones
// y detección de intención de compra.
// El flujo de checkout (cantidad → dirección → pago) sigue en
// el state machine de bot-logic.ts para máxima confiabilidad.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { BotContext, BotResponse } from '@/types';
import { obtenerProductosCache } from './supabase';
import { formatearPrecioCOP } from './shopify';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COSTO_ENVIO        = parseInt(process.env.SHIPPING_COST || '8000');
const ENVIO_GRATIS_DESDE = parseInt(process.env.FREE_SHIPPING_THRESHOLD || '149000');
const COBERTURA          = (process.env.SHIPPING_COVERAGE || 'Medellín').split(',').map((c) => c.trim());
const BUSINESS_NAME      = process.env.BUSINESS_NAME || 'Tienda Commerk Antioquia';

export async function procesarMensajeSofi(
  mensaje: string,
  context: BotContext
): Promise<BotResponse> {
  // 1. Obtener catálogo real en tiempo real
  const productos = await obtenerProductosCache();

  const catalogo = productos.length
    ? productos.map((p) =>
        `• ${p.titulo} | Precio: ${formatearPrecioCOP(p.precio)} | Stock: ${
          p.inventario > 0 ? `${p.inventario} uds disponibles` : 'AGOTADO'
        } | ID: ${p.shopify_id}${p.descripcion ? ` | ${p.descripcion.slice(0, 120)}` : ''}`
      ).join('\n')
    : 'Sin productos disponibles en este momento.';

  // 2. Historial reciente (últimos 12 mensajes para contexto)
  const historial = context.mensajes_previos
    .slice(-12)
    .filter((m) => m.contenido?.trim())
    .map((m) => ({
      role: m.tipo === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.contenido,
    }));

  const nombreCliente = context.cliente.nombre
    ? context.cliente.nombre.split(' ')[0]
    : null;

  // 3. System prompt de Sofi
  const systemPrompt = `Eres Sofi, la vendedora digital experta de ${BUSINESS_NAME}. Eres cálida, entusiasta, persuasiva y muy profesional. Hablas en español colombiano natural y cercano.

━━━ INFORMACIÓN DEL NEGOCIO ━━━
Negocio: ${BUSINESS_NAME}
Cobertura envíos: ${COBERTURA.join(', ')}
Costo envío: ${formatearPrecioCOP(COSTO_ENVIO)} (GRATIS en compras mayores a ${formatearPrecioCOP(ENVIO_GRATIS_DESDE)})
Formas de pago: Tarjeta de crédito/débito, PSE, Nequi, Daviplata (todos 100% seguros por Wompi)
Tiempo entrega: 24-48 horas hábiles
Atención: Lunes a Sábado${nombreCliente ? `\n\nCLIENTE: ${nombreCliente}` : ''}

━━━ CATÁLOGO ACTUAL (precios y stock en tiempo real) ━━━
${catalogo}

━━━ TU MISIÓN ━━━
1. Entender la necesidad del cliente y recomendar el producto ideal
2. Resolver dudas con información real del catálogo (nunca inventes precios ni productos)
3. Persuadir con argumentos genuinos: calidad, precio justo, envío rápido, pago seguro
4. Cuando el cliente quiera comprar → usar accion "iniciar_compra" con el producto_id
5. Si hay varias opciones que le pueden interesar → recomendar máximo 2-3
6. Si hay quejas graves, problemas de pago, o el cliente pide hablar con una persona → transferir al asesor humano

━━━ REGLAS IMPORTANTES ━━━
- Respuestas cortas: máximo 4 líneas (estamos en WhatsApp, no en email)
- Usa emojis con moderación, solo cuando aporten
- Si te preguntan si eres humana: di que eres Sofi, la asistente virtual de Commerk
- Nunca menciones que eres IA o Claude a menos que te insistan
- Si un producto está AGOTADO, ofrece alternativas disponibles
- Si el cliente dice "asesor", "persona", "humano", "agente" → accion: "transferir"
- Frases como "no puedo ayudarte" deben ir seguidas de accion: "transferir"

━━━ FORMATO DE RESPUESTA (JSON estricto, sin texto fuera del JSON) ━━━
{
  "texto": "tu respuesta para el cliente",
  "accion": "continuar" | "iniciar_compra" | "transferir",
  "producto_id": "el shopify_id exacto del producto si accion es iniciar_compra, sino omitir"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      messages: [
        ...historial,
        { role: 'user', content: mensaje },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extraer JSON de la respuesta
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
        metadata: { awaiting: '', sofi_ia: true },
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
            sofi_ia: true,
          },
        };
      }
    }

    // Respuesta normal (continuar conversación con Sofi)
    return {
      texto: textoFinal,
      metadata: { awaiting: '', sofi_ia: true },
    };

  } catch (error: any) {
    console.error('[Sofi IA] Error llamando a Claude:', error?.message);
    // Fallback elegante sin caerse
    return {
      texto: 'Sofi tuvo un momento. ¿Me puedes repetir? 😊',
      metadata: { awaiting: '', sofi_ia: true },
    };
  }
}
