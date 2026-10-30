// Horario de atención, encuesta de satisfacción, clientes molestos y
// recordatorios automáticos de carrito.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sim = vi.hoisted(() => ({
  registro: [] as Array<{ tabla: string; op: string; args: any[] }>,
  datos: {} as Record<string, any>,
  sofi: vi.fn(),
  plantillaCarrito: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso, productos } = await import('./apoyo/simulador');
  return {
    supabaseAdmin: crearSupabaseFalso(sim.registro, sim.datos),
    obtenerProductosCache: async () => productos,
    actualizarCliente: async () => {},
    obtenerPedidosClienteShopify: async () => [],
  };
});
vi.mock('@/lib/ai-sofi', () => ({ procesarMensajeSofi: sim.sofi }));
vi.mock('@/lib/whatsapp-templates', () => ({ enviarLeadMayorista: vi.fn(async () => true), enviarCarritoAbandonado: sim.plantillaCarrito }));

import {
  dentroDeHorario, proximaApertura, describirHorario, normalizarHorario, avisoFueraDeHorario, formatoHora,
  type HorarioAtencion,
} from '@/lib/horario';
import { parsearCalificacion } from '@/lib/encuesta';
import { esFrustracion, procesarMensajeBot } from '@/lib/bot-logic';
import { recordarCarritosAbandonados } from '@/lib/recordatorios';
import { contexto, bot, cliente } from './apoyo/simulador';

beforeEach(() => {
  sim.registro.length = 0;
  for (const k of Object.keys(sim.datos)) delete sim.datos[k];
  sim.sofi.mockReset();
  sim.sofi.mockResolvedValue({ texto: 'Respuesta de Sofi', metadata: { awaiting: '' } });
  sim.plantillaCarrito.mockClear();
});

// Hora de Colombia → instante UTC (Colombia = UTC-5 todo el año)
const enColombia = (iso: string) => new Date(new Date(`${iso}Z`).getTime() + 5 * 3_600_000);

const HORARIO: HorarioAtencion = {
  lun: { abre: '08:00', cierra: '18:00' }, mar: { abre: '08:00', cierra: '18:00' },
  mie: { abre: '08:00', cierra: '18:00' }, jue: { abre: '08:00', cierra: '18:00' },
  vie: { abre: '08:00', cierra: '18:00' }, sab: { abre: '09:00', cierra: '13:00' }, dom: null,
};

describe('Horario de atención', () => {
  it('formatea horas a la colombiana', () => {
    expect(formatoHora('08:00')).toBe('8:00 a. m.');
    expect(formatoHora('18:30')).toBe('6:30 p. m.');
    expect(formatoHora('12:00')).toBe('12:00 p. m.');
  });

  it('martes 10:00 a. m. está en horario', () => expect(dentroDeHorario(HORARIO, enColombia('2026-11-03T10:00:00'))).toBe(true));
  it('martes 7:00 p. m. está fuera de horario', () => expect(dentroDeHorario(HORARIO, enColombia('2026-11-03T19:00:00'))).toBe(false));
  it('domingo está cerrado', () => expect(dentroDeHorario(HORARIO, enColombia('2026-11-01T11:00:00'))).toBe(false));

  it('de noche abre mañana', () => expect(proximaApertura(HORARIO, enColombia('2026-11-03T21:00:00'))).toBe('mañana a las 8:00 a. m.'));
  it('de madrugada abre hoy', () => expect(proximaApertura(HORARIO, enColombia('2026-11-03T05:00:00'))).toBe('hoy a las 8:00 a. m.'));
  it('el sábado por la tarde abre el lunes', () => expect(proximaApertura(HORARIO, enColombia('2026-11-07T15:00:00'))).toBe('el lunes a las 8:00 a. m.'));

  it('describe el horario agrupando días', () => {
    expect(describirHorario(HORARIO)).toBe('lunes a viernes de 8:00 a. m. a 6:00 p. m. y sábado de 9:00 a. m. a 1:00 p. m.');
  });

  it('sin horario configurado no avisa nada', () => expect(avisoFueraDeHorario(null)).toBe(''));
  it('en horario no avisa nada', () => expect(avisoFueraDeHorario(HORARIO, enColombia('2026-11-03T10:00:00'))).toBe(''));
  it('fuera de horario le dice al cliente cuándo le escriben', () => {
    expect(avisoFueraDeHorario(HORARIO, enColombia('2026-11-03T21:00:00'))).toMatch(/fuera de horario.*Te escribimos mañana a las 8:00 a\. m\./);
  });

  it('rechaza un día que cierra antes de abrir', () => {
    expect(normalizarHorario({ ...HORARIO, lun: { abre: '18:00', cierra: '08:00' } })).toBeNull();
  });
  it('rechaza un horario sin ningún día abierto', () => {
    expect(normalizarHorario({ lun: null, mar: null, mie: null, jue: null, vie: null, sab: null, dom: null })).toBeNull();
  });
});

