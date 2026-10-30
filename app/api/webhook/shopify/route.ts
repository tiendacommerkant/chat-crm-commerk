// ============================================
// SHOPIFY WEBHOOK HANDLER — Todos los eventos
// ============================================
// Topics manejados:
//   orders/paid        → sync pedido + WhatsApp cliente
//   orders/cancelled   → actualizar estado + WhatsApp
//   orders/fulfilled   → notificar envío por WhatsApp
//   checkouts/create   → registrar carrito en progreso
//   checkouts/update   → actualizar carrito
//   products/update    → sync inventario
//   products/delete    → desactivar producto
// ============================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { extraerTelefonoPedido, mapearProductoParaBot } from '@/lib/shopify';
import { formatearNumeroWhatsApp } from '@/lib/whatsapp';
import {
  notificarPedidoConfirmado,
  notificarPedidoCancelado,
  notificarPedidoEnviado,
} from '@/lib/notificaciones';
import type { ShopifyOrder, ShopifyCheckout } from '@/types';
import { guardarCheckout } from '@/lib/carritos';


// ─── Verificación HMAC ────────────────────────────────────────────────────────
function verificarHmac(body: string, hmac: string | null, secret: string): boolean {
  // Sin secreto no hay forma de saber si el evento viene de Shopify: se rechaza
  if (!secret) {
    console.error('[Shopify webhook] SHOPIFY_WEBHOOK_SECRET no configurado — rechazando webhook por seguridad');
    return false;
  }
  if (!hmac) return false;
  const hash = Buffer.from(crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64'));
  const recibido = Buffer.from(hmac);
  return hash.length === recibido.length && crypto.timingSafeEqual(hash, recibido);
}

// ─── Handler orders/paid ─────────────────────────────────────────────────────
async function handleOrderPaid(order: ShopifyOrder) {
  const telefono = extraerTelefonoPedido(order);
  const nombreCliente = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Cliente';
  const telefonoFormateado = telefono ? formatearNumeroWhatsApp(telefono) : null;

  // Pedidos creados por el bot tienen el tag "bot" — no re-notificar por WA
  const esPedidoBot = String((order as any).tags || '').includes('bot');

  // 1. Buscar o crear cliente en CRM
  // IMPORTANTE: usar maybeSingle() — .single() lanza error si el cliente no existe
  let clienteId: string | null = null;
  if (telefonoFormateado) {
    const { data: clienteExistente } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('telefono', telefonoFormateado)
      .maybeSingle();

    if (clienteExistente) {
      clienteId = clienteExistente.id;
    } else {
      const { data: nuevoCliente } = await supabaseAdmin
        .from('clientes')
        .insert({ telefono: telefonoFormateado, nombre: nombreCliente, email: order.email || null })
        .select('id')
        .maybeSingle();
      clienteId = nuevoCliente?.id || null;
    }
  }

  // 2. Guardar en pedidos_shopify — SIEMPRE primero, antes de cualquier notificación
  const items = (order.line_items || []).map((i) => ({
    title: i.title,
    quantity: i.quantity,
    price: parseFloat(i.price),
  }));

  const { error: upsertError } = await supabaseAdmin.from('pedidos_shopify').upsert({
    shopify_order_id: order.id,
    shopify_order_number: order.order_number.toString(),
    cliente_id: clienteId,
    email: order.email || null,
    telefono: telefonoFormateado,
    nombre_cliente: nombreCliente,
    total: parseFloat(order.total_price),
    subtotal: parseFloat(order.subtotal_price),
    total_descuentos: parseFloat(order.total_discounts || '0'),
    moneda: order.currency,
    estado_financiero: order.financial_status,
    estado_fulfillment: order.fulfillment_status,
    items,
    direccion_envio: order.shipping_address || null,
    shopify_created_at: order.created_at,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shopify_order_id' });

  if (upsertError) {
    // Error grave: el pedido no se guardó — lanzar para que quede en logs
    throw new Error(`[pedidos_shopify upsert] ${upsertError.message}`);
  }

  // 3. Marcar carrito como convertido — por email Y por teléfono
  const ts = new Date().toISOString();
  if (order.email) {
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ estado: 'convertido', updated_at: ts })
      .eq('email', order.email)
      .in('estado', ['en_progreso', 'abandonado', 'notificado']);
  }
  if (telefonoFormateado) {
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ estado: 'convertido', updated_at: ts })
      .eq('telefono', telefonoFormateado)
      .in('estado', ['en_progreso', 'abandonado', 'notificado']);
  }

  // 4. Notificar por WhatsApp SOLO para pedidos del sitio web
  // Los pedidos del bot (tag "bot") ya recibieron notificación en el webhook de Wompi
  if (telefonoFormateado && !esPedidoBot) {
    await notificarPedidoConfirmado({
      shopify_order_id: order.id.toString(),
      shopify_order_number: order.order_number.toString(),
      nombre_cliente: nombreCliente,
      telefono: telefonoFormateado,
      total: parseFloat(order.total_price),
      items: (order.line_items || []).map((i) => ({ title: i.title, quantity: i.quantity, price: i.price })),
    }).catch((err) => console.error('[handleOrderPaid] Error WA notification:', err?.message));
  }
}

