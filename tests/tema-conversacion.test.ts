// Tema automático de la plantilla "Retomar conversación" ({{2}})
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearSupabaseFalso } from './apoyo/simulador';

const simulado = vi.hoisted(() => ({
  crear: vi.fn(),
  datos: {} as Record<string, any>,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create: simulado.crear } };
  },
}));
vi.mock('@/lib/supabase', () => ({
  get supabaseAdmin() {
    return crearSupabaseFalso([], simulado.datos);
  },
}));

import { limpiarTema, temaDeRespaldo, transcripcion, sugerirTemaConversacion, TEMA_GENERAL } from '@/lib/tema-conversacion';

// Caso real del 10 nov: Juli Toro (Ingeomega SAS) pasó a ventas empresariales
// y nadie le contestó en 24 h. Los mensajes vienen del más nuevo al más viejo.
const chatJuli = [
  { tipo: 'user', contenido: 'Podrías mostrarme opciones' },
  { tipo: 'user', contenido: 'Buen día soy juliana toro de ingeomega SAS estoy buscando opciones para 100 anchetas con ron de un presupuesto hasta 120 mil' },
  { tipo: 'bot', contenido: 'Hola buenas tardes es un gusto atenderte, como te podemos ayudar?' },
  { tipo: 'user', contenido: 'Sigo atenta 👀' },
  { tipo: 'bot', contenido: '¡Claro que sí, Juli! 🤝 Manejamos *convenio empresarial* para los regalos de tus colaboradores y clientes.' },
];

const respuestaIA = (texto: string, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: texto }],
});

describe('Limpiar el tema que devuelve la IA', () => {
  it('quita comillas, punto final y la mayúscula del artículo', () => {
    expect(limpiarTema('"Las 100 anchetas con ron para tu empresa."')).toBe('las 100 anchetas con ron para tu empresa');
    expect(limpiarTema('Tema: tu pedido del Ron Viejo de Caldas')).toBe('tu pedido del Ron Viejo de Caldas');
  });

  it('deja una sola línea (WhatsApp rechaza parámetros con saltos de línea)', () => {
    expect(limpiarTema('el Kit Ejecutivo\n\nque te interesó')).toBe('el Kit Ejecutivo que te interesó');
  });

  it('respeta nombres propios al inicio', () => {
    expect(limpiarTema('Ron Viejo de Caldas 750 ml')).toBe('Ron Viejo de Caldas 750 ml');
  });

  it('descarta lo vacío, lo muy largo, enlaces o variables', () => {
    expect(limpiarTema('')).toBeNull();
    expect(limpiarTema('a'.repeat(90))).toBeNull();
    expect(limpiarTema('tu pago en https://checkout.wompi.co/l/abc')).toBeNull();
    expect(limpiarTema('tu pedido {{1}}')).toBeNull();
  });
});

describe('Tema de respaldo sin IA', () => {
  it('según el tipo de conversación', () => {
    expect(temaDeRespaldo({ etiqueta: 'empresarial' })).toBe('los regalos para tu empresa');
    expect(temaDeRespaldo({ motivo_transferencia: 'mayorista' })).toBe('tu compra al por mayor');
    expect(temaDeRespaldo(null)).toBe(TEMA_GENERAL);
  });
});

describe('Transcripción para la IA', () => {
  it('marca quién habla, recorta y salta mensajes vacíos', () => {
    const t = transcripcion([
      { tipo: 'user', contenido: 'Hola' },
      { tipo: 'bot', contenido: '' },
      { tipo: 'bot', contenido: 'Hola,\n¿en qué te ayudo?' },
    ]);
    expect(t).toBe('Cliente: Hola\nTienda: Hola, ¿en qué te ayudo?');
  });
});

describe('Tema sugerido de una conversación', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'llave-de-prueba';
    simulado.crear.mockReset();
    simulado.datos = { conversaciones: { etiqueta: 'empresarial', motivo_transferencia: null }, mensajes: chatJuli };
  });

  it('Juli Toro: el tema sale de la conversación, en orden cronológico', async () => {
    simulado.crear.mockResolvedValue(respuestaIA('Las 100 anchetas con ron para tu empresa'));
    const r = await sugerirTemaConversacion('conv-juli');
    expect(r).toEqual({ tema: 'las 100 anchetas con ron para tu empresa', origen: 'ia' });

    const [pedido, opciones] = simulado.crear.mock.calls[0];
    expect(pedido.model).toBe('claude-opus-5-5');
    expect(pedido.fallbacks).toBe('default');
    expect(opciones.timeout).toBeLessThanOrEqual(15_000);
    const chat: string = pedido.messages[0].content;
    expect(chat.indexOf('Claro que sí, Juli')).toBeLessThan(chat.indexOf('Podrías mostrarme opciones'));
  });

  it('si la IA no responde, usa el tema según el tipo de chat', async () => {
    simulado.crear.mockRejectedValue(new Error('Request timed out.'));
    expect(await sugerirTemaConversacion('conv-juli')).toEqual({ tema: 'los regalos para tu empresa', origen: 'respaldo' });
  });

  it('si el modelo declina o responde algo inservible, también', async () => {
    simulado.crear.mockResolvedValue(respuestaIA('', 'refusal'));
    expect((await sugerirTemaConversacion('conv-juli')).origen).toBe('respaldo');
    simulado.crear.mockResolvedValue(respuestaIA('x'.repeat(200)));
    expect((await sugerirTemaConversacion('conv-juli')).origen).toBe('respaldo');
  });

  it('sin mensajes no llama a la IA', async () => {
    simulado.datos = { conversaciones: null, mensajes: [] };
    expect(await sugerirTemaConversacion('conv-vacia')).toEqual({ tema: TEMA_GENERAL, origen: 'respaldo' });
    expect(simulado.crear).not.toHaveBeenCalled();
  });
});
