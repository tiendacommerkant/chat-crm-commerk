import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));

const { conPreciosDeMercado, preciosActualizados } = await import('@/lib/precios-mercado');
const { mapearProductoParaBot } = await import('@/lib/shopify');

const precios = (porProducto: Record<string, Record<string, number>>) =>
  new Map(Object.entries(porProducto).map(([p, vs]) => [p, new Map(Object.entries(vs))]));

const producto = (id: number, variantes: Array<[number, string, string]>) => ({
  id, title: 'Producto', body_html: '', product_type: 'Ron', tags: '', status: 'active', image: null,
  variants: variantes.map(([vid, title, price]) => ({ id: vid, title, price, inventory_management: null, inventory_policy: 'deny', inventory_quantity: 5 })),
}) as any;

describe('Precio vigente en Colombia (catálogo de Black Friday)', () => {
  it('el bot cotiza el precio del catálogo activo y no el precio base', () => {
    const ron = producto(1, [[11, 'Default Title', '55600.00']]);
    const mapeado = mapearProductoParaBot(conPreciosDeMercado(ron, precios({ 1: { 11: 44480 } })));
    expect(mapeado.precio).toBe(44480);
  });

  it('en un kit cada botella toma su precio y el "desde" es el menor', () => {
    const kit = producto(2, [[21, 'Carta de Oro', '313400.00'], [22, 'Esencial', '235200.00']]);
    const mapeado = mapearProductoParaBot(conPreciosDeMercado(kit, precios({ 2: { 21: 250000, 22: 190000 } })));
    expect(mapeado.metadata?.variantes.map((v: any) => v.precio)).toEqual([250000, 190000]);
    expect(mapeado.precio).toBe(190000);
  });

  it('sin precio de Colombia (o si falló la consulta) queda el precio base', () => {
    const ron = producto(1, [[11, 'Default Title', '55600.00']]);
    expect(mapearProductoParaBot(conPreciosDeMercado(ron, null)).precio).toBe(55600);
    expect(mapearProductoParaBot(conPreciosDeMercado(ron, precios({ 9: { 99: 1 } }))).precio).toBe(55600);
  });

  it('la revisión de cada 10 minutos solo cambia lo que cambió', () => {
    const fila = { id: 'a', shopify_id: '1', precio: 55600, metadata: null };
    expect(preciosActualizados(fila, new Map([['11', 55600]]))).toBeNull();
    expect(preciosActualizados(fila, new Map([['11', 44480]]))).toEqual({ precio: 44480 });
    // Al terminar el evento vuelve al precio normal
    expect(preciosActualizados({ ...fila, precio: 44480 }, new Map([['11', 55600]]))).toEqual({ precio: 55600 });
  });

  it('en un kit actualiza cada botella y conserva el resto de sus datos', () => {
    const fila = {
      id: 'k', shopify_id: '2', precio: 235200,
      metadata: { variantes: [{ id: '21', titulo: 'Carta de Oro', precio: 313400, inventario: 3 }, { id: '22', titulo: 'Esencial', precio: 235200, inventario: 9 }] },
    };
    const r = preciosActualizados(fila, new Map([['21', 250000], ['22', 190000]]));
    expect(r?.precio).toBe(190000);
    expect(r?.metadata?.variantes).toEqual([
      { id: '21', titulo: 'Carta de Oro', precio: 250000, inventario: 3 },
      { id: '22', titulo: 'Esencial', precio: 190000, inventario: 9 },
    ]);
    expect(preciosActualizados(fila, new Map([['21', 313400], ['22', 235200]]))).toBeNull();
  });
});
