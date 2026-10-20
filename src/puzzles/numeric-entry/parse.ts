// Birimli sayı girişi: "2,2k", "2200", "2.2 kΩ", "2,2 kohm", "12mA", "1.5 A", "4,7 V", "1,2M".
// Ondalık ayırıcı virgül ya da nokta; önek µ/u, m, k, M (büyük M = mega, küçük m = mili);
// birim yazılmayabilir, yazılırsa beklenen birim olmalı.

export type QuantityUnit = 'V' | 'A' | 'Ω';

const PREFIX: Record<string, number> = { '': 1, p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6 };
const UNIT_WORDS: Record<QuantityUnit, string[]> = { V: ['v', 'volt'], A: ['a', 'amp', 'amper'], 'Ω': ['ω', 'Ω', 'ohm', 'r'] };

/** Metni beklenen birimde sayıya çevirir; anlaşılmazsa null. */
export function parseQuantity(text: string, unit: QuantityUnit): number | null {
  const t = text.trim().replace(/\s+/g, '');
  const m = /^([+-]?\d+(?:[.,]\d+)?|[+-]?[.,]\d+)(?:e([+-]?\d+))?([pnuµμmkKM]?)(.*)$/.exec(t);
  if (!m) return null;
  const [, num, exp, prefix, rest] = m;
  if (rest !== '' && !UNIT_WORDS[unit].includes(rest.toLowerCase()) && rest !== 'Ω') {
    // "2k2" gibi yazımlar desteklenmez; yanlış birim (ör. Ω beklerken "V") reddedilir
    return null;
  }
  // Tek başına "m" ya da "M" önek; "2,2 m" mili sayılır. Ω'da "M" mega, A/V'de "m" mili (yaygın kullanım).
  const v = Number(num.replace(',', '.')) * (exp ? 10 ** Number(exp) : 1) * PREFIX[prefix];
  return Number.isFinite(v) ? v : null;
}
