// Sofi ve las fotos que manda el cliente. Caso Nora (16 nov): mandó el
// pantallazo de la publicación que Sofi misma le pidió y recibió un mensaje
// fijo; Sofi nunca la vio y terminó diciendo "no logro ver bien la foto".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sim = vi.hoisted(() => ({ crear: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: sim.crear };
  },
}));
vi.mock('@/lib/supabase', async () => {
  const { productos } = await import('./apoyo/simulador');
  return { obtenerProductosCache: async () => productos, obtenerPedidosClienteShopify: async () => [] };
});
vi.mock('@/lib/costos', () => ({ registrarUsoClaude: vi.fn(async () => {}) }));
vi.mock('@/lib/eventos', () => ({ registrarEvento: vi.fn(async () => {}) }));

import { descargarImagenWhatsApp, fotoAnteriorDelCliente } from '@/lib/imagenes-whatsapp';
import { procesarMensajeSofi } from '@/lib/ai-sofi';
import { contexto, bot } from './apoyo/simulador';

const FOTO = { media_type: 'image/jpeg' as const, data: Buffer.from('foto-de-prueba').toString('base64') };
const haceMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const mensajeCliente = (contenido: string, minutos: number, metadata: Record<string, any> = {}) =>
  ({ id: `m-${contenido}-${minutos}`, conversacion_id: 'conv-1', tipo: 'user', contenido, metadata, created_at: haceMin(minutos) }) as any;

describe('Descargar la foto de WhatsApp', () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => { process.env.WHATSAPP_ACCESS_TOKEN = 'token-prueba'; });
  afterEach(() => { globalThis.fetch = fetchOriginal; });

  const responder = (info: Record<string, any>, archivo: Buffer | null = Buffer.from('jpeg')) => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('graph.facebook.com')) return new Response(JSON.stringify(info), { status: 200 });
      return archivo ? new Response(new Uint8Array(archivo), { status: 200 }) : new Response('', { status: 404 });
    }) as any;
  };

  it('devuelve la imagen en base64 con su tipo', async () => {
    responder({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', file_size: 4 });
    expect(await descargarImagenWhatsApp('1036481479463270')).toEqual({ media_type: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') });
  });

  it('no sirve si no es una imagen que la IA lea o es muy pesada', async () => {
    responder({ url: 'https://x', mime_type: 'video/mp4', file_size: 10 });
    expect(await descargarImagenWhatsApp('1')).toBeNull();
    responder({ url: 'https://x', mime_type: 'image/jpeg', file_size: 9_000_000 });
    expect(await descargarImagenWhatsApp('1')).toBeNull();
  });

  it('si WhatsApp no la entrega, null (el bot responde como antes)', async () => {
    responder({ url: 'https://x', mime_type: 'image/png', file_size: 10 }, null);
    expect(await descargarImagenWhatsApp('1')).toBeNull();
  });
});

describe('Foto + pregunta en dos mensajes', () => {
  it('"¿cuánto vale?" justo después de la foto la usa', () => {
    const historial = [mensajeCliente('📷 Imagen', 2, { media_id: 'foto-1', media_mime_type: 'image/jpeg' }), mensajeCliente('Ese mismo', 0)];
    expect(fotoAnteriorDelCliente(historial)).toBe('foto-1');
  });

  it('no si la foto es vieja, si no es foto o si en medio hubo otro mensaje del cliente', () => {
    expect(fotoAnteriorDelCliente([mensajeCliente('📷 Imagen', 30, { media_id: 'f', media_mime_type: 'image/jpeg' }), mensajeCliente('hola', 0)])).toBeNull();
    expect(fotoAnteriorDelCliente([mensajeCliente('🎤 Nota de voz', 1, { media_id: 'a', media_mime_type: 'audio/ogg' }), mensajeCliente('hola', 0)])).toBeNull();
    expect(fotoAnteriorDelCliente([
      mensajeCliente('📷 Imagen', 3, { media_id: 'f', media_mime_type: 'image/jpeg' }), mensajeCliente('hola', 2), mensajeCliente('?', 0),
    ])).toBeNull();
  });
});

describe('Sofi recibe la foto en el mensaje del cliente', () => {
  beforeEach(() => {
    sim.crear.mockReset();
    sim.crear.mockResolvedValue({
      content: [{ type: 'text', text: '{"texto":"¡Es una ancheta! La armas a tu gusto en https://tiendacommerkant.com.co/pages/arma-tu-ancheta","accion":"continuar"}' }],
      usage: {},
    });
  });

  it('foto sin texto: va como imagen + "Te envío esta imagen."', async () => {
    const historial = [bot('Mándame la foto de la publicación y te digo el precio exacto.'), mensajeCliente('📷 Imagen', 0, { media_id: 'f' })];
    const r = await procesarMensajeSofi('📷 Imagen', { ...contexto({ historial }), imagenes: [FOTO] });
    const pedido = sim.crear.mock.calls[0][0];
    const ultimo = pedido.messages[pedido.messages.length - 1];
    expect(ultimo.role).toBe('user');
    expect(ultimo.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: FOTO.data } });
    expect(ultimo.content[1]).toEqual({ type: 'text', text: 'Te envío esta imagen.' });
    // El "📷 Imagen" del historial no se repite justo antes
    expect(pedido.messages[pedido.messages.length - 2].role).toBe('assistant');
    // Con foto tiene más tiempo para responder
    expect(sim.crear.mock.calls[0][1]).toEqual({ timeout: 25_000 });
    expect(pedido.system[0].text).toMatch(/IMÁGENES QUE MANDA EL CLIENTE/);
    expect(r.texto).toMatch(/arma-tu-ancheta/);
  });

  it('foto con texto: la pregunta del cliente va junto a la foto', async () => {
    await procesarMensajeSofi('¿cuánto vale este kit?', { ...contexto(), imagenes: [FOTO] });
    const ultimo = sim.crear.mock.calls[0][0].messages.at(-1);
    expect(ultimo.content[1]).toEqual({ type: 'text', text: '¿cuánto vale este kit?' });
  });

  it('sin foto, todo sigue igual: texto simple', async () => {
    await procesarMensajeSofi('hola', contexto());
    const ultimo = sim.crear.mock.calls[0][0].messages.at(-1);
    expect(ultimo).toEqual({ role: 'user', content: 'hola' });
    expect(sim.crear.mock.calls[0][1]).toBeUndefined();
  });
});
