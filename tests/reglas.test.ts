// Reglas puntuales del bot y del CRM: cada caso viene de un error real o de
// un informe de pruebas de Commerk.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', async () => {
  const { crearSupabaseFalso, productos } = await import('./apoyo/simulador');
  return {
    supabaseAdmin: crearSupabaseFalso([]),
    obtenerProductosCache: async () => productos,
    actualizarCliente: async () => {},
    obtenerPedidosClienteShopify: async () => [],
  };
});
vi.mock('@/lib/ai-sofi', () => ({ procesarMensajeSofi: vi.fn() }));

import { esProblemaDePago } from '@/lib/bot-logic';
import { celularColombiano } from '@/lib/carritos';
import { resolverVariante, variantesDe } from '@/lib/variantes';
import { extraerNumeroOpcion, encontrarSede, sedeDeRegistroPorNumero } from '@/lib/sedes';
import { evaluarCobertura } from '@/lib/cobertura';
import { crearSesion, leerSesion, mismoSecreto, nombreDesdeEmail, rolDeUsuario, rutaPermitidaParaSede } from '@/lib/sesion';
import { esIdUsuarioWhatsApp } from '@/lib/whatsapp-id';
import { producto } from './apoyo/simulador';

describe('Problemas de pago (pasan a un asesor en vez de repetir el link)', () => {
  it.each([
    'No me da el pago', 'Puedo pagar contra entrega?', 'Puedo pagar al recibir?', 'me sale error',
    'puedo hacer transferencia a bancolombia', 'no pude pagar', 'se puede en efectivo?', 'el pago fue rechazado',
  ])('"%s" es un problema de pago', (t) => expect(esProblemaDePago(t.toLowerCase())).toBe(true));

  it.each(['ya pagué', 'dónde está el link de pago', 'cómo pago', 'gracias', 'cuánto vale el envío'])(
    '"%s" no lo es', (t) => expect(esProblemaDePago(t.toLowerCase())).toBe(false));
});

describe('Celulares para recuperar carritos', () => {
  it.each([
    ['573042461234', '573042461234'],
    ['3142111234', '573142111234'],
    ['+57 314 211 1234', '573142111234'],
    ['13142111234', '573142111234'], // celular con prefijo de EE. UU. por error en Shopify
  ])('%s → %s', (entrada, esperado) => expect(celularColombiano(entrada)).toBe(esperado));

  it.each(['0622021234', '5730', '573142111234567', ''])('"%s" se descarta', (t) => expect(celularColombiano(t)).toBeNull());
  it('sin teléfono', () => expect(celularColombiano(null)).toBeNull());
});

describe('Kits con botella a elegir', () => {
  const decantador = producto('Kit Decantador');

  it('el catálogo de prueba trae las botellas del kit', () => {
    expect(variantesDe(decantador).length).toBeGreaterThan(2);
  });
  it('"8 años" es Carta de Oro', () => {
    expect(resolverVariante(decantador, '8 años')?.titulo).toMatch(/carta de oro/i);
  });
  it('"15 años" es Gran Reserva', () => {
    expect(resolverVariante(decantador, 'el de 15 años')?.titulo).toMatch(/gran reserva/i);
  });
  it('el número de la lista elige la botella', () => {
    const primera = variantesDe(decantador)[0];
    expect(resolverVariante(decantador, '1', { permitirNumero: true })?.id).toBe(primera.id);
  });
  it('Carta de Oro cuesta distinto que Gran Reserva', () => {
    const carta = resolverVariante(decantador, 'carta de oro')!;
    const gran = resolverVariante(decantador, 'gran reserva')!;
    expect(carta.precio).toBeLessThan(gran.precio);
  });
});

describe('Sedes', () => {
  it.each(['3', '3.', '3)', '(3)', 'la 3', 'opción 3', 'la opcion 3', '#3', 'número 3'])(
    '"%s" se lee como la opción 3', (t) => expect(extraerNumeroOpcion(t)).toBe('3'));
  it.each(['3001234567', 'quiero 3 botellas', 'la 3 y la 4'])(
    '"%s" no es una opción de la lista', (t) => expect(extraerNumeroOpcion(t)).toBeNull());
  it('el número 1 del registro es Virtual', () => expect(sedeDeRegistroPorNumero('1')).toBe('Virtual'));
  it('reconoce la sede por nombre', () => expect(encontrarSede('la del tesoro')?.nombre).toMatch(/tesoro/i));
});

