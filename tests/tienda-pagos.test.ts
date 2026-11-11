// Pagos de la tienda web que no se volvían pedido en Shopify y estados que no
// llegaban al CRM. Casos reales del 10–11 nov 2026: Kevin Giraldo pagó $50.700
// en la tienda, Wompi lo aprobó y Shopify nunca creó el pedido; #2687, #2689 y
// #2690 se despacharon y en el CRM seguían "sin despachar".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sim = vi.hoisted(() => ({
  eventos: [] as Array<{ nivel: string; origen: string; mensaje: string; detalle?: any }>,
  procesarBot: vi.fn(async () => {}),
  reenvio: vi.fn(),
}));

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso } = await import('./apoyo/simulador');
  return { supabaseAdmin: crearSupabaseFalso([]) };
});
vi.mock('@/lib/eventos', () => ({
  registrarEvento: vi.fn(async (nivel: string, origen: string, mensaje: string, detalle?: any) => { sim.eventos.push({ nivel, origen, mensaje, detalle }); }),
}));
vi.mock('@/lib/pagos-bot', () => ({ procesarTransaccionBot: sim.procesarBot }));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }));

import { reenviarAConexa, CONEXA_FORWARD_URL } from '@/lib/conexa';
import { pagosSinPedido, esPagoDeLaTienda, cambiosDePedidos, carritosYaComprados } from '@/lib/vigilancia-tienda';
import { checksumWompi } from '@/lib/firma-wompi';

const SECRETO = 'secreto-eventos-prueba';

/** Evento de Wompi firmado como lo firma Wompi. */
function evento(transaction: Record<string, any>) {
  const data = { transaction };
  const signature = { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' };
  const timestamp = 1794336000;
  signature.checksum = checksumWompi({ data, signature, timestamp }, SECRETO);
  return { event: 'transaction.updated', data, signature, timestamp, sent_at: '2026-11-10T15:20:30Z' };
}

const pagoKevin = {
  id: '1234-1794328800-11111', reference: 'rbgGhYIyMZ8MZY4uoxT3hd6gO', status: 'APPROVED', amount_in_cents: 5_070_000,
  created_at: '2026-11-10T15:20:00.000Z', finalized_at: '2026-11-10T15:20:40.000Z', payment_method_type: 'BANCOLOMBIA_TRANSFER',
  customer_email: 'kevinholguin1507@gmail.com', customer_data: { full_name: 'Kevin Daniel Giraldo Holguin', phone_number: '3234544561' },
};

describe('Reenvío a la app de Wompi en Shopify (Conexa)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('espera la respuesta y reintenta si Conexa falla', async () => {
    const fetchFalso = vi.fn()
      .mockResolvedValueOnce(new Response('caído', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await reenviarAConexa('{"x":1}', { esperaMs: 1 });
    expect(r).toMatchObject({ ok: true, status: 200, intentos: 2 });
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(fetchFalso.mock.calls[0][0]).toBe(CONEXA_FORWARD_URL);
    expect(fetchFalso.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"x":1}' });
  });

  it('un rechazo (400) no se reintenta: reenviar lo mismo no lo arregla', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response('evento inválido', { status: 400 }));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await reenviarAConexa('{}', { esperaMs: 1 });
    expect(r).toMatchObject({ ok: false, status: 400, intentos: 1 });
    expect(r.error).toContain('evento inválido');
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('sin respuesta (red caída) queda como error claro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    const r = await reenviarAConexa('{}', { esperaMs: 1, timeoutMs: 5000 });
    expect(r).toMatchObject({ ok: false, status: null, intentos: 2, error: 'sin respuesta en 5 s' });
  });
});

