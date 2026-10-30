// Recuperación de carritos de la tienda online por WhatsApp. Antes salían como
// texto libre y Meta los descartaba si el cliente no había escrito en 24 h.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sim = vi.hoisted(() => ({
  registro: [] as Array<{ tabla: string; op: string; args: any[] }>,
  datos: {} as Record<string, any>,
  texto: vi.fn(async () => ({ success: true, messageId: 'wamid.texto' })),
  plantilla: vi.fn(async () => ({ success: true, messageId: 'wamid.plantilla' })),
}));

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso, productos } = await import('./apoyo/simulador');
  return {
    supabaseAdmin: crearSupabaseFalso(sim.registro, sim.datos),
    obtenerProductosCache: async () => productos,
    actualizarCliente: async () => {},
    obtenerPedidosClienteShopify: async () => [],
    buscarOCrearCliente: async () => ({ id: 'cliente-nuevo' }),
    obtenerConversacionActiva: async () => ({ id: 'conv-nueva' }),
  };
});
vi.mock('@/lib/ai-sofi', () => ({ procesarMensajeSofi: vi.fn() }));
vi.mock('@/lib/whatsapp', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp')>()),
  enviarMensajeWhatsApp: sim.texto,
  enviarPlantillaWhatsApp: sim.plantilla,
}));

import { horaDeEnviar, resumenCarrito, recuperarCarrito, avanzarCampanaCarritos } from '@/lib/recuperacion';
import { clasificarRespuestaCarrito } from '@/lib/bot/carrito-tienda';
import { procesarMensajeBot } from '@/lib/bot-logic';
import { contexto, bot } from './apoyo/simulador';

// 10:00 a. m. en Colombia (UTC-5)
const MANANA = new Date('2026-10-29T15:00:00Z');

const carrito = {
  id: 'carrito-1',
  shopify_checkout_id: '9001',
  nombre: 'Ana María Ríos',
  telefono: '573001112233',
  email: 'ana@correo.co',
  total: 110720,
  url_checkout: 'https://tiendacommerkant.com.co/checkouts/abc/recover',
  items: [{ title: 'Aguardiente Amarillo de Manzanares 750ml', quantity: 2 }],
  shopify_created_at: '2026-10-29T13:00:00Z',
};

const inserciones = (tabla: string) => sim.registro.filter((r) => r.tabla === tabla && r.op === 'insert').map((r) => r.args[0]);

beforeEach(() => {
  sim.registro.length = 0;
  for (const k of Object.keys(sim.datos)) delete sim.datos[k];
  sim.datos.carritos_abandonados = [{ id: 'carrito-1' }]; // el reclamo del carrito lo logra este proceso
  sim.texto.mockClear();
  sim.plantilla.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MANANA);
});
afterEach(() => vi.useRealTimers());

describe('Horario de los recordatorios (hora de Colombia)', () => {
  it.each([
    ['2026-10-29T12:59:00Z', false], // 7:59 a. m.
    ['2026-10-29T13:00:00Z', true], // 8:00 a. m.
    ['2026-10-30T00:59:00Z', true], // 7:59 p. m.
    ['2026-10-30T01:00:00Z', false], // 8:00 p. m.
    ['2026-10-29T08:00:00Z', false], // 3:00 a. m.
  ])('%s → %s', (iso, esperado) => expect(horaDeEnviar(new Date(iso))).toBe(esperado));
});

describe('Resumen del carrito para la plantilla', () => {
  it('un producto', () => expect(resumenCarrito([{ title: 'Ron Viejo de Caldas', quantity: 1 }])).toBe('Ron Viejo de Caldas'));
  it('con cantidad', () => expect(resumenCarrito([{ title: 'Ron', quantity: 3 }])).toBe('Ron x3'));
  it('dos productos', () => expect(resumenCarrito([{ title: 'A', quantity: 1 }, { title: 'B', quantity: 1 }])).toBe('A y B'));
  it('varios', () => expect(resumenCarrito([{ title: 'A', quantity: 1 }, { title: 'B', quantity: 1 }, { title: 'C', quantity: 1 }])).toBe('A y 2 productos más'));
  it('sin saltos de línea (WhatsApp los rechaza en una plantilla)', () => expect(resumenCarrito([{ title: 'Kit\nDecantador', quantity: 1 }])).toBe('Kit Decantador'));
  it('vacío', () => expect(resumenCarrito([])).toBe('tus productos'));
});

