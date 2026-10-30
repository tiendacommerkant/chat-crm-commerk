// Conversaciones completas con el bot, mensaje por mensaje, como en WhatsApp.
// La base de datos, Sofi (IA) y WhatsApp están simulados: nada sale a la red.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sim = vi.hoisted(() => ({
  registro: [] as Array<{ tabla: string; op: string; args: any[] }>,
  sofi: vi.fn(),
  actualizarCliente: vi.fn(async () => {}),
}));

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso, productos } = await import('./apoyo/simulador');
  return {
    supabaseAdmin: crearSupabaseFalso(sim.registro),
    obtenerProductosCache: async () => productos,
    actualizarCliente: sim.actualizarCliente,
    obtenerPedidosClienteShopify: async () => [],
  };
});
vi.mock('@/lib/ai-sofi', () => ({ procesarMensajeSofi: sim.sofi }));
vi.mock('@/lib/whatsapp', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp')>()),
  enviarMensajeWhatsApp: vi.fn(async () => ({ success: true, messageId: 'wamid.prueba' })),
}));
vi.mock('@/lib/whatsapp-templates', () => ({ enviarLeadMayorista: vi.fn(async () => true) }));

import { procesarMensajeBot } from '@/lib/bot-logic';
import { contexto, bot, cliente, producto } from './apoyo/simulador';
import type { BotResponse } from '@/types';

/**
 * Le habla al bot mensaje por mensaje. Cada respuesta se guarda en el
 * historial con su estado, igual que hace el webhook de WhatsApp.
 */
async function conversar(mensajes: string[], inicio: { historial?: any[]; etiqueta?: string | null; sede?: string | null; politicas?: boolean } = {}) {
  const historial = [...(inicio.historial || [])];
  const respuestas: BotResponse[] = [];
  for (const m of mensajes) {
    const r = await procesarMensajeBot(m, contexto({ ...inicio, historial }));
    respuestas.push(r);
    historial.push(cliente(m), bot(r.texto, r.metadata || {}));
  }
  return { respuestas, ultima: respuestas[respuestas.length - 1], historial };
}

const cartaDeOro = producto('Ron Viejo de Caldas Carta de Oro 750');
const decantador = producto('Kit Decantador');

beforeEach(() => {
  sim.registro.length = 0;
  sim.actualizarCliente.mockClear();
  sim.sofi.mockReset();
  sim.sofi.mockResolvedValue({ texto: 'Respuesta de Sofi', metadata: { awaiting: '' } });
});

describe('Registro de un cliente nuevo', () => {
  it('primero pide aceptar las políticas de privacidad', async () => {
    const { ultima } = await conversar(['hola'], { politicas: false, sede: null });
    expect(ultima.metadata?.awaiting).toBe('politicas');
    expect(ultima.texto).toMatch(/ACEPTO/);
  });

  it('al aceptar guarda la aceptación y pregunta la sede', async () => {
    const { ultima } = await conversar(['acepto'], { politicas: false, sede: null });
    expect(sim.actualizarCliente).toHaveBeenCalledWith('cliente-1', { politicas_aceptadas: true });
    expect(ultima.metadata?.awaiting).toBe('sede');
  });

  it('acepta la sede escrita como "3." (antes no la reconocía)', async () => {
    const { ultima } = await conversar(['3.'], { sede: null, historial: [bot('¿Cuál es tu sede?', { awaiting: 'sede' })] });
    expect(sim.actualizarCliente).toHaveBeenCalledWith('cliente-1', expect.objectContaining({ sede_preferida: expect.any(String) }));
    expect(ultima.texto).toMatch(/seleccionada/);
  });

  it('acepta la sede por nombre', async () => {
    const { ultima } = await conversar(['la del tesoro'], { sede: null, historial: [bot('¿Cuál es tu sede?', { awaiting: 'sede' })] });
    expect(ultima.texto).toMatch(/Tesoro/i);
  });
});