describe('Encuesta de satisfacción', () => {
  it.each([['😀 Excelente', 3], ['🙂 Buena', 2], ['😕 Mala', 1], ['muy buena', 3], ['regular', 1], ['bien', 2]])(
    '"%s" → %s', (t, n) => expect(parsearCalificacion(String(t))).toBe(n));
  it('un mensaje cualquiera no es una calificación', () => expect(parsearCalificacion('quiero comprar un ron')).toBeNull());

  const encuesta = () => [bot('¿Cómo calificarías la atención?', { awaiting: 'encuesta', encuesta_asesor: 'mateo@commerk.com.co', encuesta_asesor_nombre: 'Mateo' })];

  it('guarda la calificación con el asesor y agradece', async () => {
    const r = await procesarMensajeBot('😀 Excelente', contexto({ historial: encuesta() }));
    const insert = sim.registro.find((x) => x.tabla === 'encuestas' && x.op === 'insert');
    expect(insert?.args[0]).toMatchObject({ calificacion: 3, asesor: 'mateo@commerk.com.co' });
    expect(r.metadata?.awaiting).toBe('');
    expect(r.texto).toMatch(/Gracias/);
  });

  it('si es mala, pregunta qué mejorar y guarda el comentario', async () => {
    const historial: any[] = encuesta();
    const r1 = await procesarMensajeBot('😕 Mala', contexto({ historial }));
    expect(r1.metadata?.awaiting).toBe('encuesta_comentario');
    historial.push(cliente('😕 Mala'), bot(r1.texto, r1.metadata));
    const r2 = await procesarMensajeBot('Tardaron mucho en responderme', contexto({ historial }));
    expect(sim.registro.some((x) => x.tabla === 'encuestas' && x.op === 'update')).toBe(true);
    expect(r2.texto).toMatch(/Gracias por contarnos/);
  });

  it('si en vez de calificar hace otra pregunta, la atiende Sofi', async () => {
    const r = await procesarMensajeBot('¿tienen aguardiente de litro?', contexto({ historial: encuesta() }));
    expect(sim.sofi).toHaveBeenCalled();
    expect(r.texto).toBe('Respuesta de Sofi');
    expect(sim.registro.some((x) => x.tabla === 'encuestas')).toBe(false);
  });
});

describe('Cliente molesto', () => {
  it.each(['no me entiendes', 'pésimo servicio', 'llevo rato esperando', 'nadie me responde', 'esto no sirve'])(
    '"%s" se reconoce', (t) => expect(esFrustracion(t)).toBe(true));
  it.each(['llevo rato buscando un regalo', 'no me sirve ese tamaño', 'quiero hablar con un asesor', 'ya te dije que dos'])(
    '"%s" no es molestia', (t) => expect(esFrustracion(t)).toBe(false));

  it('repetir lo mismo por tercera vez cuenta como molestia', () => {
    const ctx = contexto({ historial: [cliente('el de 15 años'), bot('…'), cliente('el de 15 años'), bot('…')] });
    expect(esFrustracion('el de 15 años', ctx)).toBe(true);
  });

  it('pasa a una persona aunque esté a mitad de una compra', async () => {
    const r = await procesarMensajeBot('pésimo servicio, no me entiendes', contexto({
      historial: [bot('¿Cuántas quieres?', { awaiting: 'cantidad', pending_product_id: 'x' })],
    }));
    expect(r.accion).toBe('transferir_a_asesor');
    expect(r.metadata?.motivo_transferencia).toBe('frustracion');
  });
});

