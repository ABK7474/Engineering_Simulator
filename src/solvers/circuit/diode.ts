// Diyotlu seri devre (ters, çok adımlı): Shockley modeli I = Iₛ·(e^(V/(n·V_T)) − 1). Katalogda iki çalışma
// noktası (I₁, V₁), (I₂, V₂) verilir; oyuncu eğimi n·V_T = (V₁ − V₂) / ln(I₁/I₂), hedef akımdaki diyot
// gerilimini V_D = V₁ + n·V_T·ln(I*/I₁) ve seri direnci R = (Vs − V_D) / I* bulur, kutudan seçer.
// Devrenin çalışma noktası iki bağımsız yoldan çözülür: Newton (diyot gerilimi üzerinde) ve ikiye bölme
// (akım üzerinde); uyuşmazlarsa problem reddedilir.

export const VT = 0.025852; // 300 K'de ısıl gerilim (V)

export interface DiodeModel {
  label: string;
  /** İdealite katsayısı. */
  n: number;
  /** Doyma akımı (A). */
  is: number;
}

export interface DiodeConfig {
  vs: number[];
  diodes: DiodeModel[];
  /** Katalog noktalarının akımları (A), [I₁, I₂]. */
  datasheet: [number, number];
  /** Cevap direncinin E12 aralığı. */
  answer: [number, number];
  /** Kabul: hedef akımın ± oranı. */
  tolerance: number;
  /** Diyodun mutlak en büyük akımı (A); aşılırsa yanar. */
  absMax: number;
  binSize: number;
}

export function parseDiodeConfig(raw: unknown): DiodeConfig {
  const c = raw as DiodeConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('diode yapılandırması nesne olmalı');
  need(Array.isArray(c.vs) && c.vs.every((v) => v > 0), 'vs pozitif sayı listesi olmalı');
  need(Array.isArray(c.diodes) && c.diodes.length > 0 && c.diodes.every((d) => d.n >= 1 && d.n <= 6 && d.is > 0 && d.is < 1e-6 && typeof d.label === 'string'), 'diodes: {label, n 1–6 (etkin idealite), is > 0} listesi olmalı');
  need(Array.isArray(c.datasheet) && c.datasheet[0] > c.datasheet[1] && c.datasheet[1] > 0, 'datasheet [I₁ > I₂ > 0] olmalı');
  need(Array.isArray(c.answer) && c.answer[0] > 0 && c.answer[0] < c.answer[1], 'answer [min, max] olmalı');
  need(c.tolerance > 0 && c.tolerance <= 0.08, 'tolerance 0–0,08 olmalı (bitişik E12 ~%18 uzakta)');
  need(c.absMax > 0, 'absMax pozitif olmalı');
  need(Number.isInteger(c.binSize) && c.binSize >= 3 && c.binSize <= 7, 'binSize 3–7 olmalı');
  if (errors.length) throw new Error(`diode yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

/** Diyot gerilimi verilen akımda (Shockley tersi). */
export const diodeVoltage = (d: DiodeModel, i: number) => d.n * VT * Math.log(i / d.is + 1);
/** Diyot akımı verilen gerilimde. */
export const diodeCurrent = (d: DiodeModel, v: number) => d.is * Math.expm1(v / (d.n * VT));

/** Newton: f(V) = (Vs − V)/R − I(V) = 0, diyot gerilimi üzerinde; başlangıç 0,6·Vs'nin altında. */
export function solveNewton(d: DiodeModel, vs: number, r: number): { v: number; i: number; iterations: number } {
  let v = Math.min(vs, d.n * VT * Math.log(vs / r / d.is + 1));
  for (let k = 0; k < 100; k++) {
    const f = (vs - v) / r - diodeCurrent(d, v);
    const df = -1 / r - (d.is / (d.n * VT)) * Math.exp(v / (d.n * VT));
    let step = f / df;
    if (!Number.isFinite(step)) break;
    // Üstel terim taşmasın: adımı sınırla
    step = Math.max(-0.1, Math.min(0.1, step));
    v -= step;
    if (Math.abs(step) < 1e-13) return { v, i: (vs - v) / r, iterations: k + 1 };
  }
  return { v, i: (vs - v) / r, iterations: 100 };
}

/** İkiye bölme: g(I) = Vs − I·R − V_D(I) = 0, akım üzerinde (Newton'dan bağımsız). */
export function solveBisection(d: DiodeModel, vs: number, r: number): number {
  let lo = 0;
  let hi = vs / r;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (vs - mid * r - diodeVoltage(d, mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