describe('Envío del recordatorio', () => {
  it('cliente que nunca escribió: va la plantilla aprobada, no texto libre', async () => {
    const r = await recuperarCarrito(carrito);
    expect(r).toEqual({ enviado: true, via: 'plantilla' });
    expect(sim.texto).not.toHaveBeenCalled();
    const [telefono, plantilla, idioma, componentes] = sim.plantilla.mock.calls[0] as any[];
    expect([telefono, plantilla, idioma]).toEqual(['573001112233', 'carrito_abandonado', 'es']);
    expect(componentes[0].parameters.map((p: any) => p.text)).toEqual(['Ana', 'Aguardiente Amarillo de Manzanares 750ml x2', expect.stringContaining('110')]);
  });

  it('queda en el chat del CRM con el link, para que el bot entienda la respuesta', async () => {
    await recuperarCarrito(carrito);
    const msg = inserciones('mensajes')[0];
    expect(msg.conversacion_id).toBe('conv-nueva');
    expect(msg.metadata).toMatchObject({ evento: 'carrito_recuperacion', carrito_url: carrito.url_checkout, whatsapp_message_id: 'wamid.plantilla' });
    expect(inserciones('notificaciones_wa')[0]).toMatchObject({ estado: 'enviado', whatsapp_message_id: 'wamid.plantilla' });
  });

  it('cliente que escribió hoy: va el texto con el link del carrito', async () => {
    sim.datos.clientes = { id: 'cliente-1', nombre: 'Ana', no_publicidad: false };
    sim.datos.conversaciones = { id: 'conv-1', estado_atencion: 'bot' };
    sim.datos.mensajes = { created_at: new Date(MANANA.getTime() - 3_600_000).toISOString() };
    const r = await recuperarCarrito(carrito);
    expect(r.via).toBe('texto');
    expect(sim.plantilla).not.toHaveBeenCalled();
    expect((sim.texto.mock.calls[0] as any[])[1]).toContain(carrito.url_checkout);
  });

  it('de noche no se escribe (queda para la mañana)', async () => {
    vi.setSystemTime(new Date('2026-10-29T08:00:00Z'));
    const r = await recuperarCarrito(carrito);
    expect(r.enviado).toBe(false);
    expect(sim.plantilla).not.toHaveBeenCalled();
    expect(inserciones('notificaciones_wa')).toHaveLength(0);
  });

  it('quien pidió no recibir publicidad no recibe nada', async () => {
    sim.datos.clientes = { id: 'cliente-1', nombre: 'Ana', no_publicidad: true };
    const r = await recuperarCarrito(carrito);
    expect(r.enviado).toBe(false);
    expect(sim.plantilla).not.toHaveBeenCalled();
    expect(inserciones('notificaciones_wa')[0]).toMatchObject({ estado: 'omitido' });
  });

  it('si lo atiende un asesor, el envío automático no interrumpe', async () => {
    sim.datos.clientes = { id: 'cliente-1', nombre: 'Ana', no_publicidad: false };
    sim.datos.conversaciones = { id: 'conv-1', estado_atencion: 'en_atencion' };
    expect((await recuperarCarrito(carrito)).enviado).toBe(false);
    expect(sim.plantilla).not.toHaveBeenCalled();
  });

  it('si otro proceso ya tomó el carrito, no se envía dos veces', async () => {
    sim.datos.carritos_abandonados = [];
    const r = await recuperarCarrito(carrito);
    expect(r.enviado).toBe(false);
    expect(sim.plantilla).not.toHaveBeenCalled();
  });

  it('un celular que no es colombiano no se usa', async () => {
    const r = await recuperarCarrito({ ...carrito, telefono: '0622021234' });
    expect(r.enviado).toBe(false);
    expect(sim.plantilla).not.toHaveBeenCalled();
  });
});

