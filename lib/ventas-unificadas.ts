// ============================================
// VENTAS UNIFICADAS — pedidos de Shopify + compras por el bot, sin duplicar
// ============================================
// Una compra por el bot queda en `ventas` (una fila por producto, misma
// referencia WA-…) y, al pagarse, también como pedido en Shopify (fila en
// `pedidos_shopify` con origen 'bot' y la referencia dentro de direccion_envio).
// Aquí se muestran como UNA sola venta "Bot WA" con su número de Shopify, y el
// total se cuenta una vez. Funciones puras, probadas en tests/.

export interface VentaUnificada {
  id: string;
  fuente: 'shopify' | 'bot';
  fecha: string;
  referencia: string;
  pedido_shopify: string | null;
  nombre_cliente: string;
  telefono: string | null;
  email: string | null;
  productos: string;
  cantidad: number;
  total: number;
  descuentos: number;
  estado: string;
  estado_financiero: string;
  estado_fulfillment: string | null;
  notificado_whatsapp: boolean;
}

export function mapearEstadoShopify(estado: string): string {
  const map: Record<string, string> = {
    paid: 'pagado',
    pending: 'pendiente',
    partially_paid: 'pendiente',
    refunded: 'reembolsado',
    voided: 'cancelado',
    authorized: 'pendiente',
  };
  return map[estado] || estado;
}

const productosDe = (items: any[]) => (items || []).map((i: any) => `${i.title} ×${i.quantity}`).join(', ');

function filaShopify(p: any): VentaUnificada {
  return {
    id: p.id,
    fuente: 'shopify',
    fecha: p.shopify_created_at || p.created_at,
    referencia: `#${p.shopify_order_number}`,
    pedido_shopify: null,
    nombre_cliente: p.nombre_cliente || 'Sin nombre',
    telefono: p.telefono || null,
    email: p.email || null,
    productos: productosDe(p.items),
    cantidad: (p.items || []).reduce((s: number, i: any) => s + (i.quantity || 1), 0),
    total: Number(p.total) || 0,
    descuentos: Number(p.total_descuentos) || 0,
    estado: mapearEstadoShopify(p.estado_financiero),
    estado_financiero: p.estado_financiero,
    estado_fulfillment: p.estado_fulfillment,
    notificado_whatsapp: !!p.notificado_whatsapp,
  };
}

/** Una compra por el bot: todas sus filas de `ventas` (misma referencia) en una sola. */
function filaBot(grupo: any[]): VentaUnificada {
  const primera = grupo[0];
  const estados = grupo.map((v) => v.estado);
  const estado = estados.includes('pagado') ? 'pagado' : estados.includes('pendiente') ? 'pendiente' : primera.estado;
  return {
    id: primera.id,
    fuente: 'bot',
    fecha: primera.created_at,
    referencia: primera.referencia_pago || '—',
    pedido_shopify: null,
    nombre_cliente: primera.cliente?.nombre || 'Sin nombre',
    telefono: primera.cliente?.telefono || null,
    email: null,
    productos: grupo.map((v) => `${v.producto_nombre || '—'} ×${v.cantidad || 1}`).join(', '),
    cantidad: grupo.reduce((s, v) => s + (v.cantidad || 1), 0),
    total: grupo.reduce((s, v) => s + (Number(v.total) || 0), 0),
    descuentos: 0,
    estado,
    estado_financiero: estado,
    estado_fulfillment: null,
    notificado_whatsapp: false,
  };
}

export function unificarVentas(pedidos: any[], ventas: any[]): VentaUnificada[] {
  // Compras por el bot agrupadas por referencia de pago
  const grupos = new Map<string, any[]>();
  for (const v of ventas || []) {
    const clave = v.referencia_pago || `sin-ref-${v.id}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(v);
  }
  const filasBot = new Map<string, VentaUnificada>();
  for (const [clave, grupo] of grupos) filasBot.set(clave, filaBot(grupo));

  const filas: VentaUnificada[] = [];
  for (const p of pedidos || []) {
    const marca = p.direccion_envio && typeof p.direccion_envio === 'object' ? p.direccion_envio : null;
    const esDelBot = marca?.origen === 'bot' || !!marca?.referencia_pago;
    if (!esDelBot) { filas.push(filaShopify(p)); continue; }

    const bot = marca?.referencia_pago ? filasBot.get(marca.referencia_pago) : undefined;
    const shopify = filaShopify(p);
    if (bot) {
      // Pedido que nació en el bot: una sola fila, con el estado y el total de Shopify (incluye el regalo)
      bot.pedido_shopify = shopify.referencia;
      bot.productos = shopify.productos || bot.productos;
      bot.cantidad = shopify.cantidad || bot.cantidad;
      bot.total = shopify.total || bot.total;
      bot.estado = shopify.estado;
      bot.estado_financiero = shopify.estado_financiero;
      bot.estado_fulfillment = shopify.estado_fulfillment;
      bot.notificado_whatsapp = shopify.notificado_whatsapp;
    } else {
      filas.push({ ...shopify, fuente: 'bot', referencia: marca?.referencia_pago || shopify.referencia, pedido_shopify: shopify.referencia });
    }
  }
  filas.push(...filasBot.values());
  return filas.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
}

export function resumenVentas(filas: VentaUnificada[]) {
  return {
    total: filas.length,
    pagadas: filas.filter((v) => v.estado === 'pagado').length,
    pendientes: filas.filter((v) => v.estado === 'pendiente').length,
    canceladas: filas.filter((v) => v.estado === 'cancelado').length,
    revenue: filas.filter((v) => v.estado === 'pagado').reduce((s, v) => s + v.total, 0),
  };
}
