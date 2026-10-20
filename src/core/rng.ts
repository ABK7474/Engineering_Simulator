// Tohumlu RNG (mulberry32). Aynı tohum → aynı problem ve aynı hata sonucu; testler deterministik.

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: boş liste');
  return items[Math.floor(rng() * items.length)];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Ağırlıklı seçim; ağırlığı 0 olanlar asla seçilmez. */
export function weightedPick<T>(rng: Rng, items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (total <= 0) throw new Error('weightedPick: toplam ağırlık 0');
  let x = rng() * total;
  for (const item of items) {
    const w = Math.max(0, item.weight);
    if (x < w) return item.value;
    x -= w;
  }
  return items.filter((i) => i.weight > 0).at(-1)!.value;
}
