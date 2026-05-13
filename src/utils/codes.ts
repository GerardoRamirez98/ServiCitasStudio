export function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function makePublicCode(name: string) {
  const prefix =
    normalizeCode(name)
      .replace(/[AEIOU]/g, '')
      .slice(0, 6) || 'STUDIO';
  return `${prefix}${randomDigits(3)}`;
}

export function makeEmployeeInviteCode() {
  return `EMP${randomDigits(4)}`;
}

export function makeSlug(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'negocio'
  );
}

function randomDigits(length: number) {
  return String(Math.floor(Math.random() * 10 ** length)).padStart(length, '0');
}