describe('Webhook de Wompi', () => {
  let POST: (req: Request) => Promise<Response>;
  const llamar = (cuerpo: any) => POST(new Request('https://crm/api/webhook/wompi', { method: 'POST', body: JSON.stringify(cuerpo) }));

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@/lib/conexa', () => ({ reenviarAConexa: sim.reenvio }));
    process.env.WOMPI_EVENT_SECRET = SECRETO;
    sim.eventos.length = 0;
    sim.procesarBot.mockClear();
    sim.reenvio.mockReset();
    ({ POST } = await import('@/app/api/webhook/wompi/route'));
  });
  afterEach(() => vi.doUnmock('@/lib/conexa'));

  it('pago de la tienda entregado a Conexa: 200 y queda el rastro', async () => {
    sim.reenvio.mockResolvedValue({ ok: true, status: 200, intentos: 1, error: null });
    const r = await llamar(evento(pagoKevin));
    expect(r.status).toBe(200);
    expect(sim.reenvio).toHaveBeenCalledTimes(1);
    expect(sim.eventos).toEqual([expect.objectContaining({ nivel: 'info', origen: 'wompi', mensaje: expect.stringContaining('rbgGhYIyMZ8MZY4uoxT3hd6gO') })]);
    expect(sim.procesarBot).not.toHaveBeenCalled();
  });

  it('si Conexa no lo recibe: error visible con el evento original y 502 para que Wompi lo reintente', async () => {
    sim.reenvio.mockResolvedValue({ ok: false, status: null, intentos: 2, error: 'sin respuesta en 7 s' });
    const cuerpo = evento(pagoKevin);
    const r = await llamar(cuerpo);
    expect(r.status).toBe(502);
    const error = sim.eventos.find((e) => e.nivel === 'error');
    expect(error?.mensaje).toMatch(/no recibió el pago rbgGhYIyMZ8MZY4uoxT3hd6gO.*créalo a mano/);
    expect(JSON.parse(error?.detalle.evento)).toEqual(cuerpo);
  });

  it('si Conexa lo rechaza (4xx): error visible pero sin pedirle a Wompi que repita', async () => {
    sim.reenvio.mockResolvedValue({ ok: false, status: 400, intentos: 1, error: 'HTTP 400: sesión expirada' });
    const r = await llamar(evento(pagoKevin));
    expect(r.status).toBe(200);
    expect(sim.eventos.find((e) => e.nivel === 'error')?.mensaje).toMatch(/sesión expirada.*créalo a mano/);
  });

  it('un pago pendiente que Conexa no recibió es aviso, no error', async () => {
    sim.reenvio.mockResolvedValue({ ok: false, status: 503, intentos: 2, error: 'HTTP 503' });
    const r = await llamar(evento({ ...pagoKevin, status: 'PENDING' }));
    expect(r.status).toBe(502);
    expect(sim.eventos.map((e) => e.nivel)).toEqual(['aviso']);
  });

  it('un pago del bot no depende de Conexa: se procesa y responde 200', async () => {
    sim.reenvio.mockResolvedValue({ ok: false, status: 404, intentos: 1, error: 'HTTP 404' });
    const r = await llamar(evento({ ...pagoKevin, reference: 'b0Qh1H_1794254902_uYjy9i3X9', payment_link_id: 'b0Qh1H' }));
    expect(r.status).toBe(200);
    expect(sim.procesarBot).toHaveBeenCalledTimes(1);
    expect(sim.eventos.filter((e) => e.nivel === 'error')).toHaveLength(0);
  });

  it('firma falsa: se rechaza y no se procesa nada', async () => {
    sim.reenvio.mockResolvedValue({ ok: true, status: 200, intentos: 1, error: null });
    const falso = evento({ ...pagoKevin, reference: 'WA-1-x' });
    falso.signature.checksum = 'a'.repeat(64);
    const r = await llamar(falso);
    expect(r.status).toBe(401);
    expect(sim.procesarBot).not.toHaveBeenCalled();
  });
});

