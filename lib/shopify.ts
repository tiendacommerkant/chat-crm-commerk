// ============================================
// SHOPIFY API CLIENT
// ============================================

import type { ShopifyProduct } from '@/types';

const SHOPIFY_STORE = process.env.SHOPIFY_STORE!;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
const SHOPIFY_API_VERSION = '2024-01';

const SHOPIFY_API_URL = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;

/**
 * Obtener todos los productos de Shopify
 */
export async function obtenerProductosShopify(limite: number = 250): Promise<ShopifyProduct[]> {
  try {
    const response = await fetch(
      `${SHOPIFY_API_URL}/products.json?limit=${limite}&status=active`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        next: { revalidate: 300 }, // Cache por 5 minutos
      }
    );

    if (!response.ok) {
      throw new Error(`Error de Shopify: ${response.status}`);
    }

    const data = await response.json();
    return data.products || [];
  } catch (error) {
    console.error('Error obteniendo productos de Shopify:', error);
    return [];
  }
}

/**
 * Obtener un producto específico por ID
 */
export async function obtenerProductoShopify(productoId: string): Promise<ShopifyProduct | null> {
  try {
    const response = await fetch(
      `${SHOPIFY_API_URL}/products/${productoId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        next: { revalidate: 300 },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.product || null;
  } catch (error) {
    console.error('Error obteniendo producto de Shopify:', error);
    return null;
  }
}

/**
 * Verificar inventario disponible de un producto
 */
export async function verificarInventarioShopify(
  productoId: string
): Promise<{ disponible: boolean; cantidad: number }> {
  try {
    const producto = await obtenerProductoShopify(productoId);
    
    if (!producto || !producto.variants || producto.variants.length === 0) {
      return { disponible: false, cantidad: 0 };
    }

    const variant = producto.variants[0];
    const cantidad = variant.inventory_quantity || 0;

    return {
      disponible: cantidad > 0,
      cantidad,
    };
  } catch (error) {
    console.error('Error verificando inventario:', error);
    return { disponible: false, cantidad: 0 };
  }
}

/**
 * Buscar productos por título o keywords
 */
export async function buscarProductosShopify(query: string): Promise<ShopifyProduct[]> {
  try {
    const productos = await obtenerProductosShopify();
    
    const queryLower = query.toLowerCase();
    
    return productos.filter((producto) => {
      const titulo = producto.title.toLowerCase();
      const tags = producto.tags.toLowerCase();
      const tipo = producto.product_type.toLowerCase();
      
      return (
        titulo.includes(queryLower) ||
        tags.includes(queryLower) ||
        tipo.includes(queryLower)
      );
    });
  } catch (error) {
    console.error('Error buscando productos:', error);
    return [];
  }
}

/**
 * Mapear producto de Shopify a formato simple para el bot
 */
export function mapearProductoParaBot(producto: ShopifyProduct) {
  const variant = producto.variants[0];
  
  return {
    shopify_id: producto.id.toString(),
    titulo: producto.title,
    descripcion: producto.body_html?.replace(/<[^>]*>/g, '').substring(0, 200) || '',
    precio: parseFloat(variant.price),
    inventario: Math.max(0, variant.inventory_quantity || 0),
    imagen_url: producto.image?.src || null,
    categoria: producto.product_type || 'General',
    tags: producto.tags.split(', '),
    activo: producto.status === 'active',
  };
}

/**
 * Asignar emoji basado en el nombre del producto (para mensajes de WhatsApp)
 */
export function asignarEmojiProducto(titulo: string): string {
  const tituloLower = titulo.toLowerCase();
  
  if (tituloLower.includes('carta de oro')) return '🍾';
  if (tituloLower.includes('gran reserva')) return '👑';
  if (tituloLower.includes('león dormido') || tituloLower.includes('leon dormido')) return '🦁';
  if (tituloLower.includes('manzanares')) return '🥃';
  if (tituloLower.includes('aguardiente')) return '🥃';
  if (tituloLower.includes('tradicional')) return '🍾';
  if (tituloLower.includes('oscuro')) return '🌑';
  if (tituloLower.includes('esencial')) return '✨';
  if (tituloLower.includes('cheers')) return '🥂';
  if (tituloLower.includes('kit') || tituloLower.includes('ancheta')) return '🎁';
  if (tituloLower.includes('gin')) return '🍸';
  
  return '🍾'; // Default
}

/**
 * Obtener pedidos de Shopify
 */
export async function obtenerPedidosShopify(limite: number = 50, status: string = 'any'): Promise<import('@/types').ShopifyOrder[]> {
  try {
    const response = await fetch(
      `${SHOPIFY_API_URL}/orders.json?limit=${limite}&status=${status}&order=created_at+desc`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );
    if (!response.ok) throw new Error(`Shopify orders error: ${response.status}`);
    const data = await response.json();
    return data.orders || [];
  } catch (error) {
    console.error('Error obteniendo pedidos de Shopify:', error);
    return [];
  }
}

/**
 * Registrar webhooks en Shopify (elimina los existentes primero)
 */
export async function registrarWebhooksShopify(baseUrl: string): Promise<{ topic: string; success: boolean; error?: string }[]> {
  const topics = [
    'orders/paid',
    'orders/cancelled',
    'orders/fulfilled',
    'checkouts/create',
    'checkouts/update',
    'products/update',
  ];
  const address = `${baseUrl}/api/webhook/shopify`;

  // 1. Eliminar webhooks existentes para no duplicar
  const existentes = await listarWebhooksShopify();
  await Promise.all(
    existentes
      .filter((w: any) => topics.includes(w.topic))
      .map(async (w: any) => {
        await fetch(`${SHOPIFY_API_URL}/webhooks/${w.id}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
        });
      })
  );

  // 2. Registrar con la URL actual
  const resultados = await Promise.all(
    topics.map(async (topic) => {
      try {
        const response = await fetch(`${SHOPIFY_API_URL}/webhooks.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhook: { topic, address, format: 'json' },
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          const msg = data.errors ? JSON.stringify(data.errors) : `HTTP ${response.status}`;
          return { topic, success: false, error: msg };
        }
        return { topic, success: true };
      } catch (err: any) {
        return { topic, success: false, error: err.message };
      }
    })
  );

  return resultados;
}

/**
 * Listar webhooks registrados en Shopify
 */
export async function listarWebhooksShopify() {
  try {
    const response = await fetch(
      `${SHOPIFY_API_URL}/webhooks.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.webhooks || [];
  } catch (error) {
    console.error('Error listando webhooks:', error);
    return [];
  }
}

/**
 * Extraer teléfono de un pedido Shopify (prueba múltiples fuentes)
 */
export function extraerTelefonoPedido(order: import('@/types').ShopifyOrder): string | null {
  return (
    order.customer?.phone ||
    order.phone ||
    order.billing_address?.phone ||
    order.shipping_address?.phone ||
    null
  );
}

/**
 * Extraer teléfono de un checkout Shopify
 */
export function extraerTelefonoCheckout(checkout: import('@/types').ShopifyCheckout): string | null {
  return (
    checkout.customer?.phone ||
    checkout.phone ||
    checkout.billing_address?.phone ||
    checkout.shipping_address?.phone ||
    null
  );
}

/**
 * Crear pedido draft en Shopify a partir de una venta por WhatsApp
 */
export async function crearPedidoShopify(params: {
  productoShopifyId: string;
  cantidad: number;
  clienteNombre?: string | null;
  clienteTelefono: string;
  clienteEmail?: string | null;
  direccionEnvio: string;
  referenciaPago: string;
  metodoPago?: string;
}): Promise<{ success: boolean; orderId?: number; orderNumber?: number; error?: string }> {
  try {
    // Obtener producto para conseguir el variant_id
    const producto = await obtenerProductoShopify(params.productoShopifyId);
    if (!producto || !producto.variants?.length) {
      return { success: false, error: 'Producto no encontrado en Shopify' };
    }
    const variantId = producto.variants[0].id;

    // Parsear dirección simple (ciudad del texto)
    const nombreParts = (params.clienteNombre || 'Cliente WhatsApp').split(' ');
    const firstName = nombreParts[0] || 'Cliente';
    const lastName = nombreParts.slice(1).join(' ') || 'WhatsApp';

    const orderPayload = {
      order: {
        line_items: [{ variant_id: variantId, quantity: params.cantidad }],
        customer: {
          first_name: firstName,
          last_name: lastName,
          phone: params.clienteTelefono,
          email: params.clienteEmail || undefined,
        },
        shipping_address: {
          first_name: firstName,
          last_name: lastName,
          address1: params.direccionEnvio,
          phone: params.clienteTelefono,
          country: 'CO',
          country_code: 'CO',
        },
        financial_status: 'paid',
        tags: `whatsapp,bot,ref:${params.referenciaPago}`,
        note: `Venta por WhatsApp Bot | Pago: ${params.metodoPago || 'Wompi'} | Ref: ${params.referenciaPago}`,
        send_receipt: false,
        send_fulfillment_receipt: false,
      },
    };

    const response = await fetch(`${SHOPIFY_API_URL}/orders.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.errors ? JSON.stringify(data.errors) : `HTTP ${response.status}`;
      console.error('Error creando pedido en Shopify:', errMsg);
      return { success: false, error: errMsg };
    }

    return {
      success: true,
      orderId: data.order?.id,
      orderNumber: data.order?.order_number,
    };
  } catch (error) {
    console.error('Error en crearPedidoShopify:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

/**
 * Formatear precio en pesos colombianos
 */
export function formatearPrecioCOP(precio: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(precio);
}

/**
 * Obtener checkouts abandonados de Shopify (carritos que no completaron la compra)
 */
export async function obtenerCheckoutsAbandonadosShopify(limite: number = 250): Promise<any[]> {
  try {
    const response = await fetch(
      `${SHOPIFY_API_URL}/checkouts.json?limit=${limite}&status=open`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    );
    if (!response.ok) throw new Error(`Shopify checkouts error: ${response.status}`);
    const data = await response.json();
    return data.checkouts || [];
  } catch (error) {
    console.error('Error obteniendo checkouts abandonados de Shopify:', error);
    return [];
  }
}
