import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { clavesWebhookShopify, firmaShopifyValida } from '@/lib/firma-shopify';

const firmar = (cuerpo: string, clave: string) => crypto.createHmac('sha256', clave).update(cuerpo, 'utf8').digest('base64');

describe('Firma de los avisos de Shopify', () => {
  const cuerpo = JSON.stringify({ id: 1045, financial_status: 'paid' });
  const claves = clavesWebhookShopify({ SHOPIFY_WEBHOOK_SECRET: 'clave-del-admin', SHOPIFY_CLIENT_SECRET: 'clave-de-la-app' });

  it('acepta los avisos firmados con la clave del admin', () => {
    expect(firmaShopifyValida(cuerpo, firmar(cuerpo, 'clave-del-admin'), claves)).toBe(true);
  });

  it('acepta los avisos que registró la app (firmados con su clave secreta)', () => {
    expect(firmaShopifyValida(cuerpo, firmar(cuerpo, 'clave-de-la-app'), claves)).toBe(true);
  });

  it('rechaza firmas de otra clave, cuerpos alterados y avisos sin firma', () => {
    expect(firmaShopifyValida(cuerpo, firmar(cuerpo, 'otra-clave'), claves)).toBe(false);
    expect(firmaShopifyValida(cuerpo + ' ', firmar(cuerpo, 'clave-de-la-app'), claves)).toBe(false);
    expect(firmaShopifyValida(cuerpo, null, claves)).toBe(false);
  });

  it('sin claves configuradas no acepta nada', () => {
    expect(clavesWebhookShopify({})).toEqual([]);
    expect(firmaShopifyValida(cuerpo, firmar(cuerpo, ''), [])).toBe(false);
  });

  it('no repite la clave cuando las dos variables son iguales', () => {
    expect(clavesWebhookShopify({ SHOPIFY_WEBHOOK_SECRET: 'misma', SHOPIFY_CLIENT_SECRET: ' misma ' })).toEqual(['misma']);
  });
});
