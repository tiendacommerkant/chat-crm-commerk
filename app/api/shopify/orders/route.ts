// GET /api/shopify/orders → Sincroniza pedidos históricos de Shopify al CRM
import { NextResponse } from 'next/server';
import { obtenerPedidosShopify, extraerTelefonoPedido } from '@/lib/shopify';
import { formatearNumeroWhatsApp } from '@/lib/whatsapp';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limite = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status') || 'any';

    const pedidos = await obtenerPedidosShopify(limite, status);

    if (!pedidos.length) {
      return NextResponse.json({ success: true, sincronizados: 0, message: 'Sin pedidos en Shopify' });
    }

    let sincronizados = 0;
    let errores = 0;

    for (const order of pedidos) {
      try {
        const telefono = extraerTelefonoPedido(order);
        const telefonoFormateado = telefono ? formatearNumeroWhatsApp(telefono) : null;
        const nombreCliente = [order.customer?.first_name, order.customer?.last_name]
          .filter(Boolean).join(' ') || 'Cliente';

        // Buscar o crear cliente
        let clienteId: string | null = null;
        if (telefonoFormateado) {
          const { data: c } = await supabaseAdmin
            .from('clientes')
            .select('id')
            .eq('telefono', telefonoFormateado)
            .single();

          if (c) {
            clienteId = c.id;
          } else if (order.email || telefonoFormateado) {
            const { data: nuevo } = await supabaseAdmin
              .from('clientes')
              .insert({ telefono: telefonoFormateado, nombre: nombreCliente, email: order.email })
              .select('id')
              .single();
            clienteId = nuevo?.id || null;
          }
        }

        const items = order.line_items.map((i) => ({
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

        sincronizados++;
      } catch {
        errores++;
      }
    }

    return NextResponse.json({ success: true, sincronizados, errores, total: pedidos.length });
  } catch (error: any) {
    console.error('Error sincronizando pedidos:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
