// Indicadores del tablero de atención con un caso armado a mano
import { describe, it, expect } from 'vitest';
import { calcularTablero, type DatosTablero } from '@/lib/tablero';

const ahora = new Date('2026-11-05T22:00:00Z'); // 5 nov, 5:00 p. m. Colombia
const t = (h: string) => new Date(`2026-11-05T${h}:00Z`).toISOString(); // hora UTC del 5 de noviembre

const datos: DatosTablero = {
  desde: new Date('2026-11-04T05:00:00Z').toISOString(),
  conversacionesNuevas: 3,
  mensajes: [
    // A: la resuelve Sofi sola
    { conversacion_id: 'A', tipo: 'user', created_at: t('14:00'), metadata: {} },
    { conversacion_id: 'A', tipo: 'bot', created_at: t('14:01'), metadata: { sofi_ia: true } },
    // B: pide un asesor por un problema de pago y le responden a los 12 minutos
    { conversacion_id: 'B', tipo: 'user', created_at: t('15:00'), metadata: {} },
    { conversacion_id: 'B', tipo: 'bot', created_at: t('15:00'), metadata: { transferido_a_asesor: true, motivo_transferencia: 'pago' } },
    { conversacion_id: 'B', tipo: 'bot', created_at: t('15:12'), metadata: { enviado_por: 'agente', asesor: 'mateo@x.co', asesor_nombre: 'Mateo' } },
    { conversacion_id: 'B', tipo: 'bot', created_at: t('15:20'), metadata: { enviado_por: 'agente', asesor: 'mateo@x.co', asesor_nombre: 'Mateo' } },
    // C: compra al por mayor y nadie le responde
    { conversacion_id: 'C', tipo: 'user', created_at: t('16:00'), metadata: {} },
    { conversacion_id: 'C', tipo: 'bot', created_at: t('16:01'), metadata: { transferido_a_asesor: true, derivacion: 'mayorista' } },
  ],
  ventas: [
    { referencia_pago: 'WA-1', estado: 'pagado', total: 100000, created_at: t('15:30') },
    { referencia_pago: 'WA-1', estado: 'pagado', total: 50000, created_at: t('15:30') },
    { referencia_pago: 'WA-2', estado: 'pendiente', total: 80000, created_at: t('16:30') },
  ],
  encuestas: [
    { asesor: 'mateo@x.co', asesor_nombre: 'Mateo', calificacion: 3, comentario: null, created_at: t('15:40') },
    { asesor: 'mateo@x.co', asesor_nombre: 'Mateo', calificacion: 1, comentario: 'Tardaron', created_at: t('15:45') },
  ],
  leads: [{ sede: 'CC Tesoro', created_at: t('16:02') }, { sede: 'Ventas Empresariales', created_at: t('16:05') }],
  pendientes: [{ pendiente_desde: t('16:01'), updated_at: t('16:01') }],
};

describe('Tablero de atención', () => {
  const r = calcularTablero(datos, ahora);

  it('cuenta conversaciones y cuántas resolvió Sofi sola', () => {
    expect(r.resumen.conversaciones_activas).toBe(3);
    expect(r.resumen.resueltas_por_bot).toBe(1);
    expect(r.resumen.porcentaje_bot).toBe(33);
  });

  it('mide la primera respuesta del asesor y las que quedaron sin responder', () => {
    expect(r.resumen.transferencias).toBe(2);
    expect(r.resumen.primera_respuesta_mediana_min).toBe(12);
    expect(r.resumen.transferencias_sin_respuesta).toBe(1);
  });

  it('agrupa los motivos de transferencia', () => {
    expect(r.motivos.map((m) => m.motivo).sort()).toEqual(['Ayuda con el pago', 'Compra al por mayor']);
  });

  it('un link con varias líneas cuenta una vez y suma su total', () => {
    expect(r.resumen.links_generados).toBe(2);
    expect(r.resumen.links_pagados).toBe(1);
    expect(r.resumen.conversion_links).toBe(50);
    expect(r.resumen.valor_pagado).toBe(150000);
  });

  it('calcula la satisfacción y guarda los comentarios', () => {
    expect(r.resumen.satisfaccion).toBe(50);
    expect(r.encuestas).toMatchObject({ excelente: 1, buena: 0, mala: 1 });
    expect(r.encuestas.comentarios[0].comentario).toBe('Tardaron');
  });

  it('resume el desempeño por asesor', () => {
    const mateo = r.asesores.find((a) => a.asesor === 'Mateo')!;
    expect(mateo).toMatchObject({ conversaciones: 1, mensajes: 2, primera_respuesta_mediana_min: 12, encuestas: 2, satisfaccion: 50 });
  });

  it('muestra quién espera ahora y desde cuándo', () => {
    expect(r.resumen.pendientes_ahora).toBe(1);
    expect(Math.round(r.resumen.espera_mas_larga_min!)).toBe(359);
  });

  it('arma la serie por día en hora de Colombia, incluidos los días sin mensajes', () => {
    expect(r.serie.map((s) => s.dia)).toEqual(['2026-11-04', '2026-11-05']);
    expect(r.serie[1]).toMatchObject({ conversaciones: 3, mensajes: 3 });
    expect(r.serie[0].conversaciones).toBe(0);
  });

  it('cuenta las solicitudes por sede', () => {
    expect(r.leads).toHaveLength(2);
  });

  it('sin datos no inventa porcentajes', () => {
    const vacio = calcularTablero({ ...datos, mensajes: [], ventas: [], encuestas: [], leads: [], pendientes: [] }, ahora);
    expect(vacio.resumen.porcentaje_bot).toBeNull();
    expect(vacio.resumen.satisfaccion).toBeNull();
    expect(vacio.resumen.conversion_links).toBeNull();
    expect(vacio.resumen.primera_respuesta_mediana_min).toBeNull();
  });
});
