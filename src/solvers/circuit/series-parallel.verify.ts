// Seri-paralel problem doğrulayıcısı: havuza yalnız bundan geçen problemler girer.

import { evaluate } from '../../core/expr';
import { placements } from './design-core';
import { e12Values } from './e-series';
import { checkSolution } from './mna';
import {
  buildNetlist,
  classify,
  derivedScope,
  measure,
  nearestE12,
  readingFor,
  readProbe,
  slotIds,
  solveWith,
  type SeriesParallelConfig,
} from './series-parallel';
import type { SpProblem } from './series-parallel.generate';

/** Yanlış yerleşimler en az bir hedefi toleransın bu katı kadar kaçırmalı (sınırda belirsizlik yok). */
export const WRONG_MARGIN = 1.5;
/** Doğru cevapta yuva direnci anma gücünün en fazla bu oranını harcar. */
export const ANSWER_POWER_SHARE = 0.7;

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

export { placements };

export function verifySeriesParallel(c: SeriesParallelConfig, p: SpProblem): VerifyResult {
  const errors: string[] = [];
  const slots = slotIds(c);
  const rOf = (id: string) => p.bin.find((b) => b.id === id)!.r;

  // 1. Kutu
  const rs = p.bin.map((b) => b.r);
  if (new Set(rs).size !== rs.length) errors.push('kutuda aynı değerde iki direnç');
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  for (const s of slots) if (!rs.includes(p.answer[s])) errors.push(`cevap '${s}' kutuda yok`);

  // 2. Cevap E12'den ve izinli aralıkta
  for (const s of slots) {
    const [lo, hi] = c.answer[s];
    if (!e12Values(lo, hi).includes(p.answer[s])) errors.push(`cevap '${s}' = ${p.answer[s]} E12 aralığında değil`);
  }
  if (errors.length) return { ok: false, errors };

  // 3. Cevap devresi: KCL ve güç dengesi (çözümden bağımsız kontrol), gerçekçilik
  const net = buildNetlist(c, p.params, p.answer);
  const sol = solveWith(c, p.params, p.answer);
  const chk = checkSolution(net, sol);
  if (chk.kcl > 1e-9 || chk.power > 1e-6) errors.push('çözüm KCL/güç dengesini sağlamıyor');
  const reading = readingFor(c, sol, p.targets);
  const [lmin, lmax] = c.plausible.load;
  if (reading.load < lmin || reading.load > lmax) errors.push('yük akımı gerçekçi aralıkta değil');
  const vmax = Math.max(...c.elements.filter((e) => e.kind === 'V').map((e) => p.params[e.value!]));
  const frac = sol.voltage[c.plausible.node] / vmax;
  if (frac < c.plausible.nodeFraction[0] || frac > c.plausible.nodeFraction[1]) errors.push('düğüm gerilimi oranı gerçekçi değil');
  for (const s of slots) {
    if (Math.abs(sol.power[s]) > ANSWER_POWER_SHARE * c.limits.slotRating_W) errors.push(`cevapta '${s}' anma gücüne çok yakın`);
  }
  if (classify(reading) !== 'ok') errors.push(`cevap gösterilen hedefleri tutturmuyor (${classify(reading)})`);
  if (errors.length) return { ok: false, errors };

  // 4. Tek çözüm: kutudaki tüm yerleşimler içinde yalnız cevap hedefleri tutar; diğerleri açık farkla kaçırır
  const tolLoad = c.targets.find((t) => t.id === c.roles.load)!.tolerance;
  const tolSupply = c.targets.find((t) => t.id === c.roles.supply)!.tolerance;
  let okCount = 0;
  for (const pl of placements(slots, p.bin.map((b) => b.id))) {
    const values = Object.fromEntries(slots.map((s) => [s, rOf(pl[s])]));
    const r = readingFor(c, solveWith(c, p.params, values), p.targets);
    const margin = Math.max(Math.abs(r.load / r.loadTarget - 1) / tolLoad, Math.abs(r.supply / r.supplyTarget - 1) / tolSupply);
    const isAnswer = slots.every((s) => values[s] === p.answer[s]);
    if (margin <= 1) okCount++;
    if (!isAnswer && margin < WRONG_MARGIN) errors.push('yanlış bir yerleşim hedeflere çok yakın (belirsiz)');
    if (isAnswer && margin > 1) errors.push('cevap yerleşimi hedef dışında');
  }
  if (okCount !== 1) errors.push(`hedefleri tutturan yerleşim sayısı ${okCount} (1 olmalı)`);
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  // 5. Gizli parametre ölçümden tek anlamlı bulunur: ölçüm, parametrenin aralığında kesin tekdüze
  const hid = c.measurement.identifies;
  const range = c.params[hid].e12 ? e12Values(...c.params[hid].e12!) : c.params[hid].choices!;
  const ms = range.map((v) => measure(c, { ...p.params, [hid]: v }));
  const diffs = ms.slice(1).map((m, k) => m - ms[k]);
  if (!(diffs.every((d) => d > 1e-9) || diffs.every((d) => d < -1e-9))) errors.push(`'${hid}' ölçümden tek anlamlı bulunamıyor`);

  // 6. Elle çözüm: oyuncunun gördüğü (yuvarlanmış) sayılarla yazılı çözüm zinciri cevaba varır
  let scope;
  try {
    scope = derivedScope(c, p.visible);
  } catch (e) {
    errors.push(`çözüm zinciri hesaplanamadı: ${(e as Error).message}`);
    return { ok: false, errors };
  }
  for (const s of slots) {
    const v = evaluate(c.solution[s], scope);
    if (!(v > 0) || nearestE12(v) !== p.answer[s]) errors.push(`elle çözüm '${s}' için ${v.toFixed(2)} Ω veriyor; en yakın E12 cevap değil`);
  }

  // 7. Ölçüm ve hedefler gösterilen sayılarla tutarlı
  const exact = readProbe(sol, c.targets[0].probe);
  if (Math.abs(exact / p.targets[c.targets[0].id] - 1) > 0.005) errors.push('gösterilen hedef yuvarlaması fazla');

  return { ok: errors.length === 0, errors };
}
