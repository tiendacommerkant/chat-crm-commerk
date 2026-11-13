// "¿Cómo va mi pedido?": el bot responde con el estado real del pedido del cliente.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sim = vi.hoisted(() => ({
  registro: [] as Array<{ tabla: string; op: string; args: any[] }>,
  datos: {} as Record<string, any>,
  pedidosCrm: [] as any[],
  porId: vi.fn(async (_id: any): Promise<any> => null),
  porNumero: vi.fn(async (_n: any): Promise<any> => null),
  porCliente: vi.fn(async (): Promise<any[]> => []),
}));

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso, productos } = await import('./apoyo/simulador');
  return {
    supabaseAdmin: crearSupabaseFalso(sim.registro, sim.datos),
    obtenerProductosCache: async () => productos,
    actualizarCliente: vi.fn(async () => {}),
    obtenerPedidosClienteShopify: async () => sim.pedidosCrm,
  };
});
vi.mock('@/lib/ai-sofi', () => ({ procesarMensajeSofi: vi.fn(async () => ({ texto: 'Respuesta de Sofi', metadata: { awaiting: '' } })) }));
vi.mock('@/lib/shopify', async (original) => ({
  ...(await original<typeof import('@/lib/shopify')>()),
  obtenerPedidoShopifyPorId: sim.porId,
  obtenerPedidoShopifyPorNumero: sim.porNumero,
  buscarPedidosShopifyPorCliente: sim.porCliente,
}));
vi.mock('@/lib/whatsapp-templates', () => ({ enviarLeadMayorista: vi.fn(async () => true) }));

import { procesarMensajeBot } from '@/lib/bot-logic';
import { esConsultaPedido, numeroDePedidoEn } from '@/lib/bot/intenciones';
import { contexto, bot } from './apoyo/simulador';

const pedido2692 = {
  id: 7927342792841, order_number: 2692, financial_status: 'paid', fulfillment_status: null, total_price: '93500.00',
  created_at: '2026-11-09T17:42:03-05:00', phone: '+573001234567', customer: { phone: '+573001234567', email: null },
  line_items: [{ title: 'Kit Ejecutivo Ron Viejo De Caldas', quantity: 1 }], fulfillments: [], shipping_lines: [{ title: 'Envío estándar' }],
};

beforeEach(() => {
  sim.registro.length = 0;
  for (const k of Object.keys(sim.datos)) delete sim.datos[k];
  sim.pedidosCrm = [];
  sim.porId.mockReset(); sim.porNumero.mockReset(); sim.porCliente.mockReset();
  sim.porId.mockResolvedValue(null); sim.porNumero.mockResolvedValue(null); sim.porCliente.mockResolvedValue([]);
});

describe('Detectar la consulta', () => {
  it.each(['cómo va mi pedido', 'ya enviaron mi pedido?', 'mi pedido no ha llegado', 'estado de mi compra', 'cuándo me llega'])(
    '"%s" pregunta por su pedido', (t) => expect(esConsultaPedido(t)).toBe(true));
  it.each(['quiero hacer mi pedido', 'cancelar mi pedido', 'quiero pagar mi compra', 'voy a hacer mi compra'])(
    '"%s" no es consulta de estado', (t) => expect(esConsultaPedido(t)).toBe(false));
  it('saca el número de pedido del mensaje', () => {
    expect(numeroDePedidoEn('#2692')).toBe('2692');
    expect(numeroDePedidoEn('el pedido 2692 cómo va')).toBe('2692');
    expect(numeroDePedidoEn('Calle 45 #120-30, Medellín')).toBeNull();
    expect(numeroDePedidoEn('quiero 2 botellas')).toBeNull();
  });
});

describe('Estado del pedido', () => {
  it('con pedido en el CRM muestra el estado en vivo de Shopify', async () => {
    sim.pedidosCrm = [{ shopify_order_id: 7927342792841, shopify_order_number: '2692', estado_financiero: 'paid', estado_fulfillment: null, items: pedido2692.line_items, total: 93500, direccion_envio: { address1: 'Calle 45' }, shopify_created_at: pedido2692.created_at }];
    sim.porId.mockResolvedValue({ ...pedido2692, fulfillment_status: 'fulfilled', fulfillments: [{ status: 'success', tracking_company: 'Servientrega', tracking_number: '2049876543' }] });
    const r = await procesarMensajeBot('cómo va mi pedido?', contexto());
    expect(r.texto).toMatch(/Pedido #2692/);
    expect(r.texto).toMatch(/Confirmado/);
    expect(r.texto).toMatch(/Despachado/);
    expect(r.texto).toMatch(/Servientrega 2049876543/);
  });

  it('pedido pagado sin despachar: en preparación con el tiempo de entrega', async () => {
    sim.pedidosCrm = [{ shopify_order_id: 1, shopify_order_number: '2692', estado_financiero: 'paid', estado_fulfillment: null, items: pedido2692.line_items, total: 93500, direccion_envio: { address1: 'Calle 45' }, shopify_created_at: pedido2692.created_at }];
    sim.porId.mockResolvedValue(pedido2692);
    const r = await procesarMensajeBot('ya enviaron mi pedido?', contexto());
    expect(r.texto).toMatch(/En preparación/);
    // Pedido del equipo (13 nov): nunca prometer 24-48 horas
    expect(r.texto).toMatch(/3 a 5 días hábiles/);
    expect(r.texto).not.toMatch(/24 a 48|mañana/);
  });

  it('sin pedido en el CRM lo busca en Shopify por el celular', async () => {
    sim.porCliente.mockResolvedValue([pedido2692]);
    const r = await procesarMensajeBot('dónde va mi pedido', contexto());
    expect(sim.porCliente).toHaveBeenCalled();
    expect(r.texto).toMatch(/Pedido #2692/);
  });

  it('sin nada registrado pide el número de pedido y luego lo consulta', async () => {
    const r1 = await procesarMensajeBot('mi pedido?', contexto());
    expect(r1.texto).toMatch(/número de pedido/);
    expect(r1.metadata?.pidio_numero_pedido).toBe(true);
    sim.porNumero.mockResolvedValue(pedido2692);
    const r2 = await procesarMensajeBot('2692', contexto({ historial: [bot(r1.texto, r1.metadata || {})] }));
    expect(sim.porNumero).toHaveBeenCalledWith('2692');
    expect(r2.texto).toMatch(/Pedido #2692/);
  });

  it('un número de pedido de otra persona no se muestra', async () => {
    sim.porNumero.mockResolvedValue({ ...pedido2692, phone: '+573999999999', customer: { phone: '+573999999999' } });
    const r = await procesarMensajeBot('#2692', contexto());
    expect(r.texto).toMatch(/Por seguridad/);
    expect(r.texto).not.toMatch(/Kit Ejecutivo/);
  });

  it('compra por el chat pendiente de pago: devuelve el link', async () => {
    sim.datos.ventas = [{ estado: 'pendiente', producto_nombre: 'Kit Ejecutivo', cantidad: 1, total: 93500, link_pago: 'https://checkout.wompi.co/l/abc', created_at: new Date().toISOString() }];
    const r = await procesarMensajeBot('cómo va mi pedido', contexto());
    expect(r.texto).toMatch(/pendiente de pago/);
    expect(r.texto).toContain('https://checkout.wompi.co/l/abc');
  });

  it('"quiero hacer mi pedido" no es una consulta: sigue con Sofi', async () => {
    const r = await procesarMensajeBot('quiero hacer mi pedido', contexto());
    expect(r.texto).toBe('Respuesta de Sofi');
  });
});