describe('Respuesta del cliente al recordatorio', () => {
  it.each(['Sí', 'si por favor', 'Hola', 'quiero terminar la compra', 'mándame el link', 'me interesa'])(
    '"%s" pide el link', (t) => expect(clasificarRespuestaCarrito(t)).toBe('si'));
  it.each(['no me interesa', 'No', 'no gracias'])('"%s" no lo quiere', (t) => expect(clasificarRespuestaCarrito(t)).toBe('no'));
  it.each(['después', 'más tarde', 'ahorita no'])('"%s" lo deja para luego', (t) => expect(clasificarRespuestaCarrito(t)).toBe('luego'));
  it('"ya lo compré"', () => expect(clasificarRespuestaCarrito('ya lo compré')).toBe('ya_compro'));
  it.each(['buenas tardes, ¿hacen envíos a Rionegro?', 'cuánto vale el ron de 375?'])(
    '"%s" es otra consulta', (t) => expect(clasificarRespuestaCarrito(t)).toBeNull());

  const recordatorio = (horasAtras = 1) => bot('👋 Hola Ana, ¿olvidaste algo?', {
    evento: 'carrito_recuperacion', carrito_url: carrito.url_checkout, carrito_productos: 'Aguardiente x2', carrito_total: '$ 110.720',
  }, horasAtras);

  it('cliente nuevo que responde "Sí": recibe su link sin pasar por las políticas', async () => {
    const r = await procesarMensajeBot('Sí', contexto({ politicas: false, sede: null, nombre: 'Ana', historial: [recordatorio()] }));
    expect(r.texto).toContain(carrito.url_checkout);
    expect(r.texto).not.toMatch(/pol[ií]ticas/i);
  });

  it('una pregunta distinta sigue el flujo normal', async () => {
    const r = await procesarMensajeBot('¿hacen envíos a Rionegro?', contexto({ politicas: false, sede: null, historial: [recordatorio()] }));
    expect(r.texto).not.toContain(carrito.url_checkout);
    expect(r.texto).toMatch(/pol[ií]ticas/i);
  });

  it('un recordatorio de hace más de 3 días ya no cuenta', async () => {
    const r = await procesarMensajeBot('Sí', contexto({ politicas: false, sede: null, historial: [recordatorio(80)] }));
    expect(r.texto).not.toContain(carrito.url_checkout);
  });

  it('"no me manden más mensajes" lo da de baja de la publicidad', async () => {
    const r = await procesarMensajeBot('no me manden más mensajes', contexto({ politicas: false, sede: null, historial: [recordatorio()] }));
    expect(r.texto).toMatch(/no te enviaremos más/i);
    expect(sim.registro.some((x) => x.tabla === 'clientes' && x.op === 'update' && x.args[0]?.no_publicidad === true)).toBe(true);
  });
});

