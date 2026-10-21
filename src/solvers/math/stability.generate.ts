// Kararlılık üretici + doğrulayıcı. Aday kazançlar geometrik dizi; cevap, köklerin karmaşık olmaya başladığı
// sınıra en yakın aday. σ_min şartı bir küçüğünü (yavaş), ζ_min şartı bir büyüğünü (salınımlı) eler; daha
// küçükler daha yavaş (ya da kararsız), daha büyükler daha salınımlı. Kapalı form ile benzetim uyuşmalı.

import { createRng, pick } from '../../core/rng';
import { shown } from '../circuit/design-core';
import { decayRateBySimulation, eigen, type Plant, type StabilityConfig } from './stability';

export const MAX_ATTEMPTS = 200;
/** Şart sınırından en az bu oranda uzaklık (sınırda belirsizlik yok). */
export const MARGIN = 0.04;

export interface GainCard {
  id: string;
  k: number;
  label: string;
  sub: string;
  mistake?: string;
}

export interface StabilityProblem {
  seed: number;
  plant: Plant;
  /** Gösterilen şartlar. */
  sigmaMin: number;
  zetaMin: number;
  answer: number;
  /** Kazanç sırasıyla. */
  bin: GainCard[];
}

export const fmtK = (k: number) => String(Number(k.toPrecision(3))).replace('.', ',');

export function meetsSpec(p: StabilityProblem, k: number) {
  const e = eigen(p.plant, k);
  return { stable: e.maxRe < 0, fast: -e.maxRe >= p.sigmaMin, damped: e.zeta >= p.zetaMin, e };
}

export function verifyStability(p: StabilityProblem): string[] {
  const errors: string[] = [];
  let ok = 0;
  for (const b of p.bin) {
    const m = meetsSpec(p, b.k);
    const sim = decayRateBySimulation(p.plant, b.k);
    if (Math.abs(sim - m.e.maxRe) > 0.05 * Math.abs(m.e.maxRe) + 0.03) errors.push(`k = ${b.k}: benzetimden ölçülen sönüm hızı (${sim.toFixed(3)}) özdeğerle (${m.e.maxRe.toFixed(3)}) uyuşmuyor`);
    const good = m.stable && m.fast && m.damped;
    if (good) ok++;
    if (b.k === p.answer && !good) errors.push('cevap şartları sağlamıyor');
    // Sınıra yakınlık: her aday her iki şartta da sınırdan açıkça ayrı
    const s = -m.e.maxRe;
    if (Math.abs(s / p.sigmaMin - 1) < MARGIN) errors.push(`k = ${b.k}: σ sınıra çok yakın`);
    if (Math.abs(m.e.zeta / p.zetaMin - 1) < MARGIN && m.e.zeta < 1) errors.push(`k = ${b.k}: ζ sınıra çok yakın`);
  }
  if (ok !== 1) errors.push(`şartları sağlayan ${ok} aday (1 olmalı)`);
  return [...new Set(errors)];
}

export function generateStability(c: StabilityConfig, seed: number): StabilityProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (w: string) => reasons.set(w, (reasons.get(w) ?? 0) + 1);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plant: Plant = { a: pick(rng, c.a), b: pick(rng, c.b), c: pick(rng, c.c) };
    if (!(plant.c > plant.a * 1.5)) {
      reject('c ≤ a: kapalı çevrim karmaşık köklerde de kararsız');
      continue;
    }
    const base = pick(rng, c.gains.base);
    const ks = Array.from({ length: c.gains.count }, (_, j) => Number((base * c.gains.ratio ** j).toPrecision(3)));
    const ev = ks.map((k) => eigen(plant, k));
    // Cevap: karmaşık köklere geçmeden önceki son aday (bir büyüğü karmaşık)
    const j = ev.findIndex((e, i) => e.zeta >= 0.999 && i + 1 < ev.length && ev[i + 1].zeta < 0.999);
    if (j < 1) {
      reject('kritik sönüm sınırı adayların içinde değil');
      continue;
    }
    const sigma = ev.map((e) => -e.maxRe);
    const sigmaMin = shown(Math.sqrt(Math.max(sigma[j - 1], 1e-3) * sigma[j]));
    const zetaMin = shown((ev[j].zeta + ev[j + 1].zeta) / 2);
    const labels: Record<number, string> = {};
    ev.forEach((e, i) => {
      if (e.maxRe >= 0) labels[i] = 'det(A) ≤ 0: bir özdeğer sıfır ya da pozitif; basınç sapması sönmez, büyür.';
      else if (i < j) labels[i] = 'Yalnız kararlılığa (det > 0) bakılmış; en yavaş özdeğer sıfıra yakın, basınç çok yavaş toparlanır.';
      else if (i > j) labels[i] = 'Kazanç büyüdükçe sistem hızlanır sanılmış; kökler karmaşık oldu, reel kısım (a − c)/2 sabit kaldı ama salınım arttı (ζ düştü).';
    });
    const p: StabilityProblem = {
      seed,
      plant,
      sigmaMin,
      zetaMin,
      answer: ks[j],
      bin: ks.map((k, i) => ({ id: `g${i}`, k, label: `k = ${fmtK(k)}`, sub: 'kazanç', ...(labels[i] ? { mistake: labels[i] } : {}) })),
    };
    const errors = verifyStability(p);
    if (!errors.length) return p;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Kararlılık problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
