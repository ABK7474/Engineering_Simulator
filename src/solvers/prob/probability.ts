// Olasılık ve istatistik: üç varyant.
//  bayes    — iki bağımsız sensör; gözlenen alarm durumundan gerçek kaçak olasılığı (kesin kesir).
//  binomial — her pompa q olasılıkla çalışır; en az m pompa gerekir; P(X ≥ m) ≥ R için en az kaç pompa (kesin).
//  poisson  — görevde arıza sayısı Poisson(λ); P(N ≤ s) ≥ R için en az kaç yedek (seri toplamı + gama integrali).
// Her varyant tohumlu Monte Carlo benzetimiyle ayrıca teyit edilir.

import { createRng, type Rng } from '../../core/rng';
import { choose, Frac } from './fraction';

export type ProbVariant = 'bayes' | 'binomial' | 'poisson';

export interface ProbConfig {
  variants: ProbVariant[];
  bayes: { prior: number[]; sens: number[]; falseAlarm: number[]; observations: ('both' | 'firstOnly')[] };
  binomial: { q: number[]; need: number[]; reliability: number[] };
  poisson: { lambda: number[]; reliability: number[] };
}

export function parseProbConfig(raw: unknown): ProbConfig {
  const c = raw as ProbConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('probability yapılandırması nesne olmalı');
  need(Array.isArray(c.variants) && c.variants.length > 0 && c.variants.every((v) => ['bayes', 'binomial', 'poisson'].includes(v)), 'variants bayes/binomial/poisson olmalı');
  const pct = (a: unknown) => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'number' && x > 0 && x < 100);
  need(pct(c.bayes?.prior) && pct(c.bayes?.sens) && pct(c.bayes?.falseAlarm), 'bayes: prior/sens/falseAlarm yüzde listeleri olmalı');
  need(Array.isArray(c.bayes?.observations) && c.bayes.observations.length > 0, 'bayes.observations boş olamaz');
  need(pct(c.binomial?.q) && pct(c.binomial?.reliability) && Array.isArray(c.binomial?.need) && c.binomial.need.every((x) => Number.isInteger(x) && x >= 1), 'binomial: q, need, reliability olmalı');
  need(Array.isArray(c.poisson?.lambda) && c.poisson.lambda.every((x) => x > 0) && pct(c.poisson?.reliability), 'poisson: lambda, reliability olmalı');
  if (errors.length) throw new Error(`probability yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

// ---------------------------------------------------------------- Bayes

export interface BayesInput {
  /** Yüzdeler. */
  prior: number;
  sens1: number;
  fa1: number;
  sens2: number;
  fa2: number;
  /** both: ikisi de alarm; firstOnly: birinci alarm, ikinci sessiz. */
  obs: 'both' | 'firstOnly';
}

/** P(kaçak | gözlem), kesin. */
export function bayesExact(b: BayesInput): Frac {
  const pi = Frac.pct(b.prior);
  const s1 = Frac.pct(b.sens1);
  const f1 = Frac.pct(b.fa1);
  const s2 = Frac.pct(b.sens2);
  const f2 = Frac.pct(b.fa2);
  const l2 = b.obs === 'both' ? s2 : Frac.ONE.sub(s2);
  const g2 = b.obs === 'both' ? f2 : Frac.ONE.sub(f2);
  const num = pi.mul(s1).mul(l2);
  const den = num.add(Frac.ONE.sub(pi).mul(f1).mul(g2));
  return num.div(den);
}

export function bayesMonteCarlo(b: BayesInput, trials: number, rng: Rng): { estimate: number; events: number } {
  let events = 0;
  let leaks = 0;
  for (let k = 0; k < trials; k++) {
    const leak = rng() < b.prior / 100;
    const a1 = rng() < (leak ? b.sens1 : b.fa1) / 100;
    const a2 = rng() < (leak ? b.sens2 : b.fa2) / 100;
    const match = b.obs === 'both' ? a1 && a2 : a1 && !a2;
    if (match) {
      events++;
      if (leak) leaks++;
    }
  }
  return { estimate: events ? leaks / events : NaN, events };
}

// ---------------------------------------------------------------- binom

/** P(X ≥ m), X ~ Binom(n, q), q yüzde; kesin. */
export function atLeast(n: number, m: number, qPct: number): Frac {
  const q = Frac.pct(qPct);
  const r = Frac.ONE.sub(q);
  let sum = Frac.ZERO;
  for (let k = m; k <= n; k++) sum = sum.add(new Frac(choose(n, k)).mul(q.pow(k)).mul(r.pow(n - k)));
  return sum;
}

export function atLeastMonteCarlo(n: number, m: number, qPct: number, trials: number, rng: Rng): number {
  let ok = 0;
  for (let t = 0; t < trials; t++) {
    let up = 0;
    for (let i = 0; i < n; i++) if (rng() < qPct / 100) up++;
    if (up >= m) ok++;
  }
  return ok / trials;
}

// ---------------------------------------------------------------- Poisson

/** P(N ≤ s), N ~ Poisson(λ): olasılık kütle toplamı. */
export function poissonCdfSeries(s: number, lambda: number): number {
  let term = Math.exp(-lambda);
  let sum = term;
  for (let k = 1; k <= s; k++) {
    term *= lambda / k;
    sum += term;
  }
  return sum;
}

/** Bağımsız yol: P(N ≤ s) = 1 − (1/s!)·∫₀^λ t^s e^(−t) dt (Simpson, 4000 aralık). */
export function poissonCdfGamma(s: number, lambda: number): number {
  const n = 4000;
  const h = lambda / n;
  let fact = 1;
  for (let k = 2; k <= s; k++) fact *= k;
  const f = (t: number) => (t ** s * Math.exp(-t)) / fact;
  let sum = f(0) + f(lambda);
  for (let k = 1; k < n; k++) sum += (k % 2 ? 4 : 2) * f(k * h);
  return 1 - (h / 3) * sum;
}

export function poissonMonteCarlo(s: number, lambda: number, trials: number, rng: Rng): number {
  let ok = 0;
  const L = Math.exp(-lambda);
  for (let t = 0; t < trials; t++) {
    // Knuth yöntemi
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    if (k - 1 <= s) ok++;
  }
  return ok / trials;
}

export const mcRng = (seed: number) => createRng(seed * 7919 + 17);
