// Black Week 2026: precios del catálogo con su "antes", límite de 6 unidades
// por cliente al día (chat + tienda) y lo que Sofi sabe de la temporada.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sim = vi.hoisted(() => ({ datos: {} as Record<string, any>, registro: [] as any[] }));

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso, productos } = await import('./apoyo/simulador');
  return {
    get supabaseAdmin() { return crearSupabaseFalso(sim.registro, sim.datos); },
    obtenerProductosCache: async () => productos,
    actualizarCliente: vi.fn(async () => {}),
    obtenerPedidosClienteShopify: async () => [],
  };
});
vi.mock('@/lib/ai-sofi', () => ({ procesarMensajeSofi: vi.fn(async () => ({ texto: 'Respuesta de Sofi', metadata: { awaiting: '' } })) }));
vi.mock('@/lib/whatsapp', async (o) => ({ ...(await o<typeof import('@/lib/whatsapp')>()), enviarMensajeWhatsApp: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/whatsapp-templates', () => ({ enviarLeadMayorista: vi.fn(async () => true) }));
vi.mock('@/lib/eventos', () => ({ registrarEvento: vi.fn(async () => {}) }));

import { procesarMensajeBot } from '@/lib/bot-logic';
import { unidadesDelCliente, limiteActivo, textoLimite, unidadesCarrito, LIMITE_UNIDADES } from '@/lib/limite-diario';
import { textoTemporadaSofi } from '@/lib/temporada';
import { preciosActualizados } from '@/lib/precios-mercado';
import { contexto, bot, cliente, producto } from './apoyo/simulador';

const EN_BLACK_WEEK = new Date('2026-11-24T15:00:00Z'); // 24 nov, 10 a. m. en Colombia
const ANTES = new Date('2026-11-20T15:00:00Z');
const cartaDeOro = producto('Ron Viejo de Caldas Carta de Oro 750');
const item = (cantidad: number) => ({ shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad });

async function conversar(mensajes: string[], historial: any[] = []) {
  const h = [...historial];
  const respuestas: any[] = [];
  for (const m of mensajes) {
    const r = await procesarMensajeBot(m, contexto({ historial: h }));
    respuestas.push(r);
    h.push(cliente(m), bot(r.texto, r.metadata || {}));
  }
  return { respuestas, ultima: respuestas[respuestas.length - 1] };
}

beforeEach(() => { sim.datos = {}; sim.registro.length = 0; vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('Límite de unidades por día', () => {
  it('rige del 23 al 30 de noviembre (hora de Colombia)', () => {
    expect(LIMITE_UNIDADES).toBe(6);
    expect(limiteActivo(new Date('2026-11-23T05:00:00Z'))).toBe(true);  // 23 nov 00:00 Colombia
    expect(limiteActivo(new Date('2026-11-23T04:59:00Z'))).toBe(false); // 22 nov 11:59 p. m.
    expect(limiteActivo(new Date('2026-12-01T04:59:00Z'))).toBe(true);  // 30 nov 11:59 p. m.
    expect(limiteActivo(new Date('2026-12-01T05:00:00Z'))).toBe(false);
  });

  it('suma tienda y chat del mismo cliente, sin el regalo y sin contar dos veces el pedido del bot', () => {
    const cli = { id: 'c1', telefono: '573001234567', email: 'laura@gmail.com' };
    const pedidos = [
      { telefono: '+57 300 123 4567', items: [{ quantity: 2, price: 61204 }, { quantity: 1, price: 0 }] },       // tienda, con la gorra en $0
      { email: 'LAURA@gmail.com', items: [{ quantity: 1, price: 9365 }] },                                        // tienda, por correo
      { cliente_id: 'c1', items: [{ quantity: 2, price: 95700 }], direccion_envio: { referencia_pago: 'WA-1' } }, // pedido del bot
      { telefono: '573119998888', items: [{ quantity: 5, price: 50000 }] },                                       // otro cliente
    ];
    const ventas = [{ cantidad: 2, referencia_pago: 'WA-1' }, { cantidad: 1, referencia_pago: 'WA-2' }];      // WA-2 sin pedido en Shopify
    expect(unidadesDelCliente(pedidos, ventas, cli)).toBe(6);
  });

  it('un cliente con usuario de WhatsApp (sin número) no se confunde con otro', () => {
    expect(unidadesDelCliente([{ telefono: '573001234567', items: [{ quantity: 3, price: 1 }] }], [], { id: 'x', telefono: 'CO.13491208655302741918' })).toBe(0);
  });

  it('el mensaje dice cuántas le quedan', () => {
    expect(textoLimite(4, 3)).toMatch(/hasta \*2\* más/);
    expect(textoLimite(6, 1)).toMatch(/ya completaste/);
    expect(unidadesCarrito([{ cantidad: 2, precio: 1000 }, { cantidad: 1, precio: 0 }])).toBe(2);
  });
});

describe('Sofi aplica el límite en Black Week', () => {
  const esperandoCantidad = (cart: any[] = []) => [bot('¿Cuántas quieres?', { awaiting: 'cantidad', pending_product_id: cartaDeOro.shopify_id, pending_cart: cart })];

  it('pide 8: le deja 6 y le explica por qué', async () => {
    vi.setSystemTime(EN_BLACK_WEEK);
    const { ultima } = await conversar(['8'], esperandoCantidad());
    expect(ultima.metadata?.pending_cart?.[0]?.cantidad).toBe(6);
    expect(ultima.texto).toMatch(/hasta \*6 unidades al día\*, así que te dejé \*6\*/);
  });

  it('si ya compró 5 hoy en la tienda, solo puede llevar 1 más', async () => {
    vi.setSystemTime(EN_BLACK_WEEK);
    sim.datos = { pedidos_shopify: [{ telefono: '573001234567', items: [{ quantity: 5, price: 61204 }] }] };
    const { ultima } = await conversar(['3'], esperandoCantidad());
    expect(ultima.metadata?.pending_cart?.[0]?.cantidad).toBe(1);
  });

  it('si ya completó las 6, no agrega nada', async () => {
    vi.setSystemTime(EN_BLACK_WEEK);
    sim.datos = { pedidos_shopify: [{ telefono: '573001234567', items: [{ quantity: 6, price: 61204 }] }] };
    const { ultima } = await conversar(['1'], esperandoCantidad());
    expect(ultima.texto).toMatch(/ya completaste/);
    expect(ultima.metadata?.pending_cart || []).toEqual([]);
  });

  it('un carrito de 7 no pasa al cierre: vuelve al carrito para ajustarlo', async () => {
    vi.setSystemTime(EN_BLACK_WEEK);
    const { ultima } = await conversar(['listo, eso es todo'], [bot('Tu carrito', { awaiting: 'carrito', pending_cart: [item(7)] })]);
    expect(ultima.metadata?.awaiting).toBe('carrito');
    expect(ultima.texto).toMatch(/hasta \*6 unidades al día\*/);
  });

  it('antes de Black Week no hay límite (8 unidades al precio del catálogo)', async () => {
    vi.setSystemTime(ANTES);
    const { ultima } = await conversar(['8'], esperandoCantidad());
    expect(ultima.metadata?.pending_cart?.[0]?.cantidad).toBe(8);
  });

  it('al confirmar se revisa otra vez (pudo comprar en la tienda mientras tanto)', async () => {
    vi.setSystemTime(EN_BLACK_WEEK);
    sim.datos = { pedidos_shopify: [{ telefono: '573001234567', items: [{ quantity: 5, price: 61204 }] }] };
    const { ultima } = await conversar(['si'], [bot('Resumen', { awaiting: 'confirmacion', pending_cart: [item(2)], pending_direccion: 'Calle 1 # 2-3, Medellín', pending_subtotal: 191400, pending_costo_envio: 0, pending_total: 191400 })]);
    expect(ultima.accion).not.toBe('generar_link_pago');
    expect(ultima.texto).toMatch(/puedes llevar hasta \*1\* más/);
  });
});

describe('Lo que Sofi sabe de Black Week', () => {
  it('durante: precios 🔥 BLACK con su antes y el límite diario', () => {
    const t = textoTemporadaSofi(EN_BLACK_WEEK);
    expect(t).toMatch(/ESTAMOS EN BLACK WEEK/);
    expect(t).toMatch(/🔥 BLACK/);
    expect(t).toMatch(/máximo 6 unidades por cliente al día/);
  });
  it('antes: cuándo empieza y que habrá límite, sin prometer porcentajes', () => {
    const t = textoTemporadaSofi(ANTES);
    expect(t).toMatch(/del 23 al 30 de noviembre/);
    expect(t).toMatch(/máximo 6 unidades/);
    expect(t).toMatch(/No prometas porcentajes/);
  });
});

describe('Precio de antes (catálogo de Black Friday)', () => {
  const bases = new Map([['11', 69030], ['21', 313400], ['22', 235200]]);

  it('producto simple: guarda el precio de antes al empezar y lo borra al terminar', () => {
    const fila = { id: 'a', shopify_id: '1', precio: 69030, metadata: { otro: 1 } };
    expect(preciosActualizados(fila, new Map([['11', 61204]]), bases)).toEqual({ precio: 61204, metadata: { otro: 1, precio_antes: 69030 } });
    const enOferta = { ...fila, precio: 61204, metadata: { otro: 1, precio_antes: 69030 } };
    expect(preciosActualizados(enOferta, new Map([['11', 61204]]), bases)).toBeNull();
    expect(preciosActualizados(enOferta, new Map([['11', 69030]]), bases)).toEqual({ precio: 69030, metadata: { otro: 1 } });
  });

  it('si el precio ya era el de oferta pero faltaba el "antes", lo completa', () => {
    const fila = { id: 'a', shopify_id: '1', precio: 61204, metadata: null };
    expect(preciosActualizados(fila, new Map([['11', 61204]]), bases)).toEqual({ precio: 61204, metadata: { precio_antes: 69030 } });
  });

  it('kit: cada botella rebajada lleva su antes', () => {
    const fila = { id: 'k', shopify_id: '2', precio: 235200, metadata: { variantes: [{ id: '21', titulo: 'Carta de Oro', precio: 313400, inventario: 3 }, { id: '22', titulo: 'Esencial', precio: 235200, inventario: 9 }] } };
    const r = preciosActualizados(fila, new Map([['21', 284142], ['22', 235200]]), bases);
    expect(r?.metadata?.variantes).toEqual([
      { id: '21', titulo: 'Carta de Oro', precio: 284142, inventario: 3, precio_antes: 313400 },
      { id: '22', titulo: 'Esencial', precio: 235200, inventario: 9 },
    ]);
  });
});
