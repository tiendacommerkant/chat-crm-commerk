import { describe, it, expect } from 'vitest';
import { primerNombre } from '@/lib/nombre';

describe('Nombre para saludar', () => {
  it.each([
    ['Adriana', 'Adriana'],
    ['Laura Gómez', 'Laura'],
    ['DANIEL PARRADO 🔥', 'Daniel'],
    ['😜Yohanita😍', 'Yohanita'],
    ['Smith🍀', 'Smith'],
    ['Sra Marcela Giraldo', 'Marcela'],
    ['millerfelipe975@gmail,Com', 'Millerfelipe'],
    ['juan david parra', 'Juan'],
  ])('"%s" → %s', (entrada, esperado) => expect(primerNombre(entrada)).toBe(esperado));

  it.each(['🤍', '🥰🥰🥰', '🤴👸🤴😍👣🙏', 'A.P', '0', '573001234567', '', null, undefined])(
    '"%s" no sirve como nombre', (entrada) => expect(primerNombre(entrada as any)).toBeNull());
});
