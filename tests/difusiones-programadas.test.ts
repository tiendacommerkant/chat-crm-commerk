// Difusión programada (Black Week: 23 nov, 8:00 a. m.): sale sola a su hora,
// una sola vez, y nadie recibe el mensaje dos veces.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Base de datos en memoria con lo que usa lib/difusiones.ts
const db = vi.hoisted(() => {
  const tablas: Record<string, any[]> = {};
  const consulta = (tabla: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let valores: any = null;
    let unico = false;
    let conteo = false;
    const filtros: Array<(f: any) => boolean> = [];
    const q: any = {
      select: (_c?: string, o?: any) => { if (o?.head) conteo = true; return q; },
      insert: (v: any) => { op = 'insert'; valores = v; return q; },
      update: (v: any) => { op = 'update'; valores = v; return q; },
      eq: (k: string, v: any) => { filtros.push((f) => (k.includes('->>') ? true : f[k] === v)); return q; },
      neq: (k: string, v: any) => { filtros.push((f) => f[k] !== v); return q; },
      in: (k: string, v: any[]) => { filtros.push((f) => v.includes(f[k])); return q; },
      or: (expr: string) => { if (expr.startsWith('enviado_en.is.null')) filtros.push((f) => !f.enviado_en); return q; },
      not: () => q, is: () => q, gte: () => q, lt: () => q, order: () => q, limit: () => q,
      single: () => { unico = true; return q; }, maybeSingle: () => { unico = true; return q; },
      then: (ok: any, mal: any) => {
        const filas = (tablas[tabla] ||= []);
        let data: any;
        if (op === 'insert') {
          const nuevas = (Array.isArray(valores) ? valores : [valores]).map((v: any, i: number) => ({ id: `${tabla}-${filas.length + i + 1}`, estado: 'pendiente', ...v }));
          filas.push(...nuevas); data = nuevas;
        } else {
          const elegidas = filas.filter((f) => filtros.every((fn) => fn(f)));
          if (op === 'update') elegidas.forEach((f) => Object.assign(f, valores));
          data = unico ? elegidas[0] ?? null : elegidas;
        }
        return Promise.resolve({ data, error: null, count: conteo ? (Array.isArray(data) ? data.length : 0) : null }).then(ok, mal);
      },
    };
    return q;
  };
  return { tablas, supabase: { from: consulta } };
});

const wa = vi.hoisted(() => ({ enviar: vi.fn(async () => ({ success: true, messageId: 'wamid.x' })) }));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: db.supabase,
  obtenerConversacionActiva: async (id: string) => ({ id: `conv-${id}` }),
}));
vi.mock('@/lib/whatsapp', () => ({ enviarPlantillaWhatsApp: wa.enviar, esIdUsuarioWhatsApp: () => false }));
vi.mock('@/lib/costos', () => ({ registrarEnvioPlantilla: vi.fn(async () => {}), TARIFA_WA_MARKETING: 0.0125, TARIFA_WA_UTILITY: 0.0012, USD_A_COP: 4000 }));
vi.mock('@/lib/eventos', () => ({ registrarEvento: vi.fn(async () => {}) }));
vi.mock('@/lib/carritos', () => ({ celularColombiano: (t: string) => (/^573\d{9}$/.test(t) ? t : null) }));

import { enviarDifusionesProgramadas, enviarLote, difusionLista, prepararParametros } from '@/lib/difusiones';
import { registrarEvento } from '@/lib/eventos';

const BLACK_WEEK = {
  id: 'bw', nombre: 'Black Week 2026 · inicio', plantilla: 'black_week_inicio', idioma: 'es', estado: 'borrador',
  parametros: { cuerpo: ['{nombre}'], boton: '?utm_source=whatsapp&utm_campaign=black_week_2026', texto: 'Hola {nombre}, ¡ya empezó Black Week!', programada_para: '2026-11-23T13:00:00.000Z' },
  segmento: {}, total: 0, enviados: 0, fallidos: 0,
};

beforeEach(() => {
  for (const k of Object.keys(db.tablas)) delete db.tablas[k];
  wa.enviar.mockClear();
  (registrarEvento as any).mockClear();
  db.tablas.difusiones = [{ ...BLACK_WEEK, parametros: { ...BLACK_WEEK.parametros } }];
  db.tablas.clientes = [
    { id: 'c1', telefono: '573001234567', nombre: 'Laura 😘', politicas_aceptadas: true, no_publicidad: false },
    { id: 'c2', telefono: '573119998888', nombre: '🤍', politicas_aceptadas: true, no_publicidad: false },
  ];
});

describe('Difusión programada', () => {
  it('sale cuando llega su hora, no antes', () => {
    expect(difusionLista(db.tablas.difusiones[0], Date.parse('2026-11-23T12:59:00Z'))).toBe(false);
    expect(difusionLista(db.tablas.difusiones[0], Date.parse('2026-11-23T13:00:00Z'))).toBe(true);
    expect(difusionLista({ estado: 'enviando', parametros: BLACK_WEEK.parametros }, Date.parse('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('el nombre del saludo va sin emojis', () => {
    expect(prepararParametros(['{nombre}'], 'Laura 😘')).toEqual(['Laura']);
    expect(prepararParametros(['{nombre}'], '🤍')).toEqual(['cliente']);
  });

  it('a la hora: arma la lista, envía a todos una sola vez y queda completada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T13:00:30Z'));
    try {
      const r = await enviarDifusionesProgramadas();
      expect(r[0]).toMatchObject({ estado: 'completada', enviados: 2, total: 2 });
      expect(wa.enviar).toHaveBeenCalledTimes(2);
      const [tel, plantilla, , components] = wa.enviar.mock.calls[0] as any[];
      expect(tel).toBe('573001234567');
      expect(plantilla).toBe('black_week_inicio');
      expect(components[0].parameters[0].text).toBe('Laura');
      expect(components[1]).toMatchObject({ type: 'button', sub_type: 'url', parameters: [{ type: 'text', text: BLACK_WEEK.parametros.boton }] });
      expect((registrarEvento as any).mock.calls.map((c: any[]) => c[2]).join(' | ')).toMatch(/Empezó la difusión programada .* a 2 clientes/);

      // La siguiente vuelta de la tarea no la repite
      wa.enviar.mockClear();
      await enviarDifusionesProgramadas();
      expect(wa.enviar).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('antes de la hora no envía nada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T20:00:00Z'));
    try {
      await enviarDifusionesProgramadas();
      expect(wa.enviar).not.toHaveBeenCalled();
      expect(db.tablas.difusiones[0].estado).toBe('borrador');
    } finally {
      vi.useRealTimers();
    }
  });

  it('un envío ya reservado por otro proceso no se manda dos veces', async () => {
    db.tablas.difusiones[0].estado = 'enviando';
    db.tablas.difusion_envios = [
      { id: 'e1', difusion_id: 'bw', cliente_id: 'c1', telefono: '573001234567', nombre: 'Laura', estado: 'pendiente', enviado_en: new Date().toISOString() },
      { id: 'e2', difusion_id: 'bw', cliente_id: 'c2', telefono: '573119998888', nombre: null, estado: 'pendiente', enviado_en: null },
    ];
    const r = await enviarLote('bw', 20, 5);
    expect(wa.enviar).toHaveBeenCalledTimes(1);
    expect((wa.enviar.mock.calls[0] as any[])[0]).toBe('573119998888');
    expect(r.procesados).toBe(1);
  });
});
