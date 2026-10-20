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
