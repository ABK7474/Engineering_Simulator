// Sayısal ODE: klasik dördüncü mertebe Runge–Kutta ve eşik geçiş anı. Birinci mertebe devrelerin kapalı
// formlarıyla bağımsız çapraz kontrol için kullanılır (bkz. rc-rl.ts).

export type Deriv = (t: number, y: number) => number;

export function rk4Step(f: Deriv, t: number, y: number, h: number): number {
  const k1 = f(t, y);
  const k2 = f(t + h / 2, y + (h / 2) * k1);
  const k3 = f(t + h / 2, y + (h / 2) * k2);
  const k4 = f(t + h, y + h * k3);
  return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

/** y(t)'nin örnekleri (grafik için). */
export function rk4Series(f: Deriv, y0: number, tEnd: number, steps: number): [number, number][] {
  const h = tEnd / steps;
  const out: [number, number][] = [[0, y0]];
  let y = y0;
  for (let k = 0; k < steps; k++) {
    y = rk4Step(f, k * h, y, h);
    out.push([(k + 1) * h, y]);
  }
  return out;
}

/**
 * Artan y'nin `threshold`'u ilk geçtiği an; iki adım arasında doğrusal ara değer. `tMax`'a kadar geçmezse null.
 * Adım `h`; RK4'ün yerel hatası O(h⁵), ara değer hatası O(h²) (h = τ/2000 için ~1e-8 göreli).
 */
export function firstCrossing(f: Deriv, y0: number, threshold: number, h: number, tMax: number): number | null {
  if (y0 >= threshold) return 0;
  let t = 0;
  let y = y0;
  while (t < tMax) {
    const next = rk4Step(f, t, y, h);
    if (next >= threshold) return t + (h * (threshold - y)) / (next - y);
    y = next;
    t += h;
  }
  return null;
}