describe('Compra completa a domicilio', () => {
  it('de "quiero comprar carta de oro 750" hasta el link de pago', async () => {
    const { respuestas, ultima } = await conversar([
      'quiero comprar carta de oro 750',
      '2',
      'no, eso es todo',
      'a domicilio',
      'Calle 10 # 40-20, El Poblado, Medellín',
      'si',
    ]);
    expect(respuestas[0].metadata?.awaiting).toBe('cantidad');
    expect(respuestas[1].metadata?.pending_cart?.[0]?.cantidad).toBe(2);
    expect(respuestas[3].metadata?.awaiting).toBe('direccion');
    expect(respuestas[4].metadata?.awaiting).toBe('confirmacion');
    expect(ultima.accion).toBe('generar_link_pago');
    const item = ultima.metadata?.pending_cart?.[0];
    expect(item.titulo).toMatch(/carta de oro/i);
    expect(ultima.metadata?.pending_total).toBe(ultima.metadata!.pending_subtotal + ultima.metadata!.pending_costo_envio);
  });

  it('sin el tamaño no adivina: Sofi pregunta cuál (hay 375 y 750 ml)', async () => {
    const { ultima } = await conversar(['quiero comprar carta de oro']);
    expect(sim.sofi).toHaveBeenCalled();
    expect(ultima.metadata?.awaiting).not.toBe('cantidad');
  });

  it('el envío es gratis desde $149.000', async () => {
    const { respuestas } = await conversar(['quiero comprar carta de oro 750', '4', 'listo', 'domicilio', 'Carrera 43A # 1-50, Envigado']);
    const resumen = respuestas[4];
    expect(resumen.metadata?.pending_subtotal).toBeGreaterThanOrEqual(149000);
    expect(resumen.metadata?.pending_costo_envio).toBe(0);
  });

  it('no acepta una dirección sin número', async () => {
    const { ultima } = await conversar(['no sé todavía'], {
      historial: [bot('¿A qué dirección?', { awaiting: 'direccion', pending_cart: [{ shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad: 1 }] })],
    });
    expect(ultima.metadata?.awaiting).toBe('direccion');
    expect(ultima.texto).toMatch(/dirección completa/);
  });

  it('no envía a municipios fuera de cobertura', async () => {
    const { ultima } = await conversar(['Calle 50 # 45-10, Rionegro'], {
      historial: [bot('¿A qué dirección?', { awaiting: 'direccion', pending_cart: [{ shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad: 1 }] })],
    });
    expect(ultima.metadata?.awaiting).toBe('direccion');
    expect(ultima.texto).toMatch(/no hacemos domicilio/);
  });

  it('recoger en tienda no cobra envío', async () => {
    const carrito = [{ shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad: 1 }];
    const { respuestas } = await conversar(['prefiero recoger', 'tesoro'], {
      historial: [bot('¿Domicilio o recoger?', { awaiting: 'tipo_entrega', pending_cart: carrito })],
    });
    expect(respuestas[1].metadata?.pending_costo_envio).toBe(0);
    expect(respuestas[1].metadata?.pending_direccion).toMatch(/Recoge en tienda/);
  });
});

describe('Cantidades', () => {
  const esperandoCantidad = () => [bot('¿Cuántas quieres?', { awaiting: 'cantidad', pending_product_id: cartaDeOro.shopify_id, pending_cart: [] })];

  it('"3" es una cantidad, no la sede 3', async () => {
    const { ultima } = await conversar(['3'], { historial: esperandoCantidad() });
    expect(ultima.metadata?.pending_cart?.[0]?.cantidad).toBe(3);
    expect(sim.actualizarCliente).not.toHaveBeenCalled();
  });

  it('más de 12 unidades pasa a compra al por mayor sin tocar el carrito', async () => {
    const { ultima } = await conversar(['20'], { historial: esperandoCantidad() });
    expect(ultima.metadata?.awaiting).toBe('mayorista_sede');
    expect(ultima.metadata?.pending_cart ?? []).toHaveLength(0);
  });

  it('más de 12 unidades en una conversación de empresa sigue como venta empresarial', async () => {
    const { ultima } = await conversar(['200'], { historial: esperandoCantidad(), etiqueta: 'empresarial' });
    expect(ultima.metadata?.awaiting).not.toBe('mayorista_sede');
    expect(ultima.metadata?.empresarial || ultima.metadata?.lead_empresarial).toBeTruthy();
  });

  it('"quiero hablar con un asesor" no se lee como cantidad 1', async () => {
    const { ultima } = await conversar(['quiero hablar con un asesor'], { historial: esperandoCantidad() });
    expect(ultima.metadata?.pending_cart ?? []).toHaveLength(0);
  });
});

describe('Kits con botella a elegir', () => {
  it('pregunta la botella y cobra el precio de la elegida', async () => {
    const { respuestas, ultima } = await conversar(['1', 'carta de oro', '1'], {
      historial: [bot('¿Cuántos?', { awaiting: 'cantidad', pending_product_id: decantador.shopify_id, pending_cart: [] })],
    });
    expect(respuestas[0].metadata?.awaiting).toBe('variante');
    expect(respuestas[1].metadata?.awaiting).toBe('cantidad');
    const item = ultima.metadata?.pending_cart?.[0];
    const carta = decantador.metadata.variantes.find((v: any) => /carta de oro/i.test(v.titulo));
    expect(item.titulo).toMatch(/Carta de Oro/);
    expect(item.precio).toBe(carta.precio);
    expect(item.variant_id).toBe(carta.id);
  });
});