describe('Campaña programada de carritos de varios días', () => {
  const campana = (inicia: string) => ({ valor: { carritos_desde: '2026-09-29T15:00:00Z', inicia, estado: 'pendiente' } });
  const carritos = [
    { ...carrito, id: 'c1', shopify_checkout_id: '1', shopify_updated_at: '2026-10-28T15:00:00Z' },
    { ...carrito, id: 'c2', shopify_checkout_id: '2', shopify_updated_at: '2026-10-20T15:00:00Z' }, // misma persona, más viejo
    { ...carrito, id: 'c3', shopify_checkout_id: '3', telefono: '573104445566', nombre: 'Pedro', shopify_updated_at: '2026-10-15T15:00:00Z' },
  ];
  const guardada = () => sim.registro.filter((r) => r.tabla === 'configuracion' && r.op === 'upsert').at(-1)?.args[0]?.valor;

  it('no sale antes de la hora programada', async () => {
    sim.datos.configuracion = campana('2026-10-30T13:00:00Z');
    sim.datos.carritos_abandonados = carritos;
    expect(await avanzarCampanaCarritos(Date.now() + 40_000)).toBeNull();
    expect(sim.plantilla).not.toHaveBeenCalled();
  });

  it('un mensaje por persona (su carrito más reciente) y queda terminada', async () => {
    sim.datos.configuracion = campana('2026-10-29T13:00:00Z');
    sim.datos.carritos_abandonados = carritos;
    const r = await avanzarCampanaCarritos(Date.now() + 40_000);
    expect(r).toEqual({ enviados: 2, omitidos: 0, terminada: true });
    expect(sim.plantilla.mock.calls.map((c: any[]) => c[0])).toEqual(['573001112233', '573104445566']);
    expect(guardada()).toMatchObject({ estado: 'terminada', enviados: 2 });
  });

  it('de noche espera a la mañana', async () => {
    vi.setSystemTime(new Date('2026-10-30T03:00:00Z')); // 10 p. m.
    sim.datos.configuracion = campana('2026-10-29T13:00:00Z');
    sim.datos.carritos_abandonados = carritos;
    expect(await avanzarCampanaCarritos(Date.now() + 40_000)).toBeNull();
    expect(sim.plantilla).not.toHaveBeenCalled();
  });

  it('si se acaba el tiempo, sigue en la próxima revisión', async () => {
    sim.datos.configuracion = campana('2026-10-29T13:00:00Z');
    sim.datos.carritos_abandonados = carritos;
    const r = await avanzarCampanaCarritos(Date.now() - 1);
    expect(r?.terminada).toBe(false);
    expect(guardada()).toMatchObject({ estado: 'en_curso' });
  });
});

describe('Notificaciones de pedidos de la tienda', async () => {
  const { notificarPedidoConfirmado, notificarPedidoEnviado } = await import('@/lib/notificaciones');
  const pedido = {
    shopify_order_id: '555', shopify_order_number: '1045', nombre_cliente: 'Laura Gómez', telefono: '573001112233',
    total: 110720, items: [{ title: 'Ron Viejo de Caldas 750 ml', quantity: 2, price: '55360' }],
  };

  it('comprador que no ha escrito al bot: va la plantilla de utilidad', async () => {
    await notificarPedidoConfirmado(pedido);
    expect(sim.texto).not.toHaveBeenCalled();
    const [, plantilla, , comp] = sim.plantilla.mock.calls[0] as any[];
    expect(plantilla).toBe('pedido_tienda_recibido');
    expect(comp[0].parameters.map((p: any) => p.text)).toEqual(['Laura', '1045', 'Ron Viejo de Caldas 750 ml x2', expect.stringContaining('110')]);
  });

  it('cliente que escribió hoy: va el texto completo', async () => {
    sim.datos.clientes = { id: 'cliente-1' };
    sim.datos.conversaciones = [{ id: 'conv-1' }];
    sim.datos.mensajes = { id: 'm1' };
    await notificarPedidoConfirmado(pedido);
    expect(sim.plantilla).not.toHaveBeenCalled();
    expect((sim.texto.mock.calls[0] as any[])[1]).toContain('#1045');
  });

  it('pedido para recoger en tienda: no se avisa "despachado"', async () => {
    const r = await notificarPedidoEnviado({ ...pedido, con_envio: false });
    expect(r.success).toBe(false);
    expect(sim.plantilla).not.toHaveBeenCalled();
    expect(sim.texto).not.toHaveBeenCalled();
  });

  it('pedido con envío y guía: plantilla con la guía', async () => {
    await notificarPedidoEnviado({ ...pedido, con_envio: true, tracking_company: 'Servientrega', tracking_number: '2049876543' });
    const [, plantilla, , comp] = sim.plantilla.mock.calls[0] as any[];
    expect(plantilla).toBe('pedido_tienda_despachado');
    expect(comp[0].parameters[2].text).toBe('Guía Servientrega 2049876543');
  });
});
