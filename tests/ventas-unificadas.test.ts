import { describe, it, expect } from 'vitest';
import { unificarVentas, resumenVentas } from '@/lib/ventas-unificadas';

const cliente = { nombre: 'Adriana', telefono: '573234123522' };
const ventaBot = (id: string, producto: string, total: number, extra: any = {}) => ({
  id, referencia_pago: 'WA-1794254854468-d782149c', producto_nombre: producto, cantidad: 1, total, estado: 'pagado',
  created_at: '2026-11-09T20:07:34Z', cliente, ...extra,
});
const pedidoShopify = (extra: any = {}) => ({
  id: 'p1', shopify_order_number: '2692', nombre_cliente: 'Adriana Martínez', telefono: '573234123522', total: 93500,
  total_descuentos: 0, estado_financiero: 'paid', estado_fulfillment: null, items: [{ title: 'Kit Ejecutivo Ron Viejo De Caldas', quantity: 1 }],
  direccion_envio: { address1: 'Calle 45', origen: 'bot', referencia_pago: 'WA-1794254854468-d782149c' }, shopify_created_at: '2026-11-09T22:42:03Z', ...extra,
});

describe('Ventas unificadas', () => {
  it('una compra por el bot que ya es pedido en Shopify sale una sola vez, con su número', () => {
    const filas = unificarVentas([pedidoShopify()], [ventaBot('v1', 'Kit Ejecutivo Ron Viejo De Caldas — Juan de la Cruz', 93500)]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ fuente: 'bot', referencia: 'WA-1794254854468-d782149c', pedido_shopify: '#2692', estado: 'pagado', total: 93500 });
    expect(resumenVentas(filas).revenue).toBe(93500);
  });

  it('un pedido de la tienda web sigue saliendo como Shopify', () => {
    const web = pedidoShopify({ id: 'p2', shopify_order_number: '2690', direccion_envio: { address1: 'Cra 10', city: 'Medellín' }, telefono: '573007865158', nombre_cliente: 'Sandra' });
    const filas = unificarVentas([web], []);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ fuente: 'shopify', referencia: '#2690', pedido_shopify: null });
  });

  it('un carrito del bot con dos productos es una sola venta', () => {
    const filas = unificarVentas([], [ventaBot('v1', 'Ron Carta de Oro 750', 95700), ventaBot('v2', 'Aguardiente 750', 55360)]);
    expect(filas).toHaveLength(1);
    expect(filas[0].productos).toBe('Ron Carta de Oro 750 ×1, Aguardiente 750 ×1');
    expect(filas[0].total).toBe(151060);
    expect(filas[0].cantidad).toBe(2);
  });

  it('el estado de Shopify manda sobre el de la venta (ej. despachado)', () => {
    const filas = unificarVentas([pedidoShopify({ estado_fulfillment: 'fulfilled' })], [ventaBot('v1', 'Kit', 93500)]);
    expect(filas[0].estado_fulfillment).toBe('fulfilled');
  });

  it('un pedido marcado como del bot sin su venta en el CRM igual sale una vez, como Bot WA', () => {
    const filas = unificarVentas([pedidoShopify()], []);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ fuente: 'bot', pedido_shopify: '#2692' });
  });

  it('ventas pendientes del bot no suman ingresos', () => {
    const filas = unificarVentas([], [ventaBot('v1', 'Kit', 93500, { estado: 'pendiente' })]);
    expect(resumenVentas(filas)).toMatchObject({ total: 1, pendientes: 1, pagadas: 0, revenue: 0 });
  });
});
