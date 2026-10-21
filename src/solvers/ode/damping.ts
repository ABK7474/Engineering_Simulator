// İkinci mertebe sönüm tasarımı (ters, çok adımlı): hava kilidi dış kapısı m·x″ + c·x′ + k·x = k·x_hedef.
// Amortisör sökülüyken serbest salınım periyodu T₀ ölçülmüş → ω_n = 2π/T₀ → k = m·ω_n². Kapı kritik sönüme
// yakın (ζ penceresi) kapanmalı: ζ = c / (2·√(m·k)) = c / (2·m·ω_n). Oyuncu katalogdan amortisörü (c) seçer.
// Yanıt iki bağımsız yoldan: kapalı form (eksik/kritik/aşırı sönümlü) ve RK4; aşma ve %2 oturma süresi uyuşmalı.


export interface DampingConfig {
  /** Kapı kütlesi seçenekleri (kg). */
  mass: number[];
  /** Ölçülen serbest periyot aralığı (s); cevaptan türetilir, bu aralıkta kalmalı. */
  period: [number, number];
  /** Kabul edilen ζ penceresi [alt, üst]; oranı bitişik E12 oranından (~1,18) küçük olmalı. */
  zeta: [number, number];
  /** Amortisör kataloğu: E12 aralığı (N·s/m). */
  answer: [number, number];
  binSize: number;
}

export function parseDampingConfig(raw: unknown): DampingConfig {
  const c = raw as DampingConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('damping yapılandırması nesne olmalı');
  need(Array.isArray(c.mass) && c.mass.length > 0 && c.mass.every((x) => x > 0), 'mass pozitif liste olmalı');
  need(Array.isArray(c.period) && c.period[0] > 0 && c.period[0] < c.period[1], 'period [min, max] olmalı');
  need(Array.isArray(c.zeta) && c.zeta[0] > 0 && c.zeta[0] < 1 && c.zeta[1] > 1 && c.zeta[1] / c.zeta[0] < 1.18, 'zeta [alt < 1 < üst], oran < 1,18 olmalı');
  need(Array.isArray(c.answer) && c.answer[0] > 0 && c.answer[0] < c.answer[1], 'answer [min, max] olmalı');
  need(Number.isInteger(c.binSize) && c.binSize >= 3 && c.binSize <= 7, 'binSize 3–7 olmalı');
  if (errors.length) throw new Error(`damping yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export interface Door {
  m: number;
  k: number;
  c: number;
}

export const omegaN = (d: Pick<Door, 'm' | 'k'>) => Math.sqrt(d.k / d.m);
export const zetaOf = (d: Door) => d.c / (2 * Math.sqrt(d.m * d.k));

/** Kapalı form birim basamak yanıtı x(t) (x(0) = 0, x′(0) = 0, hedef 1). */
export function stepClosed(d: Door, t: number): number {
  const w = omegaN(d);
  const z = zetaOf(d);
  if (Math.abs(z - 1) < 1e-9) return 1 - Math.exp(-w * t) * (1 + w * t);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t));
  }
  const r = Math.sqrt(z * z - 1);
  const s1 = -w * (z - r);
  const s2 = -w * (z + r);
  return 1 + (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s1 - s2);
}

export interface Metrics {
  /** Aşma (oran; 0 = aşma yok). */
  overshoot: number;
  /** %2 bandına son giriş anı (s). */
  settling: number;
}

/** Yanıt örneklerinden aşma ve %2 oturma süresi. */
function metricsOf(samples: [number, number][]): Metrics {
  let peak = -Infinity;
  let settling = 0;
  for (const [t, x] of samples) {
    peak = Math.max(peak, x);
    if (Math.abs(x - 1) > 0.02) settling = t;
  }
  return { overshoot: Math.max(0, peak - 1), settling };
}

/** Simülasyon ufku: en yavaş kutbun ~12 zaman sabiti. */
export function horizon(d: Door): number {
  const w = omegaN(d);
  const z = zetaOf(d);
  const slow = z < 1 ? z * w : w * (z - Math.sqrt(z * z - 1));
  return 12 / slow;
}

export function sampleClosed(d: Door, n = 4000): [number, number][] {
  const T = horizon(d);
  return Array.from({ length: n + 1 }, (_, k) => [(k * T) / n, stepClosed(d, (k * T) / n)]);
}

/** RK4 (durum: konum, hız), kapalı formdan bağımsız. */
export function sampleRk4(d: Door, n = 4000): [number, number][] {
  const T = horizon(d);
  const h = T / n;
  let x = 0;
  let v = 0;
  const out: [number, number][] = [[0, 0]];
  // İkinci mertebe → (x, v) birinci mertebe sistemi; klasik RK4 iki bileşenli
  for (let k = 0; k < n; k++) {
    const f = (xx: number, vv: number): [number, number] => [vv, (d.k * (1 - xx) - d.c * vv) / d.m];
    const [k1x, k1v] = f(x, v);
    const [k2x, k2v] = f(x + (h / 2) * k1x, v + (h / 2) * k1v);
    const [k3x, k3v] = f(x + (h / 2) * k2x, v + (h / 2) * k2v);
    const [k4x, k4v] = f(x + h * k3x, v + h * k3v);
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    out.push([(k + 1) * h, x]);
  }
  return out;
}

export const metricsClosed = (d: Door) => metricsOf(sampleClosed(d));
export const metricsRk4 = (d: Door) => metricsOf(sampleRk4(d));
