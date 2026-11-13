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
  it('responde desde el primer mensaje y avisa que seguir el chat acepta las políticas', async () => {
    const { ultima } = await conversar(['hola'], { politicas: false, sede: null });
    expect(ultima.metadata?.aviso_politicas).toBe(true);
    expect(ultima.texto).toMatch(/Al continuar esta conversación aceptas/);
    expect(ultima.texto).not.toMatch(/Responde \*ACEPTO\*/);
  });

  it('si sigue escribiendo, queda aceptada y no se repite el aviso', async () => {
    const { ultima } = await conversar(['¿tienen ron?'], { politicas: false, sede: null, historial: [cliente('hola'), bot('¡Hola! Soy Sofi', { aviso_politicas: true })] });
    expect(sim.actualizarCliente).toHaveBeenCalledWith('cliente-1', { politicas_aceptadas: true });
    expect(ultima.texto).not.toMatch(/Al continuar esta conversación/);
  });

  it('"acepto" a secas guarda la aceptación y saluda sin preguntar la sede', async () => {
    const { ultima } = await conversar(['acepto'], { politicas: false, sede: null });
    expect(sim.actualizarCliente).toHaveBeenCalledWith('cliente-1', { politicas_aceptadas: true });
    expect(ultima.metadata?.awaiting).toBe('');
    expect(ultima.texto).not.toMatch(/sede más cercana/);
  });

  it.each(['Asepto', 'Obvio que acepto', 'ok acepto'])('"%s" también cuenta como aceptación', async (t) => {
    await conversar([t], { politicas: false, sede: null });
    expect(sim.actualizarCliente).toHaveBeenCalledWith('cliente-1', { politicas_aceptadas: true });
  });

  it('"no acepto" no insiste con el muro: explica y deja la puerta abierta', async () => {
    const { ultima } = await conversar(['no acepto'], { politicas: false, sede: null });
    expect(sim.actualizarCliente).not.toHaveBeenCalled();
    expect(ultima.texto).toMatch(/Si cambias de opinión/);
  });

  it('en el menú de sedes, una respuesta que no es una sede ya no bloquea', async () => {
    const { ultima } = await conversar(['estoy en Bogotá, ¿hacen envíos?'], { sede: null, historial: [bot('¿Cuál es tu sede?', { awaiting: 'sede' })] });
    expect(ultima.texto).not.toMatch(/No logré identificar la sede/);
    expect(ultima.metadata?.awaiting).not.toBe('sede');
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

// La plantilla de domicilio del equipo, llenada por el cliente
const DATOS_JULI = 'Nombre: Juliana Toro\nCédula: 1036654321\nCorreo: juli.toro@gmail.com\nTeléfono: 3116350500\nDirección: Calle 10 # 40-20\nBarrio: El Poblado\n¿Factura electrónica? SI/NO: si';
const carritoCarta = () => [{ shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad: 1 }];
const esperandoDatos = (datos: Record<string, any> = { telefono: '3001234567' }) =>
  [bot('Para enviarte el pedido, indícame estos datos', { awaiting: 'datos_envio', pending_cart: carritoCarta(), pending_datos_envio: datos })];

describe('Compra completa a domicilio', () => {
  it('de "quiero comprar carta de oro 750" hasta el link de pago, con los datos de envío', async () => {
    const { respuestas, ultima } = await conversar([
      'quiero comprar carta de oro 750',
      '2',
      'no, eso es todo',
      'a domicilio',
      DATOS_JULI,
      'si',
    ]);
    expect(respuestas[0].metadata?.awaiting).toBe('cantidad');
    expect(respuestas[1].metadata?.pending_cart?.[0]?.cantidad).toBe(2);
    // Pide la plantilla del equipo con el tiempo de entrega real
    expect(respuestas[3].metadata?.awaiting).toBe('datos_envio');
    expect(respuestas[3].texto).toMatch(/Cédula/);
    expect(respuestas[3].texto).toMatch(/Factura electrónica/);
    expect(respuestas[3].texto).toMatch(/3 a 5 días hábiles/);
    // Resumen con los datos para confirmar
    expect(respuestas[4].metadata?.awaiting).toBe('confirmacion');
    expect(respuestas[4].texto).toMatch(/Juliana Toro · 🪪 1036654321/);
    expect(respuestas[4].texto).toMatch(/Calle 10 # 40-20, barrio El Poblado, Medellín/);
    expect(respuestas[4].texto).toMatch(/Factura electrónica: \*SÍ\*/);
    expect(ultima.accion).toBe('generar_link_pago');
    const item = ultima.metadata?.pending_cart?.[0];
    expect(item.titulo).toMatch(/carta de oro/i);
    expect(ultima.metadata?.pending_total).toBe(ultima.metadata!.pending_subtotal + ultima.metadata!.pending_costo_envio);
    // Los datos viajan hasta el link de pago (de ahí al pedido de Shopify)
    expect(ultima.metadata?.pending_datos_envio).toMatchObject({ nombre: 'Juliana Toro', cedula: '1036654321', correo: 'juli.toro@gmail.com', factura: 'SI', municipio: 'Medellín' });
    expect(ultima.metadata?.pending_direccion).toBe('Calle 10 # 40-20, barrio El Poblado, Medellín');
  });

  it('si faltan datos, pide solo esos; el teléfono es el del WhatsApp si no da otro', async () => {
    const { respuestas } = await conversar(['Juan Pérez\nCarrera 43A # 1-50\nZúñiga, Envigado', '43567890\njuanp@gmail.com\nno'], { historial: esperandoDatos({ telefono: '3001234567' }) });
    expect(respuestas[0].metadata?.awaiting).toBe('datos_envio');
    expect(respuestas[0].texto).toMatch(/Gracias, Juan/);
    expect(respuestas[0].texto).toMatch(/Cédula/);
    expect(respuestas[0].texto).not.toMatch(/Barrio|Dirección|Teléfono/);
    expect(respuestas[1].metadata?.awaiting).toBe('confirmacion');
    expect(respuestas[1].metadata?.pending_datos_envio).toMatchObject({ cedula: '43567890', telefono: '3001234567', barrio: 'Zúñiga', municipio: 'Envigado', factura: 'NO' });
  });

  it('desde el resumen corrige un dato sin cancelar ("no, mi cédula es…")', async () => {
    const { respuestas, ultima } = await conversar([DATOS_JULI, 'no, mi cédula es 43.567.890', 'si'], { historial: esperandoDatos() });
    expect(respuestas[1].metadata?.awaiting).toBe('confirmacion');
    expect(respuestas[1].texto).toMatch(/🪪 43567890/);
    expect(ultima.accion).toBe('generar_link_pago');
    expect(ultima.metadata?.pending_datos_envio?.cedula).toBe('43567890');
  });

  it('una pregunta en medio: Sofi responde y se le recuerda lo que falta', async () => {
    const { ultima } = await conversar(['¿cuánto se demora en llegar?'], { historial: esperandoDatos() });
    expect(sim.sofi).toHaveBeenCalled();
    expect(ultima.metadata?.awaiting).toBe('datos_envio');
    expect(ultima.texto).toMatch(/me faltan estos datos/);
  });

  it('barrio sin municipio conocido: pregunta el municipio antes del resumen', async () => {
    const datos = 'Nombre: Ana Gil\nCédula: 43567890\nCorreo: ana@gmail.com\nDirección: Calle 5 # 10-20\nBarrio: San José\nFactura: no';
    const { respuestas } = await conversar([datos, 'Bello'], { historial: esperandoDatos() });
    expect(respuestas[0].texto).toMatch(/En qué municipio/);
    expect(respuestas[1].metadata?.awaiting).toBe('confirmacion');
    expect(respuestas[1].metadata?.pending_direccion).toBe('Calle 5 # 10-20, barrio San José, Bello');
  });

  it('sin el tamaño no adivina: Sofi pregunta cuál (hay 375 y 750 ml)', async () => {
    const { ultima } = await conversar(['quiero comprar carta de oro']);
    expect(sim.sofi).toHaveBeenCalled();
    expect(ultima.metadata?.awaiting).not.toBe('cantidad');
  });

  it('el envío es gratis desde $149.000', async () => {
    const { respuestas } = await conversar(['quiero comprar carta de oro 750', '4', 'listo', 'domicilio', DATOS_JULI]);
    const resumen = respuestas[4];
    expect(resumen.metadata?.pending_subtotal).toBeGreaterThanOrEqual(149000);
    expect(resumen.metadata?.pending_costo_envio).toBe(0);
  });

  it('no toma "no sé todavía" como datos (ni como "no" a la factura)', async () => {
    const { ultima } = await conversar(['no sé todavía'], { historial: esperandoDatos() });
    expect(ultima.metadata?.awaiting).toBe('datos_envio');
    expect(ultima.metadata?.pending_datos_envio?.factura).toBeUndefined();
    expect(ultima.texto).toMatch(/Dirección/);
  });

  it('no envía a municipios fuera de cobertura: lo dice apenas da la dirección', async () => {
    const { ultima } = await conversar(['Calle 50 # 45-10, Rionegro'], { historial: esperandoDatos() });
    expect(ultima.metadata?.awaiting).toBe('datos_envio');
    expect(ultima.texto).toMatch(/no hacemos domicilio a \*Rionegro\*/);
    expect(ultima.metadata?.pending_datos_envio?.direccion).toBeUndefined();
  });

  it('un chat que quedó esperando solo la dirección (antes del cambio) sigue con los datos', async () => {
    const { ultima } = await conversar(['Calle 10 # 40-20, El Poblado, Medellín'], {
      historial: [bot('¿A qué dirección?', { awaiting: 'direccion', pending_cart: carritoCarta() })],
    });
    expect(ultima.metadata?.awaiting).toBe('datos_envio');
    expect(ultima.metadata?.pending_datos_envio).toMatchObject({ direccion: 'Calle 10 # 40-20', barrio: 'El Poblado' });
    expect(ultima.texto).toMatch(/Cédula/);
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

  it.each(['20', '12', 'una caja', '2 cajas'])('"%s" en el paso de cantidad pasa a compra al por mayor sin tocar el carrito', async (m) => {
    const { ultima } = await conversar([m], { historial: esperandoCantidad() });
    expect(ultima.accion).toBe('transferir_a_asesor');
    expect(ultima.metadata?.motivo_transferencia).toBe('mayorista');
    expect(ultima.metadata?.pending_cart ?? []).toHaveLength(0);
  });

  it('11 unidades siguen siendo una compra normal', async () => {
    const { ultima } = await conversar(['11'], { historial: esperandoCantidad() });
    expect(ultima.accion).not.toBe('transferir_a_asesor');
    expect(ultima.metadata?.pending_cart?.[0]?.cantidad).toBe(11);
  });

  it('un mayorista se atiende por esta misma línea: no se le pide sede ni se le manda a otra tienda', async () => {
    sim.sofi.mockResolvedValueOnce({ texto: 'Con gusto', accion: 'iniciar_mayorista', metadata: { awaiting: '' } });
    const { ultima } = await conversar(['Tengo una licorera y quiero comprar al por mayor para revender']);
    expect(ultima.accion).toBe('transferir_a_asesor');
    expect(ultima.metadata?.derivacion).toBe('mayorista');
    expect(ultima.texto).toMatch(/en un momento un agente de Commerk te atenderá por este mismo chat/);
    expect(ultima.texto).not.toMatch(/wa\.me|sede/i);
    const lead = sim.registro.find((r) => r.tabla === 'leads_sedes' && r.op === 'insert');
    expect(lead?.args[0]).toMatchObject({ sede: 'Ventas por mayor', telefono_sede: '' });
  });

  it('una conversación que había quedado esperando la sede mayorista pasa a una persona', async () => {
    const { ultima } = await conversar(['3'], { historial: [bot('¿Cuál sede te queda más cerca?', { awaiting: 'mayorista_sede', pending_mayorista_mensaje: 'Quiero 50 cajas' })] });
    expect(ultima.accion).toBe('transferir_a_asesor');
    expect(ultima.metadata?.motivo_transferencia).toBe('mayorista');
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
  it('una empresa pasa a una persona del equipo y se le avisa que un agente la atiende', async () => {
    sim.sofi.mockResolvedValueOnce({ texto: 'Con gusto', accion: 'iniciar_empresarial', metadata: { awaiting: '' } });
    const { ultima } = await conversar(['Hola, somos una empresa y queremos anchetas para 80 colaboradores']);
    expect(ultima.accion).toBe('transferir_a_asesor');
    expect(ultima.metadata?.motivo_transferencia).toBe('empresarial');
    expect(ultima.texto).toMatch(/en un momento un agente de Commerk te atenderá/);
    expect(ultima.texto).not.toMatch(/correo/i);
    // Queda etiquetada como empresa y el lead en el panel
    expect(sim.registro.some((r) => r.tabla === 'conversaciones' && r.op === 'update' && r.args[0]?.etiqueta === 'empresarial')).toBe(true);
    expect(sim.registro.some((r) => r.tabla === 'leads_sedes' && r.op === 'insert')).toBe(true);
  });

  it('una conversación que había quedado esperando el correo también pasa a una persona', async () => {
    const { ultima } = await conversar(['¿qué requisitos piden?'], {
      etiqueta: 'empresarial', historial: [bot('¿Me compartes tu correo?', { awaiting: 'empresa_correo', empresarial: true })],
    });
    expect(ultima.accion).toBe('transferir_a_asesor');
    expect(ultima.metadata?.motivo_transferencia).toBe('empresarial');
  });
});

describe('Estado guardado de la conversación', () => {
  const carrito = [{ shopify_id: cartaDeOro.shopify_id, titulo: cartaDeOro.titulo, precio: cartaDeOro.precio, cantidad: 1 }];
  const estadoLink = { datos: { awaiting: 'link_enviado', pending_cart: carrito }, updated_at: new Date(Date.now() - 60_000).toISOString() };

  it('un recordatorio automático después del link ya no borra el paso ni el carrito', async () => {
    const historial = [
      bot('Aquí está tu link', { awaiting: 'link_enviado', pending_cart: carrito }),
      bot('⏰ Recordatorio de pago enviado automáticamente', { tipo_wa: 'template', awaiting: '' }),
    ];
    const r = await procesarMensajeBot('ya pagué', { ...contexto({ historial }), estado: estadoLink });
    expect(r.metadata?.awaiting).toBe('link_enviado');
    expect(r.metadata?.pending_cart).toHaveLength(1);
  });

  it('el mensaje de un asesor no hace que el bot olvide el carrito', async () => {
    const historial = [
      bot('¿Algo más?', { awaiting: 'carrito', pending_cart: carrito }),
      bot('Hola, soy Mateo del equipo', { enviado_por: 'agente' }),
    ];
    const estado = { datos: { awaiting: 'carrito', pending_cart: carrito }, updated_at: new Date(Date.now() - 60_000).toISOString() };
    const r = await procesarMensajeBot('no, eso es todo', { ...contexto({ historial }), estado });
    expect(r.metadata?.awaiting).toBe('tipo_entrega');
    expect(r.metadata?.pending_cart).toHaveLength(1);
  });

  it('sin estado guardado sigue leyendo el último mensaje del bot (como antes)', async () => {
    const r = await procesarMensajeBot('ya pagué', contexto({ historial: [bot('Link', { awaiting: 'link_enviado', pending_cart: carrito })] }));
    expect(r.metadata?.awaiting).toBe('link_enviado');
  });

  it('un paso de compra guardado hace más de 6 horas ya no atrapa al cliente', async () => {
    const viejo = { datos: { awaiting: 'cantidad', pending_product_id: cartaDeOro.shopify_id }, updated_at: new Date(Date.now() - 8 * 3_600_000).toISOString() };
    await procesarMensajeBot('hola', { ...contexto(), estado: viejo });
    expect(sim.sofi).toHaveBeenCalled();
  });
});
