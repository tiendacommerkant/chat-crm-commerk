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
// ============================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { extraerTelefonoPedido, extraerTelefonoCheckout, mapearProductoParaBot } from '@/lib/shopify';
import { formatearNumeroWhatsApp } from '@/lib/whatsapp';
import {
  notificarPedidoConfirmado,
  notificarPedidoCancelado,
  notificarPedidoEnviado,
  notificarCarritoAbandonado,
} from '@/lib/notificaciones';
import type { ShopifyOrder, ShopifyCheckout } from '@/types';

const ABANDONO_MINUTOS = 45;

// ─── Verificación HMAC ────────────────────────────────────────────────────────
function verificarHmac(body: string, hmac: string | null, secret: string): boolean {
  if (!secret || !hmac) return !secret; // sin secret → solo dev
  const hash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  return hash === hmac;
}

// ─── Handler orders/paid ─────────────────────────────────────────────────────
async function handleOrderPaid(order: ShopifyOrder) {
  const telefono = extraerTelefonoPedido(order);
  const nombreCliente = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Cliente';
  const telefonoFormateado = telefono ? formatearNumeroWhatsApp(telefono) : null;

  // 1. Buscar o crear cliente en CRM
  let clienteId: string | null = null;
  if (telefonoFormateado) {
    const { data: clienteExistente } = await supabaseAdmin
      .from('clientes')
      .select('id')
      .eq('telefono', telefonoFormateado)
      .single();

    if (clienteExistente) {
      clienteId = clienteExistente.id;
    } else {
      const { data: nuevoCliente } = await supabaseAdmin
        .from('clientes')
        .insert({ telefono: telefonoFormateado, nombre: nombreCliente, email: order.email })
        .select('id')
        .single();
      clienteId = nuevoCliente?.id || null;
    }
  }

  // 2. Insertar en pedidos_shopify
  const items = (order.line_items || []).map((i) => ({
    title: i.title,
    quantity: i.quantity,
    price: parseFloat(i.price),
  }));

  await supabaseAdmin.from('pedidos_shopify').upsert({
    shopify_order_id: order.id,
    shopify_order_number: order.order_number.toString(),
    cliente_id: clienteId,
    email: order.email,
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

  // 3. Marcar carrito como convertido si existía
  if (order.email) {
    await supabaseAdmin
      .from('carritos_abandonados')
      .update({ estado: 'convertido', updated_at: new Date().toISOString() })
      .eq('email', order.email)
      .in('estado', ['en_progreso', 'abandonado', 'notificado']);
  }

  // 4. Notificar por WhatsApp
  if (telefonoFormateado) {
    await notificarPedidoConfirmado({
      shopify_order_id: order.id.toString(),
      shopify_order_number: order.order_number.toString(),
      nombre_cliente: nombreCliente,
      telefono: telefonoFormateado,
      total: parseFloat(order.total_price),
      items: (order.line_items || []).map((i) => ({ title: i.title, quantity: i.quantity, price: i.price })),
    });
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
async function handleCheckout(checkout: ShopifyCheckout) {
  const telefono = extraerTelefonoCheckout(checkout);
  const telefonoFormateado = telefono ? formatearNumeroWhatsApp(telefono) : null;
  const nombre = [checkout.customer?.first_name, checkout.customer?.last_name].filter(Boolean).join(' ') || null;

  const items = (checkout.line_items || []).map((i) => ({
    title: i.title,
    quantity: i.quantity,
    price: parseFloat(i.price),
  }));

  const createdAt = new Date(checkout.created_at);
  const minutosTranscurridos = (Date.now() - createdAt.getTime()) / 60000;
  const estado = minutosTranscurridos >= ABANDONO_MINUTOS ? 'abandonado' : 'en_progreso';

  await supabaseAdmin.from('carritos_abandonados').upsert({
    shopify_checkout_id: checkout.id.toString(),
    shopify_token: checkout.token,
    email: checkout.email || null,
    telefono: telefonoFormateado,
    nombre,
    total: parseFloat(checkout.total_price || '0'),
    items,
    url_checkout: checkout.abandoned_checkout_url || null,
    estado,
    shopify_created_at: checkout.created_at,
    shopify_updated_at: checkout.updated_at,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shopify_checkout_id' });

  // Auto-notificar si está abandonado y tiene teléfono
  if (estado === 'abandonado' && telefonoFormateado) {
    const { data: carrito } = await supabaseAdmin
      .from('carritos_abandonados')
      .select('id, notificado_whatsapp')
      .eq('shopify_checkout_id', checkout.id.toString())
      .single();

    if (carrito && !carrito.notificado_whatsapp) {
      await notificarCarritoAbandonado({
        id: carrito.id,
        shopify_checkout_id: checkout.id.toString(),
        nombre,
        telefono: telefonoFormateado,
        total: parseFloat(checkout.total_price || '0'),
        url_checkout: checkout.abandoned_checkout_url || null,
        items: (checkout.line_items || []).map((i) => ({ title: i.title, quantity: i.quantity })),
      });
    }
  }
}

// ─── Handler products/update ─────────────────────────────────────────────────
async function handleProductUpdate(payload: any) {
  if (!payload.id) return;
  const mapeado = mapearProductoParaBot(payload);
  await supabaseAdmin.from('productos').upsert(mapeado, { onConflict: 'shopify_id' });
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.text();
    const hmac = req.headers.get('x-shopify-hmac-sha256');
    const topic = req.headers.get('x-shopify-topic') || '';
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '';

    if (!verificarHmac(body, hmac, secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = JSON.parse(body);

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
      default:
        console.log(`Shopify webhook topic no manejado: ${topic}`);
    }

    return NextResponse.json({ success: true, topic }, { status: 200 });
  } catch (error) {
    console.error('Shopify webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
