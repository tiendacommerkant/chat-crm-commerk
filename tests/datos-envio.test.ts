// Datos de envío del domicilio: la plantilla del equipo y las formas en que
// los clientes la contestan por WhatsApp.
import { describe, it, expect } from 'vitest';
import { extraerDatosEnvio, camposFaltantes, direccionCompleta, siNo, telefonoDeWhatsApp, lineasCampos, CAMPOS_PEDIDOS, SIN_CORREO } from '@/lib/bot/datos-envio';

const ZONA = ['Medellín', 'Bello', 'Itagüí', 'Sabaneta', 'Envigado', 'La Estrella', 'Caldas', 'Copacabana'];
const leer = (texto: string, previos = {}) => extraerDatosEnvio(texto, previos, ZONA);

describe('Plantilla llenada por el cliente', () => {
  it('copia la plantilla del bot con sus emojis y la llena', () => {
    const { datos } = leer(`${lineasCampos(CAMPOS_PEDIDOS)}`
      .replace('*Nombre:*', '*Nombre:* Juliana Toro')
      .replace('*Cédula:*', '*Cédula:* 1.036.654.321')
      .replace('*Correo electrónico:*', '*Correo electrónico:* Juli.Toro@gmail.com')
      .replace('*Teléfono:*', '*Teléfono:* 311 635 0500')
      .replace('*Dirección:*', '*Dirección:* Calle 10 # 40-20 apto 301')
      .replace('*Barrio:*', '*Barrio:* El Poblado')
      .replace('SI/NO*', 'SI/NO* si'));
    expect(datos).toEqual({
      nombre: 'Juliana Toro', cedula: '1036654321', correo: 'juli.toro@gmail.com', telefono: '3116350500',
      direccion: 'Calle 10 # 40-20 apto 301', barrio: 'El Poblado', factura: 'SI',
    });
    expect(camposFaltantes(datos)).toEqual([]);
  });

  it('la plantilla del equipo escrita a mano, sin emojis', () => {
    const { datos } = leer('Nombre: Carlos Ruiz\nCédula: 71.234.567\nCorreo electrónico: carlos@hotmail.com\nTeléfono: 3001234567\nDirección: Cra 43A # 1-50\nBarrio: Zúñiga\n¿Factura electronica? SI/NO: no');
    expect(datos).toMatchObject({ nombre: 'Carlos Ruiz', cedula: '71234567', correo: 'carlos@hotmail.com', direccion: 'Cra 43A # 1-50', barrio: 'Zúñiga', factura: 'NO' });
  });

  it('varias etiquetas en una misma línea', () => {
    const { datos } = leer('Nombre: Ana Gil Cédula: 43567890 Correo: ana@gmail.com');
    expect(datos).toMatchObject({ nombre: 'Ana Gil', cedula: '43567890', correo: 'ana@gmail.com' });
  });

  it('C.C. y Celular también son etiquetas; un NIT conserva su dígito', () => {
    expect(leer('C.C. 1036654321').datos.cedula).toBe('1036654321');
    expect(leer('NIT: 900.123.456-7').datos.cedula).toBe('900123456-7');
    expect(leer('Celular: +57 300 123 4567').datos.telefono).toBe('3001234567');
  });
});

describe('Sin etiquetas', () => {
  it('un dato por línea, en el orden de la plantilla', () => {
    const { datos } = leer('Juan Pérez\n1036654321\njuanp@gmail.com\n3001234567\nCarrera 43A # 1-50\nLaureles\nNo');
    expect(datos).toEqual({
      nombre: 'Juan Pérez', cedula: '1036654321', correo: 'juanp@gmail.com', telefono: '3001234567',
      direccion: 'Carrera 43A # 1-50', barrio: 'Laureles', factura: 'NO',
    });
  });

  it('todo en una línea separado por comas', () => {
    const { datos } = leer('Juan Pérez, 1036654321, juanp@gmail.com, 3001234567, Calle 10 # 20-30, Laureles, si');
    expect(datos).toMatchObject({ nombre: 'Juan Pérez', cedula: '1036654321', telefono: '3001234567', direccion: 'Calle 10 # 20-30', barrio: 'Laureles', factura: 'SI' });
  });

  it('la dirección con barrio y municipio separa cada parte', () => {
    const { datos } = leer('Calle 10 # 40-20, El Poblado, Medellín');
    expect(datos).toMatchObject({ direccion: 'Calle 10 # 40-20', barrio: 'El Poblado', municipio: 'Medellín' });
    expect(direccionCompleta(datos)).toBe('Calle 10 # 40-20, barrio El Poblado, Medellín');
  });

  it('"barrio X" dentro de la dirección', () => {
    const { datos } = leer('Cl 50 # 30-20 barrio Belén, Medellín');
    expect(datos).toMatchObject({ direccion: 'Cl 50 # 30-20', barrio: 'Belén', municipio: 'Medellín' });
  });

  it('el complemento (apto, torre) se suma a la dirección', () => {
    const { datos } = leer('Calle 10 # 20-30, apto 301, Laureles, Medellín');
    expect(datos.direccion).toBe('Calle 10 # 20-30 apto 301');
    expect(datos.barrio).toBe('Laureles');
  });
});

describe('Lo que falta, en otro mensaje', () => {
  const casiTodo = { nombre: 'Juan Pérez', correo: 'juanp@gmail.com', telefono: '3001234567', direccion: 'Calle 10 # 20-30', barrio: 'Laureles', factura: 'NO' as const };

  it('solo la cédula, aunque la escriba con texto', () => {
    expect(leer('1036654321', casiTodo).datos.cedula).toBe('1036654321');
    expect(leer('es la 43.567.890', casiTodo).datos.cedula).toBe('43567890');
  });

  it('el nombre después de dar la dirección no se toma como barrio', () => {
    const { datos } = leer('Juan Pérez', { direccion: 'Calle 10 # 20-30' });
    expect(datos.nombre).toBe('Juan Pérez');
    expect(datos.barrio).toBeUndefined();
  });

  it('"me llamo…" deja solo el nombre', () => {
    expect(leer('Me llamo Laura Gómez', { direccion: 'Calle 1 # 2-3' }).datos.nombre).toBe('Laura Gómez');
  });

  it('factura: "no señor", "sí por favor"', () => {
    const { factura: _f, ...sinFactura } = casiTodo;
    expect(leer('no señor', { ...sinFactura, cedula: '123456' }).datos.factura).toBe('NO');
    expect(leer('Sí por favor', { ...sinFactura, cedula: '123456' }).datos.factura).toBe('SI');
  });

  it('sin correo', () => {
    expect(leer('no tengo correo').datos.correo).toBe(SIN_CORREO);
  });

  it('una pregunta no es un dato', () => {
    expect(leer('cuanto vale el envio').nuevos).toEqual([]);
    expect(leer('¿Cuánto se demora en llegar?').nuevos).toEqual([]);
    expect(leer('hola').nuevos).toEqual([]);
  });

  it('un correo mal escrito no se acepta (Shopify rechazaría el pedido)', () => {
    expect(leer('juan@gmail').datos.correo).toBeUndefined();
  });
});

describe('Ayudas', () => {
  it('sí/no', () => {
    expect(siNo('SI')).toBe('SI');
    expect(siNo('no gracias')).toBe('NO');
    expect(siNo('tal vez')).toBeNull();
  });

  it('teléfono del WhatsApp en 10 dígitos; sin número si el cliente lo oculta', () => {
    expect(telefonoDeWhatsApp('573001234567')).toBe('3001234567');
    expect(telefonoDeWhatsApp('CO.13491208655302741918')).toBe('');
  });
});
