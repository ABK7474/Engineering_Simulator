// Doğrusal sistemlerde kararlılık (özdeğer): hava kilidi basınç denetleyicisi ẋ = A·x, A = [[a, b], [−k, −c]].
// a > 0: denetimsiz basınç sapması büyür (açık çevrimde kararsız); k geri besleme kazancı (oyuncu seçer).
// Karakteristik denklem λ² − iz(A)·λ + det(A) = 0, iz = a − c, det = −a·c + b·k. Şartlar: en yavaş özdeğerin
// reel kısmı ≤ −σ (yeterince hızlı) ve sönüm oranı ζ ≥ ζ_min (fazla salınım yok).
// Özdeğerler iki bağımsız yoldan: kapalı form ikinci derece kökler ve RK4 benzetiminden ölçülen sönüm hızı.


export interface StabilityConfig {
  /** a (1/s, açık çevrim büyüme), b, c (1/s) seçenekleri. */
  a: number[];
  b: number[];
  c: number[];
  /** Aday kazançlar: k₀·çarpan^j, j = 0…adet−1. */
  gains: { base: number[]; ratio: number; count: number };
}

export function parseStabilityConfig(raw: unknown): StabilityConfig {
  const c = raw as StabilityConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('stability yapılandırması nesne olmalı');
  for (const k of ['a', 'b', 'c'] as const) need(Array.isArray(c[k]) && c[k].length > 0 && c[k].every((x) => x > 0), `${k} pozitif liste olmalı`);
  need(Array.isArray(c.gains?.base) && c.gains.base.every((x) => x > 0) && c.gains.ratio >= 1.5 && Number.isInteger(c.gains.count) && c.gains.count >= 4 && c.gains.count <= 7, 'gains {base, ratio ≥ 1,5, count 4–7} olmalı');
  if (errors.length) throw new Error(`stability yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export interface Plant {
  a: number;
  b: number;
  c: number;
}

export interface Eigen {
  /** Kökler (reel, sanal). */
  roots: [number, number][];
  /** En büyük reel kısım (kararlılık: < 0). */
  maxRe: number;
  /** Sönüm oranı: karmaşık köklerde −Re/|λ|; reel köklerde 1. */
  zeta: number;
}

/** Kapalı form: λ² − (a − c)·λ + (b·k − a·c) = 0. */
export function eigen(p: Plant, k: number): Eigen {
  const tr = p.a - p.c;
  const det = p.b * k - p.a * p.c;
  const disc = tr * tr - 4 * det;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    const roots: [number, number][] = [
      [(tr + s) / 2, 0],
      [(tr - s) / 2, 0],
    ];
    return { roots, maxRe: (tr + s) / 2, zeta: 1 };
  }
  const re = tr / 2;
  const im = Math.sqrt(-disc) / 2;
  return { roots: [[re, im], [re, -im]], maxRe: re, zeta: -re / Math.hypot(re, im) };
}

/** x(0) = [1, 0] ile iki boyutlu RK4 benzetimi: [t, x₁, x₂] örnekleri. */
export function simulate(p: Plant, k: number, tEnd: number, steps: number): [number, number, number][] {
  const h = tEnd / steps;
  const f = (xx: number, yy: number): [number, number] => [p.a * xx + p.b * yy, -k * xx - p.c * yy];
  let x = 1;
  let y = 0;
  const out: [number, number, number][] = [[0, x, y]];
  for (let s = 0; s < steps; s++) {
    const [k1x, k1y] = f(x, y);
    const [k2x, k2y] = f(x + (h / 2) * k1x, y + (h / 2) * k1y);
    const [k3x, k3y] = f(x + (h / 2) * k2x, y + (h / 2) * k2y);
    const [k4x, k4y] = f(x + h * k3x, y + h * k3y);
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    out.push([(s + 1) * h, x, y]);
  }
  return out;
}

/** Bağımsız yol: benzetimde geç zamanlardaki |x| eğiminden en büyük reel kısım (özdeğer formülü kullanılmaz). */
export function decayRateBySimulation(p: Plant, k: number): number {
  // Benzetim süresi kapalı formdan bağımsız seçilir: sistemin hızlı/yavaş olmasına göre kaba bir ölçek
  const scale = Math.max(Math.abs(p.a - p.c) / 2, 0.05);
  // En yavaş kökün büyüklüğü bu ölçeği aşmaz (reel köklerde |maxRe| ≤ |iz|/2, karmaşıkta eşit): ~30 zaman sabiti
  const tEnd = Math.min(80, 30 / scale);
  const norms = simulate(p, k, tEnd, 12000).map(([t, x, y]): [number, number] => [t, Math.hypot(x, y)]);
  // Salınımlı yanıtta |x| dalgalanır: son yarıda yerel tepelerin log-eğimi (doğrusal en küçük kareler)
  const late = norms.slice(Math.floor(norms.length / 2));
  const peaks = late.filter((pt, i) => i > 0 && i < late.length - 1 && pt[1] >= late[i - 1][1] && pt[1] >= late[i + 1][1]);
  const pts = peaks.length >= 4 ? peaks : late;
  const n = pts.length;
  const mx = pts.reduce((sum, q) => sum + q[0], 0) / n;
  const my = pts.reduce((sum, q) => sum + Math.log(q[1]), 0) / n;
  let num = 0;
  let den = 0;
  for (const [t, v] of pts) {
    num += (t - mx) * (Math.log(v) - my);
    den += (t - mx) ** 2;
  }
  return num / den;
}

/** Grafik için basınç sapması x₁(t). */
export const response = (p: Plant, k: number, tEnd: number): [number, number][] => simulate(p, k, tEnd, 400).map(([t, x]) => [t, x]);