describe('Carrito', () => {
  const carritoDos = [
    { shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad: 1 },
    { shopify_id: 'otro', titulo: 'Aguardiente Amarillo 750', precio: 55360, cantidad: 2 },
  ];

  it('"cancelar" vacía el pedido', async () => {
    const { ultima } = await conversar(['cancelar'], { historial: [bot('…', { awaiting: '', pending_cart: carritoDos })] });
    expect(ultima.metadata?.pending_cart).toEqual([]);
  });

  it('"no gracias" cuando pregunta "¿algo más?" cierra el pedido, no lo cancela', async () => {
    const { ultima } = await conversar(['no gracias'], { historial: [bot('¿Algo más?', { awaiting: 'carrito', pending_cart: carritoDos })] });
    expect(ultima.metadata?.awaiting).toBe('tipo_entrega');
    expect(ultima.metadata?.pending_cart).toHaveLength(2);
  });

  it('con varios productos pregunta cuál quitar en vez de borrar todo', async () => {
    const { ultima } = await conversar(['quítalo'], { historial: [bot('¿Algo más?', { awaiting: 'carrito', pending_cart: carritoDos })] });
    expect(ultima.metadata?.pending_cart).toHaveLength(2);
  });

  it('"carrito" con el carrito vacío lo dice', async () => {
    const { ultima } = await conversar(['carrito']);
    expect(ultima.texto).toMatch(/vacío/);
  });
});

describe('Después de enviar el link de pago', () => {
  const linkEnviado = () => [bot('Aquí está tu link', {
    awaiting: 'link_enviado',
    pending_cart: [{ shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad: 1 }],
  })];

  it.each(['Puedo pagar contra entrega?', 'No me da el pago', 'puedo hacer transferencia?'])(
    '"%s" pasa a un asesor con motivo de pago', async (texto) => {
      const { ultima } = await conversar([texto], { historial: linkEnviado() });
      expect(ultima.accion).toBe('transferir_a_asesor');
      expect(ultima.metadata?.motivo_transferencia).toBe('pago');
    });

  it('"ya pagué" confirma sin generar otro link', async () => {
    const { ultima } = await conversar(['ya pagué'], { historial: linkEnviado() });
    expect(ultima.accion).toBeUndefined();
    expect(ultima.metadata?.awaiting).toBe('link_enviado');
  });

  it('si pregunta por el link le recuerda que ya está en el chat', async () => {
    const { ultima } = await conversar(['dónde está el link?'], { historial: linkEnviado() });
    expect(ultima.texto).toMatch(/ya fue enviado/);
  });
});

describe('Conversación libre con Sofi', () => {
  it('sin un paso pendiente responde Sofi', async () => {
    const { ultima } = await conversar(['¿qué me recomiendas para un regalo de $100.000?']);
    expect(sim.sofi).toHaveBeenCalled();
    expect(ultima.texto).toBe('Respuesta de Sofi');
  });

  it('un paso de compra abandonado hace más de 6 horas no deja al cliente atascado', async () => {
    const { ultima } = await conversar(['hola de nuevo'], {
      historial: [bot('¿Cuántas quieres?', { awaiting: 'cantidad', pending_product_id: cartaDeOro.shopify_id }, 8)],
    });
    expect(sim.sofi).toHaveBeenCalled();
    expect(ultima.metadata?.awaiting).not.toBe('cantidad');
  });

  it('respeta cuando Sofi pasa la conversación a un asesor', async () => {
    sim.sofi.mockResolvedValueOnce({ texto: 'Te paso con un asesor', accion: 'transferir_a_asesor', metadata: { awaiting: '' } });
    const { ultima } = await conversar(['necesito ayuda con algo especial']);
    expect(ultima.accion).toBe('transferir_a_asesor');
  });
});

describe('Ventas empresariales', () => {
  it('si una empresa deja su correo, registra la solicitud para el equipo', async () => {
    const { ultima } = await conversar(['mi correo es compras@empresa.com'], { etiqueta: 'empresarial' });
    expect(ultima.metadata?.lead_empresarial).toBe(true);
    expect(ultima.texto).toMatch(/compras@empresa\.com/);
    expect(sim.registro.some((r) => r.tabla === 'leads_sedes' && r.op === 'insert')).toBe(true);
  });
});
