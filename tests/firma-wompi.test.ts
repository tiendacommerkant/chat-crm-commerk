import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { checksumWompi, firmaWompiValida } from '@/lib/firma-wompi';

// Datos del ejemplo de https://docs.wompi.co/docs/colombia/eventos/. El
// checksum impreso en esa página no corresponde a su propia cadena, así que se
// verifica la cadena del paso 3 (propiedades de data + timestamp + secreto).
const SECRETO = 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';
const CADENA_DOCUMENTADA = '1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';
const ejemplo = {
  event: 'transaction.updated',
  data: { transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000 } },
  signature: {
    properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
    checksum: crypto.createHash('sha256').update(CADENA_DOCUMENTADA).digest('hex').toUpperCase(),
  },
  timestamp: 1530291411,
  sent_at: '2018-07-20T16:45:05.000Z',
};

describe('Firma de los eventos de Wompi', () => {
  it('arma la cadena como la documentación: propiedades dentro de data, timestamp y secreto', () => {
    expect(checksumWompi(ejemplo, SECRETO)).toBe(crypto.createHash('sha256').update(CADENA_DOCUMENTADA).digest('hex'));
  });

  it('valida un evento bien firmado (checksum en mayúsculas, como lo envía Wompi)', () => {
    expect(firmaWompiValida(ejemplo, SECRETO)).toBe(true);
  });

  it('no usa sent_at (la verificación anterior nunca coincidía)', () => {
    expect(firmaWompiValida({ ...ejemplo, timestamp: ejemplo.sent_at }, SECRETO)).toBe(false);
  });

  it('rechaza otro secreto, un monto alterado o un evento sin timestamp', () => {
    expect(firmaWompiValida(ejemplo, 'otro_secreto')).toBe(false);
    const alterado = { ...ejemplo, data: { transaction: { ...ejemplo.data.transaction, amount_in_cents: 100 } } };
    expect(firmaWompiValida(alterado, SECRETO)).toBe(false);
    expect(firmaWompiValida({ ...ejemplo, timestamp: undefined }, SECRETO)).toBe(false);
  });

  it('rechaza eventos sin firma o sin secreto configurado', () => {
    expect(firmaWompiValida({ ...ejemplo, signature: undefined }, SECRETO)).toBe(false);
    expect(firmaWompiValida(ejemplo, '')).toBe(false);
  });
});