describe('Recordatorio automático de carrito', () => {
  const ayer = new Date(Date.now() - 30 * 3_600_000).toISOString();
  const linea = (producto: string, total: number, extra: Record<string, any> = {}) => ({
    id: `v-${producto}`, cliente_id: 'c1', referencia_pago: 'WA-1', producto_nombre: producto, total, created_at: ayer,
    conversacion_id: 'conv-1', clientes: { telefono: '573001234567', nombre: 'Angy Pérez' },
    conversacion: { id: 'conv-1', estado_atencion: 'bot', etiqueta: null }, ...extra,
  });
  const pedidoDeCinco = (extra: Record<string, any> = {}) =>
    ['Kit Decantador', 'Gran Reserva', 'Cóctel Maracuyá', 'Mojito', 'Cheers'].map((p, i) => linea(p, 10000 * (i + 1), extra));

  it('un pedido de 5 productos genera UN solo mensaje con el total', async () => {
    sim.datos.ventas = pedidoDeCinco();
    const r = await recordarCarritosAbandonados();
    expect(r.enviados).toBe(1);
    expect(sim.plantillaCarrito).toHaveBeenCalledTimes(1);
    expect(sim.plantillaCarrito).toHaveBeenCalledWith('573001234567', 'Angy Pérez', 'Kit Decantador y 4 productos más', expect.stringContaining('150.000'));
  });

  it('no le escribe a una clienta marcada como Empresa', async () => {
    sim.datos.ventas = pedidoDeCinco({ conversacion: { id: 'conv-1', estado_atencion: 'bot', etiqueta: 'empresarial' } });
    const r = await recordarCarritosAbandonados();
    expect(r.enviados).toBe(0);
    expect(r.resultados[0].motivo).toMatch(/empresarial/);
  });

  it('no le escribe si la atiende un asesor', async () => {
    sim.datos.ventas = pedidoDeCinco({ conversacion: { id: 'conv-1', estado_atencion: 'en_atencion', etiqueta: null } });
    const r = await recordarCarritosAbandonados();
    expect(r.enviados).toBe(0);
  });

  it('marca todas las líneas para no repetir nunca', async () => {
    sim.datos.ventas = pedidoDeCinco();
    await recordarCarritosAbandonados();
    const marcado = sim.registro.find((x) => x.tabla === 'ventas' && x.op === 'in');
    expect(marcado?.args[1]).toHaveLength(5);
  });
});

describe('Embudo empresarial', async () => {
  const { unidadesMencionadas } = await import('@/lib/oportunidades');
  it.each([['necesito 200 kits para mis empleados', 200], ['unas 50 botellas', 50], ['regalos para 35 colaboradores', 35]])(
    '"%s" → %s unidades', (t, n) => expect(unidadesMencionadas(String(t))).toBe(n));
  it('sin cantidad no inventa', () => expect(unidadesMencionadas('quiero regalos para mi empresa')).toBeNull());

  it('una empresa detectada por el bot entra al embudo con sus unidades', async () => {
    sim.sofi.mockResolvedValueOnce({ texto: 'Con gusto', accion: 'iniciar_empresarial', metadata: { awaiting: '' } });
    await procesarMensajeBot('Somos una empresa y necesitamos 200 kits para nuestros clientes', contexto());
    const insert = sim.registro.find((x) => x.tabla === 'oportunidades' && x.op === 'insert');
    expect(insert?.args[0]).toMatchObject({ conversacion_id: 'conv-1', cliente_id: 'cliente-1', unidades: 200 });
  });
});
