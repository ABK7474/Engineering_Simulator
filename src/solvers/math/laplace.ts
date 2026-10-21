// Laplace son değer ve başlangıç değeri teoremleri: hava kilidi dolum pompası, basınç yanıtı
// G(s) = K·(s + z) / ((s + p₁)(s + p₂)), basamak komutu U. Oyuncu iki şey bulur:
//   y(∞)  = lim_{s→0} s·Y(s) = U·G(0) = U·K·z / (p₁·p₂)          (son değer teoremi)
//   y′(0⁺) = lim_{s→∞} s·[s·Y(s) − y(0⁺)] = lim s·U·G(s) = U·K   (başlangıç değeri teoremi; y(0⁺) = 0)
// Bağımsız yol: denetlenebilir kanonik durum uzayı gerçeklemesinin RK4 benzetimi.

export interface LaplaceConfig {
  K: number[];
  z: number[];
  p1: number[];
  p2: number[];
  U: number[];
  /** Göreli kabul toleransı (her iki cevap için). */
  tolerance: number;
}

export function parseLaplaceConfig(raw: unknown): LaplaceConfig {
  const c = raw as LaplaceConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('laplace yapılandırması nesne olmalı');
  for (const k of ['K', 'z', 'p1', 'p2', 'U'] as const) need(Array.isArray(c[k]) && c[k].length > 0 && c[k].every((x) => x > 0), `${k} pozitif liste olmalı`);
  need(c.tolerance > 0 && c.tolerance <= 0.1, 'tolerance 0–0,1 olmalı');
  if (errors.length) throw new Error(`laplace yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export interface Tf {
  K: number;
  z: number;
  p1: number;
  p2: number;
}

export const finalValue = (g: Tf, u: number) => (u * g.K * g.z) / (g.p1 * g.p2);
export const initialSlope = (g: Tf, u: number) => u * g.K;

/** Durum uzayı: ẋ₁ = x₂, ẋ₂ = −a₀x₁ − a₁x₂ + u, y = b₀x₁ + b₁x₂ (a₁ = p₁ + p₂, a₀ = p₁p₂, b₁ = K, b₀ = K·z). */
export function simulateStep(g: Tf, u: number, tEnd: number, steps: number): [number, number][] {
  const a1 = g.p1 + g.p2;
  const a0 = g.p1 * g.p2;
  const b1 = g.K;
  const b0 = g.K * g.z;
  const h = tEnd / steps;
  const f = (x1: number, x2: number): [number, number] => [x2, -a0 * x1 - a1 * x2 + u];
  let x1 = 0;
  let x2 = 0;
  const out: [number, number][] = [[0, 0]];
  for (let k = 0; k < steps; k++) {
    const [k1a, k1b] = f(x1, x2);
    const [k2a, k2b] = f(x1 + (h / 2) * k1a, x2 + (h / 2) * k1b);
    const [k3a, k3b] = f(x1 + (h / 2) * k2a, x2 + (h / 2) * k2b);
    const [k4a, k4b] = f(x1 + h * k3a, x2 + h * k3b);
    x1 += (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    x2 += (h / 6) * (k1b + 2 * k2b + 2 * k3b + k4b);
    out.push([(k + 1) * h, b0 * x1 + b1 * x2]);
  }
  return out;
}

/** Benzetimden: son değer (ufukta) ve başlangıç eğimi (ilk adımın farkı). */
export function measuredBySimulation(g: Tf, u: number): { final: number; slope: number } {
  const slow = Math.min(g.p1, g.p2);
  const tEnd = 25 / slow;
  const pts = simulateStep(g, u, tEnd, 20000);
  const fine = simulateStep(g, u, 1e-4 / Math.max(g.p1, g.p2, g.z), 10);
  return { final: pts[pts.length - 1][1], slope: fine[1][1] / fine[1][0] };
}
