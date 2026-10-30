// ============================================
// CARRITOS ABANDONADOS — captura desde Shopify
// ============================================
//
// Desde el 1 de junio no se registraba ningún carrito: los avisos
// checkouts/create y checkouts/update de Shopify dejaron de dejar filas y el
// error no quedaba en ninguna parte. Ahora, además del webhook, el CRM pide a
// Shopify los carritos abandonados recientes y los guarda, así la
// recuperación por WhatsApp no depende de que lleguen los avisos.

import { supabaseAdmin } from './supabase';
import { extraerTelefonoCheckout } from './shopify';
import { formatearNumeroWhatsApp } from './whatsapp';
import { registrarEvento } from './eventos';
import type { ShopifyCheckout } from '@/types';

export const ABANDONO_MINUTOS = 45;

export interface CarritoGuardado {
  id: string;
  checkoutId: string;
  estado: 'abandonado' | 'en_progreso' | 'notificado' | 'convertido';
  telefono: string | null;
  nombre: string | null;
  total: number;
  url: string | null;
  items: Array<{ title: string; quantity: number; price: number }>;
  notificado: boolean;
}

/**
 * Celular colombiano listo para WhatsApp (57 + 10 dígitos que empiezan en 3),
 * o null. En Shopify llegan teléfonos como "1314…" (el cliente escribió su
 * celular y quedó con el prefijo de Estados Unidos) o "0622…": enviarlos tal
 * cual le mandaría el mensaje de recuperación a un desconocido.
 */
export function celularColombiano(telefono: string | null): string | null {
  const d = (telefono || '').replace(/\D/g, '');
  if (/^573\d{9}$/.test(d)) return d;
  if (/^3\d{9}$/.test(d)) return `57${d}`;
  if (/^13\d{9}$/.test(d)) return `57${d.slice(1)}`;
  return null;
}

/** Guarda (o actualiza) un checkout de Shopify. Devuelve null si falla. */
export async function guardarCheckout(checkout: ShopifyCheckout): Promise<CarritoGuardado | null> {
  // Shopify a veces envía id como undefined en ciertos eventos; usar token como fallback
  const checkoutId = String(checkout.id ?? checkout.token ?? '');
  if (!checkoutId) return null;

  const telefono = extraerTelefonoCheckout(checkout);
  const telefonoFormateado = celularColombiano(telefono ? formatearNumeroWhatsApp(telefono) : null);
  const nombre = [checkout.customer?.first_name, checkout.customer?.last_name].filter(Boolean).join(' ') || null;
  const items = (checkout.line_items || []).map((i) => ({
    title: i.title,
    quantity: i.quantity,
    price: parseFloat(i.price),
  }));

  // Usar updated_at para detectar actividad reciente (created_at puede ser días atrás)
  const ultimaActividad = new Date(checkout.updated_at || checkout.created_at);
  const minutosInactivo = (Date.now() - ultimaActividad.getTime()) / 60000;
  const estado = !isNaN(minutosInactivo) && minutosInactivo >= ABANDONO_MINUTOS ? 'abandonado' : 'en_progreso';
  const total = parseFloat(checkout.total_price || '0');

  // Un carrito ya recordado o convertido conserva su estado: la sincronización
  // de cada minuto lo devolvía a "abandonado".
  const { data: previo } = await supabaseAdmin
    .from('carritos_abandonados').select('estado').eq('shopify_checkout_id', checkoutId).maybeSingle();
  const estadoFinal = ['notificado', 'convertido'].includes((previo as any)?.estado) ? (previo as any).estado : estado;

  const { data, error } = await supabaseAdmin.from('carritos_abandonados').upsert({
    shopify_checkout_id: checkoutId,
    shopify_token: checkout.token || null,
    email: checkout.email || null,
    telefono: telefonoFormateado,
    nombre,
    total,
    items,
    url_checkout: checkout.abandoned_checkout_url || null,
    estado: estadoFinal,
    shopify_created_at: checkout.created_at || null,
    shopify_updated_at: checkout.updated_at || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shopify_checkout_id' }).select('id, notificado_whatsapp').single();

  if (error || !data) {
    await registrarEvento('error', 'carritos', `No se pudo guardar el carrito ${checkoutId}: ${error?.message || 'sin respuesta'}`);
    return null;
  }

  return {
    id: data.id,
    checkoutId,
    estado: estadoFinal,
    telefono: telefonoFormateado,
    nombre,
    total,
    url: checkout.abandoned_checkout_url || null,
    items,
    notificado: !!data.notificado_whatsapp,
  };
}

/** Trae de Shopify los carritos abandonados recientes y los guarda. */
export async function sincronizarCarritosShopify(horas = 24): Promise<{ revisados: number; guardados: number }> {
  const desde = new Date(Date.now() - horas * 3600e3).toISOString();
  const url = `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2024-01/checkouts.json` +
    `?limit=250&updated_at_min=${encodeURIComponent(desde)}`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || '' },
    cache: 'no-store',
  });
  if (!res.ok) {
    await registrarEvento('error', 'carritos', `Shopify no entregó los carritos abandonados (HTTP ${res.status})`);
    return { revisados: 0, guardados: 0 };
  }
  const { checkouts } = await res.json();
  let guardados = 0;
  for (const c of (checkouts || []) as ShopifyCheckout[]) {
    if (await guardarCheckout(c)) guardados++;
  }
  return { revisados: (checkouts || []).length, guardados };
}