describe('Cobertura de envíos', () => {
  const cobertura = (process.env.SHIPPING_COVERAGE || '').split(',');
  it('Envigado está dentro', () => expect(evaluarCobertura('Calle 40 sur # 30-20, Envigado', cobertura).estado).toBe('dentro'));
  it('Rionegro está fuera', () => expect(evaluarCobertura('Cra 50 # 45-10, Rionegro', cobertura).estado).toBe('fuera'));
});

describe('Sesión del CRM', () => {
  it('una sesión firmada se lee con su nombre y rol', async () => {
    const valor = await crearSesion({ id: 'u1', email: 'laura.gomez@commerk.com.co', rol: 'asesor' });
    const s = await leerSesion(valor);
    expect(s?.email).toBe('laura.gomez@commerk.com.co');
    expect(s?.nombre).toBe('Laura Gomez');
    expect(s?.rol).toBe('asesor');
  });
  it('una cookie alterada no sirve', async () => {
    const valor = await crearSesion({ id: 'u1', email: 'a@b.co' });
    const [carga, firma] = valor.split('.');
    const falsa = Buffer.from(JSON.stringify({ sub: 'x', email: 'intruso', exp: 9_999_999_999 })).toString('base64url');
    expect(await leerSesion(`${falsa}.${firma}`)).toBeNull();
    expect(await leerSesion(`${carga}.${firma.slice(0, -2)}AA`)).toBeNull();
    expect(await leerSesion('commerk_auth=1')).toBeNull();
  });
  it('compara secretos sin aceptar vacíos', () => {
    expect(mismoSecreto('Bearer x', 'Bearer x')).toBe(true);
    expect(mismoSecreto('Bearer x', 'Bearer y')).toBe(false);
    expect(mismoSecreto('', '')).toBe(false);
  });
  it('las cuentas sin rol guardado son administradoras', () => {
    expect(rolDeUsuario({ crm_acceso: true })).toBe('admin');
    expect(rolDeUsuario({ crm_acceso: true, rol: 'asesor' })).toBe('asesor');
  });
  it('nombre legible desde el correo', () => expect(nombreDesdeEmail('mateo.arbelaez@commerk.com.co')).toBe('Mateo Arbelaez'));
});

describe('Cuentas de sede (solo sus leads mayoristas)', () => {
  it('el rol sede se reconoce', () => expect(rolDeUsuario({ crm_acceso: true, rol: 'sede', sede: 'CC Tesoro' })).toBe('sede'));
  it('la sesión lleva su sede firmada', async () => {
    const s = await leerSesion(await crearSesion({ id: 'u2', email: 'tesoro@commerk.com.co', rol: 'sede', sede: 'CC Tesoro' }));
    expect(s?.rol).toBe('sede');
    expect(s?.sede).toBe('CC Tesoro');
  });
  it('un asesor no lleva sede en la sesión', async () => {
    const s = await leerSesion(await crearSesion({ id: 'u3', email: 'a@b.co', rol: 'asesor', sede: 'CC Tesoro' }));
    expect(s?.sede).toBeUndefined();
  });
  it.each(['/dashboard/mayoristas', '/api/mayoristas', '/api/auth/sesion'])('puede abrir %s', (r) => expect(rutaPermitidaParaSede(r)).toBe(true));
  it.each([
    '/dashboard', '/dashboard/conversaciones', '/dashboard/clientes', '/dashboard/equipo',
    '/api/conversaciones', '/api/clientes', '/api/equipo', '/api/usuarios', '/api/mayoristas-otra', '/dashboard/mayoristasx',
  ])('no puede abrir %s', (r) => expect(rutaPermitidaParaSede(r)).toBe(false));
});

describe('Clientes con nombre de usuario de WhatsApp', () => {
  it('reconoce el ID de usuario', () => expect(esIdUsuarioWhatsApp('CO.13491208655302741918')).toBe(true));
  it('un número no es ID de usuario', () => expect(esIdUsuarioWhatsApp('573001234567')).toBe(false));
});

describe('Iniciales de los clientes en el chat', async () => {
  const { iniciales } = await import('@/components/chat/base');
  it.each([['Laura Gómez', 'LG'], ['Angy Michelle✨', 'AM'], ['  𝓓𝓪𝓷𝓲𝓮𝓵𝓪 𝓔𝓼𝓽𝓻𝓪𝓭𝓪', '𝓓𝓔'], ['🥰', '🥰'], ['', '?'], ['TIENDA COMMERK TESORO', 'TC']])(
    '"%s" → %s', (n, esperado) => expect(iniciales(n)).toBe(esperado));
  it('nunca parte un emoji por la mitad', () => expect(iniciales('🥰 Laura')).toBe('L'));
});
