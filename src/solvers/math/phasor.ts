// Karmaşık sayılar / fazör: sonar iki hidrofonun sinyalini toplar. v₁ = A₁·cos(ωt + φ₁), v₂ = A₂·cos(ωt + φ₂)
// aynı frekansta; toplam v = A·cos(ωt + φ). A ve φ fazörlerin karmaşık toplamından: A∠φ = A₁∠φ₁ + A₂∠φ₂.
// Bağımsız yol: toplam sinyal bir periyot boyunca örneklenir; tepe değeri A, tepe anı t* → φ = −ω·t*.

export interface PhasorConfig {
  /** Genlik seçenekleri (mV). */
  amp: number[];
  /** Faz seçenekleri (derece). */
  phase: number[];
  /** Genlik için göreli, faz için mutlak (derece) tolerans. */
  ampTol: number;
  phaseTol: number;
}

export function parsePhasorConfig(raw: unknown): PhasorConfig {
  const c = raw as PhasorConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('phasor yapılandırması nesne olmalı');
  need(Array.isArray(c.amp) && c.amp.length > 1 && c.amp.every((x) => x > 0), 'amp pozitif liste olmalı');
  need(Array.isArray(c.phase) && c.phase.length > 1 && c.phase.every((x) => x > -180 && x <= 180), 'phase (−180, 180] listesi olmalı');
  need(c.ampTol > 0 && c.ampTol <= 0.1 && c.phaseTol > 0 && c.phaseTol <= 10, 'ampTol 0–0,1, phaseTol 0–10° olmalı');
  if (errors.length) throw new Error(`phasor yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export interface Wave {
  a: number;
  /** Derece. */
  phi: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
/** Açıyı (−180, 180] aralığına indirger. */
export const wrapDeg = (d: number) => {
  let x = ((d % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x;
};

/** Karmaşık toplam. */
export function sumPhasor(w1: Wave, w2: Wave): Wave {
  const re = w1.a * Math.cos(rad(w1.phi)) + w2.a * Math.cos(rad(w2.phi));
  const im = w1.a * Math.sin(rad(w1.phi)) + w2.a * Math.sin(rad(w2.phi));
  return { a: Math.hypot(re, im), phi: wrapDeg((Math.atan2(im, re) * 180) / Math.PI) };
}

/** Örnekleme ile (ω = 1, bir periyot, n örnek): tepe genliği ve tepe anından faz. */
export function sumBySampling(w1: Wave, w2: Wave, n = 72000): Wave {
  let best = -Infinity;
  let tBest = 0;
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    const v = w1.a * Math.cos(t + rad(w1.phi)) + w2.a * Math.cos(t + rad(w2.phi));
    if (v > best) {
      best = v;
      tBest = t;
    }
  }
  return { a: best, phi: wrapDeg((-tBest * 180) / Math.PI) };
}

/** İki açının farkı (derece, en kısa yol). */
export const angleDiff = (a: number, b: number) => Math.abs(wrapDeg(a - b));
