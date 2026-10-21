// Birinci mertebe alçak geçiren filtre (ters problem): sonar ön katında sinyal frekansı fₛ geçmeli (en fazla
// gₛ dB zayıflama), gürültü frekansı fₙ bastırılmalı (en az gₙ dB). İki şart kesim frekansını bir aralığa
// sıkıştırır: f_c ≥ fₛ/√(10^(−gₛ/10) − 1) ve f_c ≤ fₙ/√(10^(−gₙ/10) − 1). Oyuncu bu aralıktan direnci bulur.
//   RC: seri R, paralel C (çıkış C'de) → f_c = 1/(2πRC)
//   RL: seri L, paralel R (çıkış R'de) → f_c = R/(2πL)
// Kazanç iki bağımsız yoldan hesaplanır: kapalı form 1/√(1+(f/f_c)²) ve karmaşık empedans bölücüsü.

export type FilterKind = 'rc' | 'rl';

export interface FilterConfig {
  kinds: FilterKind[];
  /** RC için kondansatör seçenekleri (nF), RL için bobin seçenekleri (mH). */
  c_nF: number[];
  l_mH: number[];
  /** Sinyal ve gürültü frekansı seçenekleri (Hz). */
  fSignal: number[];
  fNoise: number[];
  /** Cevap direncinin E12 aralığı. */
  answer: Record<FilterKind, [number, number]>;
  /** Kesim frekansı penceresinin yarı genişliği (oran); bitişik E12 (~%18) dışarıda kalmalı. */
  window: number;
  binSize: number;
}

export function parseFilterConfig(raw: unknown): FilterConfig {
  const c = raw as FilterConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('filter yapılandırması nesne olmalı');
  need(Array.isArray(c.kinds) && c.kinds.length > 0 && c.kinds.every((k) => k === 'rc' || k === 'rl'), 'kinds rc/rl listesi olmalı');
  const pos = (a: unknown) => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'number' && x > 0);
  need(pos(c.c_nF) && pos(c.l_mH) && pos(c.fSignal) && pos(c.fNoise), 'c_nF, l_mH, fSignal, fNoise pozitif listeler olmalı');
  for (const k of ['rc', 'rl'] as const) need(Array.isArray(c.answer?.[k]) && c.answer[k][0] > 0 && c.answer[k][0] < c.answer[k][1], `answer.${k} [min, max] olmalı`);
  need(c.window > 0 && c.window <= 0.08, 'window 0–0,08 olmalı');
  need(Number.isInteger(c.binSize) && c.binSize >= 3 && c.binSize <= 7, 'binSize 3–7 olmalı');
  if (errors.length) throw new Error(`filter yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

/** Bileşen: RC'de kapasite (F), RL'de endüktans (H). */
export interface FilterParts {
  kind: FilterKind;
  part: number;
}

export const cutoff = (p: FilterParts, r: number) => (p.kind === 'rc' ? 1 / (2 * Math.PI * r * p.part) : r / (2 * Math.PI * p.part));
/** Kesimden R: kesim frekansını veren direnç. */
export const resistorFor = (p: FilterParts, fc: number) => (p.kind === 'rc' ? 1 / (2 * Math.PI * p.part * fc) : 2 * Math.PI * p.part * fc);

/** Kapalı form genlik. */
export const gainClosed = (fc: number, f: number) => 1 / Math.sqrt(1 + (f / fc) ** 2);

/** Karmaşık empedans bölücüsüyle genlik (bağımsız yol). */
export function gainComplex(p: FilterParts, r: number, f: number): number {
  const w = 2 * Math.PI * f;
  // Z = a + jb
  if (p.kind === 'rc') {
    // H = Z_C / (R + Z_C), Z_C = −j/(ωC)
    const zc = -1 / (w * p.part);
    const den = Math.hypot(r, zc);
    return Math.abs(zc) / den;
  }
  // H = R / (R + jωL)
  return r / Math.hypot(r, w * p.part);
}

export const toDb = (g: number) => 20 * Math.log10(g);
export const fromDb = (db: number) => 10 ** (db / 20);

/** dB şartlarından kesim aralığı. */
export function cutoffBounds(fs: number, gsDb: number, fn: number, gnDb: number): [number, number] {
  const lo = fs / Math.sqrt(10 ** (-gsDb / 10) - 1);
  const hi = fn / Math.sqrt(10 ** (-gnDb / 10) - 1);
  return [lo, hi];
}
