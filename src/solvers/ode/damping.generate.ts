// Sönüm üretici + doğrulayıcı. Amortisör (cevap) önce E12'den seçilir; ζ penceresi içinde kalacak bir ω_n
// seçilip serbest periyot T₀ türetilir ve 3 basamakla gösterilir. Kutuda pencereye düşen tek değer cevaptır;
// gösterilen T₀ ile elle hesap da cevabı pencerede bulur; kapalı form ve RK4 aşma/oturma süresinde uyuşur.

import { createRng, pick, shuffle } from '../../core/rng';
import { nearestE12, shown } from '../circuit/design-core';
import { e12Values } from '../circuit/e-series';
import { metricsClosed, metricsRk4, zetaOf, type DampingConfig, type Door } from './damping';

export const MAX_ATTEMPTS = 200;
/** Pencere dışındaki adaylar pencereden en az bu oranda uzak. */
export const OUTSIDE_MARGIN = 0.03;

export interface DamperCard {
  id: string;
  c: number;
  label: string;
  sub: string;
  mistake?: string;
}

export interface DampingProblem {
  seed: number;
  m: number;
  /** Gerçek yay sabiti (gösterilmez; T₀'dan bulunur). */
  k: number;
  /** Gösterilen serbest periyot (s). */
  t0: number;
  zeta: [number, number];
  answer: number;
  bin: DamperCard[];
  /** Gösterilen sayılarla elle: ω_n, k, ζ = 1 için c. */
  hand: { wn: number; k: number; cCrit: number; cLo: number; cHi: number };
}

export const fmtDamper = (c: number) => `${String(Number(c.toPrecision(3))).replace('.', ',')} N·s/m`;
export const door = (p: Pick<DampingProblem, 'm' | 'k'>, c: number): Door => ({ m: p.m, k: p.k, c });

export function handSolve(m: number, t0: number, zeta: [number, number]): DampingProblem['hand'] {
  const wn = (2 * Math.PI) / t0;
  const k = m * wn * wn;
  const cCrit = 2 * m * wn;
  return { wn, k, cCrit, cLo: zeta[0] * cCrit, cHi: zeta[1] * cCrit };
}

export function verifyDamping(c: DampingConfig, p: DampingProblem): string[] {
  const errors: string[] = [];
  const cs = p.bin.map((b) => b.c);
  if (new Set(cs).size !== cs.length) errors.push('kutuda aynı değer iki kez');
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  if (!cs.includes(p.answer)) errors.push('cevap kutuda yok');
  if (p.t0 < c.period[0] || p.t0 > c.period[1]) errors.push('periyot aralık dışında');
  let inside = 0;
  for (const cc of cs) {
    const d = door(p, cc);
    const z = zetaOf(d);
    const a = metricsClosed(d);
    const b = metricsRk4(d);
    if (Math.abs(a.overshoot - b.overshoot) > 1e-4 || Math.abs(a.settling - b.settling) > a.settling * 0.002 + 1e-6) errors.push(`${cc}: kapalı form ile RK4 uyuşmuyor`);
    const ok = z >= p.zeta[0] && z <= p.zeta[1];
    if (ok) inside++;
    if (cc === p.answer && !ok) errors.push('cevap pencerede değil');
    if (cc !== p.answer && z > p.zeta[0] * (1 - OUTSIDE_MARGIN) && z < p.zeta[1] * (1 + OUTSIDE_MARGIN)) errors.push(`${cc} pencereye çok yakın`);
  }
  if (inside !== 1) errors.push(`pencerede ${inside} aday (1 olmalı)`);
  const h = p.hand;
  if (!(p.answer >= h.cLo && p.answer <= h.cHi)) errors.push('gösterilen T₀ ile elle aralık cevabı içermiyor');
  for (const b of p.bin) if (b.c !== p.answer && b.c >= h.cLo * (1 - OUTSIDE_MARGIN) && b.c <= h.cHi * (1 + OUTSIDE_MARGIN)) errors.push('elle aralıkta ikinci aday');
  if (p.bin.filter((b) => b.mistake).length < 2) errors.push('en az iki klasik hata kutuda olmalı');
  return [...new Set(errors)];
}

export function generateDamping(c: DampingConfig, seed: number): DampingProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (w: string) => reasons.set(w, (reasons.get(w) ?? 0) + 1);
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    const m = pick(rng, c.mass);
    const answer = pick(rng, e12Values(c.answer[0], c.answer[1]));
    // Cevabın ζ'si pencere içinde, kenarlardan %2 içeride
    const zLo = c.zeta[0] * 1.02;
    const zHi = c.zeta[1] / 1.02;
    const zAns = zLo + rng() * (zHi - zLo);
    const wn = answer / (2 * m * zAns);
    const t0 = shown((2 * Math.PI) / wn);
    const k = m * wn * wn;
    const hand = handSolve(m, t0, c.zeta);
    const cards: Omit<DamperCard, 'id'>[] = [];
    const add = (v: number, mistake?: string) => {
      if (!(v > 0) || !Number.isFinite(v)) return;
      const e = nearestE12(v);
      if (cards.length < c.binSize && !cards.some((x) => x.c === e)) cards.push({ c: e, label: fmtDamper(e), sub: 'amortisör', mistake });
    };
    add(answer);
    add((2 * m) / t0, 'ω_n yerine 1/T₀ kullanılmış (2π unutulmuş): c = 2m/T₀ çok küçük çıkar, kapı salınır.');
    add(m * hand.wn, 'Kritik sönümde c = 2·√(m·k) = 2·m·ω_n; 2 çarpanı unutulmuş.');
    add(2 * Math.sqrt(hand.k), 'Kütle unutulmuş: c = 2·√k alınmış (doğrusu 2·√(m·k)).');
    for (const v of shuffle(rng, e12Values(answer / 5, answer * 5))) add(v);
    if (cards.length < c.binSize) {
      reject('kutu doldurulamadı');
      continue;
    }
    const p: DampingProblem = { seed, m, k, t0, zeta: c.zeta, answer, bin: shuffle(rng, cards).map((x, j) => ({ ...x, id: `b${j}` })), hand };
    const errors = verifyDamping(c, p);
    if (!errors.length) return p;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Sönüm problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
