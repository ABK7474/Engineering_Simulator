// E12 standart direnç serisi. Kutudaki dirençler yalnızca bu değerlerden seçilir.

const E12_BASE = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** minOhm..maxOhm aralığındaki tüm E12 değerleri (artan sırada). */
export function e12Values(minOhm = 1, maxOhm = 1_000_000): number[] {
  const out: number[] = [];
  for (let decade = 1; decade <= 1_000_000; decade *= 10) {
    for (const base of E12_BASE) {
      // Kayan nokta artığını temizle (örn. 3.3 * 100 = 329.99999999999994).
      const r = Math.round(base * decade * 100) / 100;
      if (r >= minOhm && r <= maxOhm) out.push(r);
    }
  }
  return out;
}
