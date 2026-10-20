// Seri-paralel problem üretici. Cevap ÖNCE E12'den seçilir, hedefler bu cevaptan MNA ile
// hesaplanır; böylece her problemin E12 cevabı vardır. Her aday doğrulayıcıdan geçmek zorunda;
// deneme sınırında geçerli problem bulunamazsa açık hata verilir.

import { evaluate, type Scope } from '../../core/expr';
import { formatOhm } from '../../core/format';
import { createRng, pick, shuffle, type Rng } from '../../core/rng';
import { pickParam } from './design-core';
import { e12Values } from './e-series';
import {
  derivedScope,
  fillTemplate,
  measure,
  nearestE12,
  readProbe,
  shown,
  slotIds,
  solveWith,
  type SeriesParallelConfig,
} from './series-parallel';
import { verifySeriesParallel } from './series-parallel.verify';

export const MAX_ATTEMPTS = 200;

export interface BinCard {
  id: string;
  r: number;
  label: string;
  /** Tipik hata kaynağı; yanlış takılırsa olay raporunda açıklanır. */
  mistake?: string;
}

export interface SpProblem {
  seed: number;
  /** Tüm parametreler (gizliler dahil). */
  params: Scope;
  /** Oyuncunun gördüğü sayılar (gizli parametreler hariç, 3 anlamlı basamağa yuvarlanmış). */
  visible: Scope;
  measurementText: string;
  /** Gösterilen hedef değerleri (yuvarlanmış). */
  targets: Record<string, number>;
  /** Yuva → doğru direnç (Ω). */
  answer: Record<string, number>;
  bin: BinCard[];
}

export function generateSeriesParallel(c: SeriesParallelConfig, seed: number, maxAttempts = MAX_ATTEMPTS): SpProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (why: string) => reasons.set(why, (reasons.get(why) ?? 0) + 1);
  for (let k = 0; k < maxAttempts; k++) {
    const cand = candidate(c, rng, seed);
    if (typeof cand === 'string') {
      reject(cand);
      continue;
    }
    const v = verifySeriesParallel(c, cand);
    if (v.ok) return cand;
    reject(v.errors[0]);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Seri-paralel problem üretilemedi: ${maxAttempts} denemede doğrulanabilir problem bulunamadı (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}

/** Aday problem ya da red nedeni (metin). */
function candidate(c: SeriesParallelConfig, rng: Rng, seed: number): SpProblem | string {
  const params: Scope = {};
  for (const [k, p] of Object.entries(c.params)) params[k] = pickParam(rng, p);
  const slots = slotIds(c);
  const answer: Record<string, number> = {};
  for (const s of slots) answer[s] = pick(rng, e12Values(c.answer[s][0], c.answer[s][1]));
  if (new Set(Object.values(answer)).size !== slots.length) return 'yuvalara aynı değer düştü';

  const sol = solveWith(c, params, answer);
  const targets: Record<string, number> = {};
  for (const t of c.targets) {
    const v = readProbe(sol, t.probe);
    if (!(v > 0)) return `hedef '${t.id}' pozitif değil`;
    targets[t.id] = shown(v);
  }

  const visible: Scope = {};
  for (const [k, p] of Object.entries(c.params)) if (!p.hidden) visible[k] = params[k];
  visible[c.measurement.id] = shown(measure(c, params));
  Object.assign(visible, targets);

  let scope: Scope;
  try {
    scope = derivedScope(c, visible);
  } catch {
    return 'türetilen değerler hesaplanamadı';
  }

  // Kutu: cevaplar + klasik hataların E12 karşılıkları + cevaba komşu E12 değerleri
  const cards: Omit<BinCard, 'id'>[] = slots.map((s) => ({ r: answer[s], label: formatOhm(answer[s]) }));
  const has = (r: number) => cards.some((x) => x.r === r);
  for (const mk of c.mistakes) {
    let v: number;
    try {
      v = evaluate(mk.expr, scope);
    } catch {
      continue;
    }
    if (!(v > 0) || !Number.isFinite(v)) continue;
    const r = nearestE12(v);
    if (has(r) || cards.length >= c.binSize) continue;
    cards.push({ r, label: formatOhm(r), mistake: fillTemplate(mk.text, { ...scope, value: v }) });
  }
  const all = e12Values();
  const near = shuffle(
    rng,
    slots.flatMap((s) => [-2, -1, 1, 2].map((d) => all[all.indexOf(answer[s]) + d]).filter((r): r is number => r !== undefined)),
  );
  for (const r of near) if (cards.length < c.binSize && !has(r)) cards.push({ r, label: formatOhm(r) });
  if (cards.length < c.binSize) return 'kutu doldurulamadı';

  const bin = shuffle(rng, cards).map((x, k) => ({ ...x, id: `b${k}` }));
  return {
    seed,
    params,
    visible,
    measurementText: fillTemplate(c.measurement.text, visible),
    targets,
    answer,
    bin,
  };
}
