// Diyot üretici + doğrulayıcı. Cevap R önce E12'den seçilir; hedef akım o dirençle (Newton) hesaplanıp
// gösterilir. Kutu: cevap + klasik hataların E12 karşılıkları (sabit 0,7 V, diyot düşümünü unutmak, log₁₀) +
// rastgele; pencerede (±tolerans) yalnız cevap, bitişik E12 dışarıda. Newton ile ikiye bölme uyuşmalı.

import { formatOhm } from '../../core/format';
import { createRng, pick, shuffle } from '../../core/rng';
import { nearestE12, shown } from './design-core';
import { diodeVoltage, solveBisection, solveNewton, type DiodeConfig, type DiodeModel } from './diode';
import { e12Values } from './e-series';

export const MAX_ATTEMPTS = 200;
/** Pencere dışındaki adaylar pencere kenarından en az bu oranda uzak. */
export const OUTSIDE_MARGIN = 0.03;

export interface DiodeCard {
  id: string;
  r: number;
  label: string;
  mistake?: string;
}

export interface DiodeProblem {
  seed: number;
  diode: DiodeModel;
  vs: number;
  /** Katalog noktaları (gösterilen, 3 basamak gerilim). */
  points: [{ i: number; v: number }, { i: number; v: number }];
  /** Hedef akım (gösterilen). */
  target: number;
  tolerance: number;
  absMax: number;
  answer: number;
  bin: DiodeCard[];
  /** Oyuncunun sayılarıyla elle çözüm. */
  hand: { slope: number; vd: number; r: number };
}

export const operatingCurrent = (p: Pick<DiodeProblem, 'diode' | 'vs'>, r: number) => solveNewton(p.diode, p.vs, r).i;

/** Gösterilen katalog noktalarıyla elle çözüm. */
export function handSolve(points: DiodeProblem['points'], vs: number, target: number): DiodeProblem['hand'] {
  const slope = (points[0].v - points[1].v) / Math.log(points[0].i / points[1].i);
  const vd = points[0].v + slope * Math.log(target / points[0].i);
  return { slope, vd, r: (vs - vd) / target };
}

export function verifyDiode(c: DiodeConfig, p: DiodeProblem): string[] {
  const errors: string[] = [];
  const rs = p.bin.map((b) => b.r);
  if (new Set(rs).size !== rs.length) errors.push('kutuda aynı değer iki kez');
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  if (!rs.includes(p.answer)) errors.push('cevap kutuda yok');
  const lo = p.target * (1 - p.tolerance);
  const hi = p.target * (1 + p.tolerance);
  let inside = 0;
  for (const r of rs) {
    const nw = solveNewton(p.diode, p.vs, r);
    const bi = solveBisection(p.diode, p.vs, r);
    if (Math.abs(nw.i / bi - 1) > 1e-9) errors.push(`${r} Ω: Newton ile ikiye bölme uyuşmuyor`);
    if (nw.iterations >= 100) errors.push(`${r} Ω: Newton yakınsamadı`);
    if (nw.i >= lo && nw.i <= hi) inside++;
    if (r === p.answer && !(nw.i >= lo && nw.i <= hi)) errors.push('cevap pencerede değil');
    if (r !== p.answer && nw.i > lo * (1 - OUTSIDE_MARGIN) && nw.i < hi * (1 + OUTSIDE_MARGIN)) errors.push(`${r} Ω pencereye çok yakın`);
  }
  if (inside !== 1) errors.push(`pencerede ${inside} aday (1 olmalı)`);
  const all = e12Values();
  const k = all.indexOf(p.answer);
  for (const nb of [all[k - 1], all[k + 1]]) if (nb !== undefined) {
    const i = operatingCurrent(p, nb);
    if (i >= lo && i <= hi) errors.push(`bitişik E12 (${nb} Ω) pencereye düşüyor`);
  }
  // Elle çözüm (gösterilen sayılarla, +1'i ihmal eden log yaklaşımı) cevaba varmalı
  if (nearestE12(p.hand.r) !== p.answer) errors.push(`elle çözüm ${p.hand.r.toFixed(1)} Ω, en yakın E12 cevap değil`);
  if (p.target > c.absMax * 0.7) errors.push('hedef akım mutlak sınıra çok yakın');
  if (p.bin.filter((b) => b.mistake).length < 2) errors.push('en az iki klasik hata kutuda olmalı');
  return [...new Set(errors)];
}

export function generateDiode(c: DiodeConfig, seed: number): DiodeProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (w: string) => reasons.set(w, (reasons.get(w) ?? 0) + 1);
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const diode = pick(rng, c.diodes);
    const vs = pick(rng, c.vs);
    const answer = pick(rng, e12Values(c.answer[0], c.answer[1]));
    const exact = solveNewton(diode, vs, answer).i;
    if (!(exact > 0) || !Number.isFinite(exact)) {
      reject('çalışma noktası yok');
      continue;
    }
    const target = shown(exact);
    const points: DiodeProblem['points'] = [
      { i: c.datasheet[0], v: shown(diodeVoltage(diode, c.datasheet[0])) },
      { i: c.datasheet[1], v: shown(diodeVoltage(diode, c.datasheet[1])) },
    ];
    const hand = handSolve(points, vs, target);
    const cards: Omit<DiodeCard, 'id'>[] = [{ r: answer, label: formatOhm(answer) }];
    const add = (r: number, mistake?: string) => {
      if (!(r > 0) || !Number.isFinite(r)) return;
      const e = nearestE12(r);
      if (cards.length < c.binSize && !cards.some((x) => x.r === e)) cards.push({ r: e, label: formatOhm(e), mistake });
    };
    add((vs - 0.7) / target, 'Diyot gerilimi her akımda 0,7 V sanılmış; bu diyotta düşüm katalogdan (Shockley) hesaplanmalı.');
    add(vs / target, 'Diyodun gerilim düşümü unutulmuş: R = Vs / I alınmış.');
    const slope10 = (points[0].v - points[1].v) / Math.log10(points[0].i / points[1].i);
    add((vs - (points[0].v + slope10 * Math.log(target / points[0].i))) / target, 'Eğim hesabında doğal logaritma yerine log₁₀ kullanılmış (n·V_T 2,3 kat büyük çıkar).');
    for (const r of shuffle(rng, e12Values(answer / 5, answer * 5))) add(r);
    if (cards.length < c.binSize) {
      reject('kutu doldurulamadı');
      continue;
    }
    const p: DiodeProblem = { seed, diode, vs, points, target, tolerance: c.tolerance, absMax: c.absMax, answer, bin: shuffle(rng, cards).map((x, j) => ({ ...x, id: `b${j}` })), hand };
    const errors = verifyDiode(c, p);
    if (!errors.length) return p;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Diyot problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}

/** Rapor için biçimli eğim (mV). */
export const fmtSlope = (s: number) => `${(s * 1000).toFixed(1).replace('.', ',')} mV`;
