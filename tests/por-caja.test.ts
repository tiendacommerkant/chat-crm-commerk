// Precios por caja y al por mayor: el bot nunca multiplica el precio unitario.
// En vivo (10 nov 2026) Sofi cotizó "la caja x12 de 750" en $664.320
// (12 × $55.360) cuando la caja vale $589.099: ahora pasa al equipo sin cotizar.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esPedidoPorCaja, unidadesPedidas, UNIDADES_MAYORISTA } from '@/lib/bot/intenciones';

const sim = vi.hoisted(() => ({
  registro: [] as Array<{ tabla: string; op: string; args: any[] }>,
  sofi: vi.fn(),
}));

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso, productos } = await import('./apoyo/simulador');
  return {
    supabaseAdmin: crearSupabaseFalso(sim.registro),
    obtenerProductosCache: async () => productos,
    actualizarCliente: vi.fn(async () => {}),
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
import { contexto } from './apoyo/simulador';

beforeEach(() => {
  sim.registro.length = 0;
  sim.sofi.mockReset();
  sim.sofi.mockResolvedValue({ texto: 'Respuesta de Sofi', metadata: { awaiting: '' } });
});

describe('Detectar un pedido por caja', () => {
  it.each([
    'En cuanto sale la caja x12 unidades de 750ml',
    '¿Cuánto vale la caja de aguardiente amarillo?',
    'precio por caja del ron viejo de caldas',
    'Quiero 2 cajas de amarillo',
    'me interesa una caja de ron 8 años',
    'caja de 24 medias de aguardiente',
    'cuantas cajas me pueden vender',
    'Venden por cajas?',
  ])('"%s" es por caja', (t) => expect(esPedidoPorCaja(t)).toBe(true));

  it.each([
    '¿Tienen caja de regalo para el ron?',
    'el kit viene en caja?',
    '¿me lo pueden enviar en una caja bonita?',
    'quiero el ron con su caja de madera',
    'la cajita de regalo cuanto vale',
    'cuánto vale el aguardiente amarillo de 750',
    'quiero 3 botellas',
  ])('"%s" NO es por caja', (t) => expect(esPedidoPorCaja(t)).toBe(false));
});

describe('Unidades pedidas en el mensaje', () => {
  it.each([
    ['quiero 12 botellas de amarillo', 12],
    ['aguardiente amarillo x24', 24],
    ['necesito una docena de rones', 12],
    ['3 botellas de ron viejo 8 años de 750 ml', 3],
    ['Calle 45 # 77-68 oficina 202 unidad 12', 0],
    ['cuánto vale el ron de 12 años', 0],
    ['pedido 2692', 0],
  ])('"%s" → %i', (t, n) => expect(unidadesPedidas(t)).toBe(n));

  it('la compra por mayor arranca en 12 unidades (una caja)', () => expect(UNIDADES_MAYORISTA).toBe(12));
});

describe('En la conversación', () => {
  it.each([
    'En cuanto sale la caja x12 unidades de 750ml',
    'Quiero 12 botellas de aguardiente amarillo',
    'me interesa una caja de ron viejo de caldas',
  ])('"%s" pasa al equipo sin cotizar y sin pasar por Sofi', async (m) => {
    const r = await procesarMensajeBot(m, contexto({}));
    expect(r.accion).toBe('transferir_a_asesor');
    expect(r.metadata?.motivo_transferencia).toBe('mayorista');
    expect(r.texto).toMatch(/precios por caja y al por mayor se manejan aparte/);
    expect(r.texto).toMatch(/agente de Commerk te atenderá por este mismo chat/);
    expect(r.texto).not.toMatch(/\$\s?\d/);
    expect(sim.sofi).not.toHaveBeenCalled();
    const lead = sim.registro.find((x) => x.tabla === 'leads_sedes' && x.op === 'insert');
    expect(lead?.args[0]).toMatchObject({ sede: 'Ventas por mayor' });
  });

  it.each([
    'Somos una empresa y necesitamos 200 kits para nuestros clientes',
    'quiero 3 cajas de ron para regalar a los empleados',
  ])('"%s" es venta empresarial, no mayorista', async (m) => {
    const r = await procesarMensajeBot(m, contexto({}));
    expect(r.accion).toBe('transferir_a_asesor');
    expect(r.metadata?.motivo_transferencia).toBe('empresarial');
    expect(sim.sofi).not.toHaveBeenCalled();
  });

  it('una licorera que dice "empresa" pero revende es mayorista', async () => {
    const r = await procesarMensajeBot('Tengo una empresa licorera y quiero 5 cajas para revender', contexto({}));
    expect(r.metadata?.motivo_transferencia).toBe('mayorista');
  });

  it('en una conversación de empresa, la caja sigue como venta empresarial', async () => {
    const r = await procesarMensajeBot('necesito 3 cajas de ron para los empleados', contexto({ etiqueta: 'empresarial' }));
    expect(r.accion).toBe('transferir_a_asesor');
    expect(r.metadata?.motivo_transferencia).toBe('empresarial');
  });

  it.each([
    '¿Tienen caja de regalo para el ron?',
    'quiero 3 botellas de aguardiente amarillo',
    '¿me lo pueden enviar en una caja?',
  ])('"%s" lo sigue atendiendo Sofi', async (m) => {
    const r = await procesarMensajeBot(m, contexto({}));
    expect(r.accion).not.toBe('transferir_a_asesor');
    expect(sim.sofi).toHaveBeenCalled();
  });
});