describe('Pagos de la tienda sin pedido en Shopify', () => {
  const ahora = new Date('2026-11-11T17:00:00Z');

  it('distingue la tienda web de los links del bot y los links de cobro manual', () => {
    expect(esPagoDeLaTienda(pagoKevin)).toBe(true);
    expect(esPagoDeLaTienda({ reference: 'WA-1794254854468-d782149c' })).toBe(false);
    expect(esPagoDeLaTienda({ reference: 'VPOS_PTbm1h_1794336949919_80', payment_link_id: 'VPOS_PTbm1h' })).toBe(false);
  });

  it('el pago de Kevin (aprobado, sin pedido) se detecta', () => {
    expect(pagosSinPedido([pagoKevin], new Set(), ahora).map((t) => t.reference)).toEqual(['rbgGhYIyMZ8MZY4uoxT3hd6gO']);
  });

  it('un pago que ya es pedido en Shopify (payment_id) no se alerta', () => {
    const p2689 = { ...pagoKevin, reference: 'rDZHR8eRBkF1qjmghTyBuYsCZ' };
    expect(pagosSinPedido([p2689], new Set(['rDZHR8eRBkF1qjmghTyBuYsCZ']), ahora)).toEqual([]);
  });

  it('espera 20 minutos (la app tarda en crear el pedido) y mira solo las últimas 48 horas', () => {
    const reciente = { ...pagoKevin, created_at: '2026-11-11T16:50:00Z', finalized_at: '2026-11-11T16:50:30Z' };
    const viejo = { ...pagoKevin, created_at: '2026-11-08T10:00:00Z', finalized_at: '2026-11-08T10:00:30Z' };
    expect(pagosSinPedido([reciente, viejo], new Set(), ahora)).toEqual([]);
  });

  it('pagos rechazados, del bot o de links manuales no se alertan', () => {
    const otros = [
      { ...pagoKevin, status: 'DECLINED' },
      { ...pagoKevin, reference: 'WA-1-x' },
      { ...pagoKevin, reference: 'VPOS_PTbm1h_1', payment_link_id: 'VPOS_PTbm1h' },
    ];
    expect(pagosSinPedido(otros, new Set(), ahora)).toEqual([]);
  });
});

describe('Estados de pedidos al día con Shopify', () => {
  const crm = [
    { shopify_order_id: 6001, estado_financiero: 'paid', estado_fulfillment: null }, // #2689: despachado en Shopify
    { shopify_order_id: 6002, estado_financiero: 'paid', estado_fulfillment: 'fulfilled' }, // al día
    { shopify_order_id: 6003, estado_financiero: 'paid', estado_fulfillment: null }, // cancelado en Shopify
  ];

  it('toma de Shopify el despacho y la cancelación que el CRM no recibió', () => {
    const cambios = cambiosDePedidos([
      { id: 6001, financial_status: 'paid', fulfillment_status: 'fulfilled' },
      { id: 6002, financial_status: 'paid', fulfillment_status: 'fulfilled' },
      { id: 6003, financial_status: 'refunded', fulfillment_status: null, cancelled_at: '2026-11-10T12:00:00Z' },
      { id: 9999, financial_status: 'pending', fulfillment_status: null }, // no está en el CRM: lo guarda orders/paid
    ], crm);
    expect(cambios).toEqual([
      { shopify_order_id: '6001', estado_financiero: 'paid', estado_fulfillment: 'fulfilled' },
      { shopify_order_id: '6003', estado_financiero: 'cancelled', estado_fulfillment: null },
    ]);
  });
});

describe('Carritos de clientes que sí compraron', () => {
  const pedido = (extra: any) => ({ email: 'rogergomez780@gmail.com', telefono: '3006318287', estado_financiero: 'paid', shopify_created_at: '2026-10-27T22:32:00Z', ...extra });

  it('el carrito registrado minutos después del pedido queda como "Compró" (Roger Gómez, #2683)', () => {
    const carritos = [{ id: 'c1', email: 'RogerGomez780@gmail.com', telefono: null, estado: 'abandonado', shopify_created_at: '2026-10-27T22:35:00Z' }];
    expect(carritosYaComprados(carritos, [pedido({})])).toEqual(['c1']);
  });

  it('cruza por celular aunque el correo sea otro', () => {
    const carritos = [{ id: 'c2', email: 'otro@correo.co', telefono: '573006318287', estado: 'notificado', shopify_created_at: '2026-10-27T20:00:00Z' }];
    expect(carritosYaComprados(carritos, [pedido({ email: null })])).toEqual(['c2']);
  });

  it('un pedido viejo (más de 2 h antes del carrito) o cancelado no cuenta', () => {
    const carritos = [{ id: 'c3', email: 'rogergomez780@gmail.com', telefono: null, estado: 'abandonado', shopify_created_at: '2026-10-28T10:00:00Z' }];
    expect(carritosYaComprados(carritos, [pedido({}), pedido({ estado_financiero: 'voided', shopify_created_at: '2026-10-28T11:00:00Z' })])).toEqual([]);
  });

  it('el de Kevin (pagó pero no hay pedido) sigue sin "Compró" hasta que exista el pedido', () => {
    const carritos = [{ id: 'k', email: 'kevinholguin1507@gmail.com', telefono: '573234544561', estado: 'notificado', shopify_created_at: '2026-11-10T15:32:00Z' }];
    expect(carritosYaComprados(carritos, [pedido({})])).toEqual([]);
  });
});