// ─── Handler orders/cancelled ────────────────────────────────────────────────
async function handleOrderCancelled(order: ShopifyOrder) {
  await supabaseAdmin
    .from('pedidos_shopify')
    .update({ estado_financiero: 'cancelled', updated_at: new Date().toISOString() })
    .eq('shopify_order_id', order.id);

  const telefono = extraerTelefonoPedido(order);
  const telefonoFormateado = telefono ? formatearNumeroWhatsApp(telefono) : null;
  const nombreCliente = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Cliente';

  if (telefonoFormateado) {
    await notificarPedidoCancelado({
      shopify_order_id: order.id.toString(),
      shopify_order_number: order.order_number.toString(),
      nombre_cliente: nombreCliente,
      telefono: telefonoFormateado,
      total: parseFloat(order.total_price),
    });
  }
}

// ─── Handler orders/fulfilled ────────────────────────────────────────────────
async function handleOrderFulfilled(order: ShopifyOrder) {
  await supabaseAdmin
    .from('pedidos_shopify')
    .update({ estado_fulfillment: 'fulfilled', updated_at: new Date().toISOString() })
    .eq('shopify_order_id', order.id);

  const telefono = extraerTelefonoPedido(order);
  const telefonoFormateado = telefono ? formatearNumeroWhatsApp(telefono) : null;
  const nombreCliente = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Cliente';

  if (telefonoFormateado) {
    const fulfillment = (order as any).fulfillments?.[0];
    await notificarPedidoEnviado({
      shopify_order_id: order.id.toString(),
      shopify_order_number: order.order_number.toString(),
      nombre_cliente: nombreCliente,
      telefono: telefonoFormateado,
      tracking_number: fulfillment?.tracking_number,
      tracking_company: fulfillment?.tracking_company,
    });
  }
}

// ─── Handler checkouts/create + checkouts/update ─────────────────────────────
// Solo guarda: el recordatorio lo envía /api/cron/recuperar-carritos con
// todas las reglas (horario, plantilla, un mensaje por semana…)
async function handleCheckout(checkout: ShopifyCheckout) {
  await guardarCheckout(checkout);
}

// ─── Handler products/update ─────────────────────────────────────────────────
async function handleProductUpdate(payload: any) {
  if (!payload.id) return;
  const mapeado = mapearProductoParaBot(payload);
  await supabaseAdmin.from('productos').upsert(mapeado, { onConflict: 'shopify_id' });
}

// ─── Handler products/delete ─────────────────────────────────────────────────
// Un producto borrado en Shopify no puede seguir ofreciéndose en el bot
async function handleProductDelete(payload: any) {
  if (!payload.id) return;
  await supabaseAdmin
    .from('productos')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('shopify_id', String(payload.id));
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let topic = 'unknown';
  try {
    const body = await req.text();
    const hmac = req.headers.get('x-shopify-hmac-sha256');
    topic = req.headers.get('x-shopify-topic') || '';
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '';

    if (!verificarHmac(body, hmac, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = JSON.parse(body);

    // Procesar en try/catch individual para siempre retornar 200
    // (Shopify deja de reintentar solo con 200; los 500 causan reintentos infinitos)
    try {
      switch (topic) {
        case 'orders/paid':
          await handleOrderPaid(payload as ShopifyOrder);
          break;
        case 'orders/cancelled':
          await handleOrderCancelled(payload as ShopifyOrder);
          break;
        case 'orders/fulfilled':
          await handleOrderFulfilled(payload as ShopifyOrder);
          break;
        case 'checkouts/create':
        case 'checkouts/update':
          await handleCheckout(payload as ShopifyCheckout);
          break;
        case 'products/update':
        case 'products/create':
          await handleProductUpdate(payload);
          break;
        case 'products/delete':
          await handleProductDelete(payload);
          break;
        default:
          console.log(`Shopify webhook topic no manejado: ${topic}`);
      }
    } catch (handlerError: any) {
      // Log detallado para diagnóstico pero siempre 200 para evitar reintentos
      console.error(`[Shopify webhook] Error en handler "${topic}":`, handlerError?.message, handlerError?.stack);
    }

    return NextResponse.json({ success: true, topic }, { status: 200 });
  } catch (error: any) {
    console.error(`[Shopify webhook] Error crítico (topic=${topic}):`, error?.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
