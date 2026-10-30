import { defineConfig } from 'vitest/config';
import path from 'path';

// Pruebas del bot y del CRM. No usan red: la base de datos, Sofi (IA) y
// WhatsApp se simulan en cada prueba (ver tests/apoyo).
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      // El motor del bot decide si usa a Sofi según exista la llave
      ANTHROPIC_API_KEY: 'llave-de-prueba',
      SUPABASE_SERVICE_KEY: 'secreto-de-prueba',
      SHIPPING_COVERAGE: 'Medellín,Envigado,Itagüí,Sabaneta,Bello,La Estrella,Caldas,Copacabana',
      SHIPPING_COST: '8000',
      FREE_SHIPPING_THRESHOLD: '149000',
    },
  },
});
