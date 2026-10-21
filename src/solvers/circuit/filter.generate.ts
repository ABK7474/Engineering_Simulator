// Filtre üretici + doğrulayıcı. Cevap R önce E12'den seçilir; kesim penceresi onun çevresinde açılır, dB şartları
// pencere kenarlarından türetilip 3 basamağa yuvarlanır. Gösterilen şartlarla elle bulunan aralıkta kutudan
// yalnız cevap kalmalı; kapalı form ile karmaşık empedans aynı kazancı vermeli.

import { formatOhm } from '../../core/format';
import { createRng, pick, shuffle } from '../../core/rng';
import { nearestE12, shown } from './design-core';
import { e12Values } from './e-series';
import { cutoff, cutoffBounds, gainClosed, gainComplex, resistorFor, toDb, type FilterConfig, type FilterParts } from './filter';

export const MAX_ATTEMPTS = 200;
/** Pencere dışındaki adaylar pencere kenarından en az bu oranda uzak. */
export const OUTSIDE_MARGIN = 0.03;

export interface FilterCard {
  id: string;
  r: number;
  label: string;
  mistake?: string;
}

export interface FilterProblem {
  seed: number;
  parts: FilterParts;
  fs: number;
  fn: number;
  /** Gösterilen şartlar (dB, negatif; 3 basamak). */
  gsDb: number;
  gnDb: number;
  answer: number;
  bin: FilterCard[];
  /** Gösterilen şartlarla elle bulunan kesim ve direnç aralığı. */
  hand: { fcLo: number; fcHi: number; rLo: number; rHi: number };
}

/** Seçilen R ile şartlar sağlanıyor mu (kapalı form). */
export function meets(p: FilterProblem, r: number): { signal: boolean; noise: boolean; gs: number; gn: number } {
  const fc = cutoff(p.parts, r);
  const gs = toDb(gainClosed(fc, p.fs));
  const gn = toDb(gainClosed(fc, p.fn));
  return { signal: gs >= p.gsDb, noise: gn <= p.gnDb, gs, gn };
}

export function verifyFilter(c: FilterConfig, p: FilterProblem): string[] {
  const errors: string[] = [];
  const rs = p.bin.map((b) => b.r);
  if (new Set(rs).size !== rs.length) errors.push('kutuda aynı değer iki kez');
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  if (!rs.includes(p.answer)) errors.push('cevap kutuda yok');
  let ok = 0;
  for (const r of rs) {
    const fc = cutoff(p.parts, r);
    for (const f of [p.fs, p.fn]) if (Math.abs(gainClosed(fc, f) - gainComplex(p.parts, r, f)) > 1e-12) errors.push(`${r} Ω: kapalı form karmaşık empedansla uyuşmuyor`);
    const m = meets(p, r);
    if (m.signal && m.noise) ok++;
    if (r === p.answer && !(m.signal && m.noise)) errors.push('cevap şartları sağlamıyor');
    // Elle aralığa göre sınırda kalan aday yok
    if (r !== p.answer && fc > p.hand.fcLo * (1 - OUTSIDE_MARGIN) && fc < p.hand.fcHi * (1 + OUTSIDE_MARGIN)) errors.push(`${r} Ω kesim aralığına çok yakın`);
  }
  if (ok !== 1) errors.push(`şartları sağlayan ${ok} aday (1 olmalı)`);
  const all = e12Values();
  const k = all.indexOf(p.answer);
  for (const nb of [all[k - 1], all[k + 1]]) if (nb !== undefined) {
    const m = meets(p, nb);
    if (m.signal && m.noise) errors.push(`bitişik E12 (${nb} Ω) de şartları sağlıyor`);
  }
  if (!(p.answer >= Math.min(p.hand.rLo, p.hand.rHi) && p.answer <= Math.max(p.hand.rLo, p.hand.rHi))) errors.push('elle bulunan direnç aralığı cevabı içermiyor');
  if (p.bin.filter((b) => b.mistake).length < 2) errors.push('en az iki klasik hata kutuda olmalı');
  return [...new Set(errors)];
}

export function generateFilter(c: FilterConfig, seed: number): FilterProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (w: string) => reasons.set(w, (reasons.get(w) ?? 0) + 1);
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const kind = pick(rng, c.kinds);
    const parts: FilterParts = { kind, part: kind === 'rc' ? pick(rng, c.c_nF) * 1e-9 : pick(rng, c.l_mH) * 1e-3 };
    const answer = pick(rng, e12Values(...c.answer[kind]));
    const fc = cutoff(parts, answer);
    const fs = pick(rng, c.fSignal);
    const fn = pick(rng, c.fNoise);
    if (!(fs < fc / 1.3 && fn > fc * 1.3)) {
      reject('sinyal/gürültü frekansı kesimin iki yanında değil');
      continue;
    }
    // Pencere kenarlarından şartlar: sinyal tam f_c/(1+w)'de, gürültü f_c·(1+w)'de sınırda
    const gsDb = shown(toDb(gainClosed(fc / (1 + c.window), fs)));
    const gnDb = shown(toDb(gainClosed(fc * (1 + c.window), fn)));
    const [fcLo, fcHi] = cutoffBounds(fs, gsDb, fn, gnDb);
    const hand = { fcLo, fcHi, rLo: resistorFor(parts, fcLo), rHi: resistorFor(parts, fcHi) };
    const cards: Omit<FilterCard, 'id'>[] = [{ r: answer, label: formatOhm(answer) }];
    const add = (r: number, mistake?: string) => {
      if (!(r > 0) || !Number.isFinite(r)) return;
      const e = nearestE12(r);
      if (cards.length < c.binSize && !cards.some((x) => x.r === e)) cards.push({ r: e, label: formatOhm(e), mistake });
    };
    const mid = Math.sqrt(fcLo * fcHi);
    add(kind === 'rc' ? 1 / (parts.part * mid) : parts.part * mid, 'Kesim frekansında 2π unutulmuş: ω_c = 1/(RC) ile f_c = 1/(2πRC) karıştırılmış.');
    add(resistorFor(parts, fs), 'Kesim frekansı sinyal frekansına eşitlenmiş; o zaman sinyal tam −3 dB zayıflar (şart daha sıkı).');
    add(resistorFor(parts, fn), 'Kesim frekansı gürültü frekansına eşitlenmiş; gürültü yalnız −3 dB bastırılır.');
    for (const r of shuffle(rng, e12Values(answer / 6, answer * 6))) add(r);
    if (cards.length < c.binSize) {
      reject('kutu doldurulamadı');
      continue;
    }
    const p: FilterProblem = { seed, parts, fs, fn, gsDb, gnDb, answer, bin: shuffle(rng, cards).map((x, j) => ({ ...x, id: `b${j}` })), hand };
    const errors = verifyFilter(c, p);
    if (!errors.length) return p;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Filtre problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
