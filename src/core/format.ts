// Türkçe ondalık virgülüyle birim biçimlendirme (3 anlamlı basamak).

function num(x: number): string {
  return String(Number(x.toPrecision(3))).replace('.', ',');
}

export function formatOhm(r: number): string {
  if (r >= 1e6) return `${num(r / 1e6)} MΩ`;
  if (r >= 1e3) return `${num(r / 1e3)} kΩ`;
  return `${num(r)} Ω`;
}

export function formatAmp(i: number): string {
  if (i === 0) return '0 mA';
  if (Math.abs(i) >= 1) return `${num(i)} A`;
  if (Math.abs(i) >= 1e-3) return `${num(i * 1e3)} mA`;
  return `${num(i * 1e6)} µA`;
}

export function formatVolt(v: number): string {
  return `${num(v)} V`;
}

export function formatWatt(p: number): string {
  if (p === 0) return '0 W';
  if (Math.abs(p) >= 1) return `${num(p)} W`;
  if (Math.abs(p) >= 1e-3) return `${num(p * 1e3)} mW`;
  return `${num(p * 1e6)} µW`;
}

/** Si önekleriyle (m, µ, k, M) 3 anlamlı basamak. */
function si(x: number, unit: string): string {
  const a = Math.abs(x);
  if (a === 0) return `0 ${unit}`;
  for (const [f, p] of [
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
  ] as const)
    if (a >= f * 0.9995) return `${num(x / f)} ${p}${unit}`;
  return `${num(x / 1e-12)} p${unit}`;
}

export const formatHz = (f: number) => si(f, 'Hz');
export const formatSec = (t: number) => si(t, 's');
export const formatFarad = (c: number) => si(c, 'F');
export const formatHenry = (l: number) => si(l, 'H');
/** Oran (0..1) → "%38,2". */
export const formatPct = (p: number, digits = 1) => `%${(p * 100).toFixed(digits).replace('.', ',')}`;

/** Karşılaştırma için: küçük harf, Türkçe karakterler katlanır, harf/rakam dışı tek tire. */
export const normalizeName = (s: string): string =>
  s
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[c]!)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
