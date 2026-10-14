// Sin dependencias: lo usan el servidor (webhook, base de datos) y el CRM.

/**
 * WhatsApp permite que el cliente use un nombre de usuario y oculte su número.
 * En ese caso el webhook NO trae el teléfono sino un "business-scoped user ID"
 * (BSUID) de Meta, ej. "CO.13491208655302741918": país + punto + hasta 128
 * caracteres (las cuentas empresariales llevan "ENT"). Para esos clientes,
 * `clientes.telefono` guarda ese ID en lugar de un número.
 */
export function esIdUsuarioWhatsApp(id: string | null | undefined): boolean {
  return !!id && /^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{1,128}$/.test(id.trim());
}

/** Cómo mostrar el contacto de un cliente: el número, o su @usuario si oculta el número. */
export function contactoVisible(telefono: string | null | undefined, username?: string | null): string {
  if (!telefono) return '';
  if (!esIdUsuarioWhatsApp(telefono)) return `+${telefono.replace(/^\+/, '')}`;
  return username ? `@${username.replace(/^@/, '')}` : 'Usuario de WhatsApp (sin número visible)';
}
