// Op-amp üretici + doğrulayıcı. Cevap ÖNCE E12'den seçilir; hedef ADC gerilimleri bu cevaptan MNA ile
// hesaplanıp 3 basamağa yuvarlanır. Kutu: cevaplar + klasik hataların E12 karşılıkları + komşular.
// Tek anlamlılık: kutudaki bütün yerleşimler denenir; yalnız cevap toleransta, diğerleri ≥ 1,5×tolerans dışında.

import type { Scope } from '../../core/expr';
import { formatOhm } from '../../core/format';
import { createRng, pick, shuffle, type Rng } from '../../core/rng';
import { nearestE12, placements, shown } from './design-core';
import { e12Values } from './e-series';
import { outputClosed, outputMna, SLOTS, type OpampConfig, type OpampVariant, type Resistors } from './opamp';

export const MAX_ATTEMPTS = 200;
export const WRONG_MARGIN = 1.5;

export interface OpampCard {
  id: string;
  r: number;
  label: string;
  /** Klasik hatadan geliyorsa açıklaması. */
  mistake?: string;
}

export interface OpampProblem {
  seed: number;
  variant: OpampVariant;
  vcc: number;
  vlo: number;
  vhi: number;
  vref: number;
  /** Gösterilen hedefler (3 basamak). */
  ylo: number;
  yhi: number;
  tolerance: number;
  answer: Record<string, number>;
  bin: OpampCard[];
  /** Oyuncunun sayılarıyla elle çözüm: kazanç, ofset, oranlar. */
  scope: Scope;
}

/** Elle çözüm zinciri: gösterilen sayılardan kazanç ve oranlar. */
export function handSolution(v: OpampVariant, vlo: number, vhi: number, ylo: number, yhi: number, vref: number): Scope {
  const G = (yhi - ylo) / (vhi - vlo);
  if (v === 'gain') return { G, ratioFg: G - 1 };
  const b = ylo - G * vlo; // ofset (negatif olmalı)
  const ratioFr = -b / vref;
  return { G, b, ratioFr, ratioFg: G - 1 - ratioFr };
}

/** Yerleşimin iki uçtaki hatası, toleransın katı olarak (en kötüsü). */
export function placementError(p: Pick<OpampProblem, 'variant' | 'vlo' | 'vhi' | 'vref' | 'ylo' | 'yhi' | 'tolerance'>, r: Resistors): number {
  const span = p.yhi - p.ylo;
  const e1 = Math.abs(outputClosed(p.variant, p.vlo, p.vref, r) - p.ylo);
  const e2 = Math.abs(outputClosed(p.variant, p.vhi, p.vref, r) - p.yhi);
  return Math.max(e1, e2) / (p.tolerance * span);
}

export function verifyOpamp(c: OpampConfig, p: OpampProblem): string[] {
  const errors: string[] = [];
  const slots = SLOTS[p.variant];
  const rs = p.bin.map((b) => b.r);
  if (new Set(rs).size !== rs.length) errors.push('kutuda aynı değer iki kez');
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  for (const s of slots) if (!rs.includes(p.answer[s])) errors.push(`cevap '${s}' kutuda yok`);
  if (errors.length) return errors;
  // İki yol: MNA ile kapalı form, iki uçta
  for (const vs of [p.vlo, p.vhi]) {
    const a = outputMna(p.variant, vs, p.vref, p.answer);
    const b = outputClosed(p.variant, vs, p.vref, p.answer);
    if (Math.abs(a - b) > 1e-9) errors.push('MNA kapalı formla uyuşmuyor');
    if (a < c.railMargin || a > p.vcc - c.railMargin) errors.push('cevap çıkışı raya çok yakın');
  }
  if (p.yhi - p.ylo < c.minSpan) errors.push('hedef aralığı dar');
  // Tek anlamlılık
  let ok = 0;
  for (const pl of placements(slots, p.bin.map((b) => b.id))) {
    const r: Resistors = Object.fromEntries(slots.map((s) => [s, p.bin.find((b) => b.id === pl[s])!.r]));
    const err = placementError(p, r);
    const isAnswer = slots.every((s) => r[s as keyof Resistors] === p.answer[s]);
    if (err <= 1) ok++;
    if (isAnswer && err > 1) errors.push('cevap toleransın dışında');
    if (!isAnswer && err < WRONG_MARGIN) errors.push('yanlış bir yerleşim hedeflere çok yakın (belirsiz)');
  }
  if (ok !== 1) errors.push(`toleransta ${ok} yerleşim var (1 olmalı)`);
  // Elle çözüm: gösterilen sayılardan oranlar cevabın oranlarına %2 içinde
  const s = p.scope;
  if (!(s.ratioFg > 0) || Math.abs(s.ratioFg / (p.answer.Rf / p.answer.Rg) - 1) > 0.02) errors.push('elle çözüm Rf/Rg oranını tutturmuyor');
  if (p.variant === 'offset' && (!(s.ratioFr > 0) || Math.abs(s.ratioFr / (p.answer.Rf / p.answer.Rr) - 1) > 0.02)) errors.push('elle çözüm Rf/Rr oranını tutturmuyor');
  return [...new Set(errors)];
}

function candidate(c: OpampConfig, rng: Rng, seed: number): OpampProblem | string {
  const variant = pick(rng, c.variants);
  const slots = SLOTS[variant];
  const vlo = pick(rng, c.sensorLo);
  const vhi = pick(rng, c.sensorHi);
  if (!(vhi > vlo * 1.5)) return 'sensör aralığı dar';
  const vref = pick(rng, c.vref);
  // Tasarım: ADC'de hedeflenen aralıktan oranlar; dirençler E12'ye yuvarlanır. Gösterilen hedefler
  // sonra bu E12 cevaptan hesaplanır (cevap her zaman E12).
  const top = c.vcc - c.railMargin - rng() * 0.6;
  const bottom = variant === 'offset' ? c.railMargin + rng() * 0.6 : 0;
  const gDesign = variant === 'offset' ? (top - bottom) / (vhi - vlo) : top / vhi;
  const ratioFr = variant === 'offset' ? -(bottom - gDesign * vlo) / vref : 0;
  const ratioFg = gDesign - 1 - ratioFr;
  if (!(ratioFg > 0.2) || (variant === 'offset' && !(ratioFr > 0.05))) return 'tasarım oranları gerçekçi değil';
  const answer: Record<string, number> = { Rf: pick(rng, e12Values(...c.answer.Rf)) };
  answer.Rg = nearestE12(answer.Rf / ratioFg);
  if (variant === 'offset') answer.Rr = nearestE12(answer.Rf / ratioFr);
  for (const s of slots) if (answer[s] < c.answer[s as 'Rf'][0] || answer[s] > c.answer[s as 'Rf'][1]) return `cevap '${s}' aralık dışında`;
  if (new Set(Object.values(answer)).size !== slots.length) return 'yuvalara aynı değer düştü';
  const ylo = shown(outputMna(variant, vlo, vref, answer));
  const yhi = shown(outputMna(variant, vhi, vref, answer));
  if (ylo < c.railMargin || yhi > c.vcc - c.railMargin) return 'çıkış raya taşıyor';
  if (yhi - ylo < c.minSpan) return 'hedef aralığı dar';
  const scope = handSolution(variant, vlo, vhi, ylo, yhi, vref);

  // Kutu: cevaplar + klasik hatalar + komşu E12
  const cards: Omit<OpampCard, 'id'>[] = slots.map((s) => ({ r: answer[s], label: formatOhm(answer[s]) }));
  const add = (r: number, mistake?: string) => {
    if (cards.length < c.binSize && r > 0 && Number.isFinite(r) && !cards.some((x) => x.r === r)) cards.push({ r, label: formatOhm(r), mistake });
  };
  const G = scope.G;
  add(nearestE12(answer.Rf / G), 'Kazançtaki "1 +" unutulmuş: Rf/Rg = G alınmış (evirmeyen yükselteçte G = 1 + Rf/Rg).');
  if (variant === 'offset') {
    add(nearestE12(answer.Rf / (G - 1)), 'Ofset direncinin kazanca katkısı unutulmuş: Rf/Rg = G − 1 alınmış (doğrusu G − 1 − Rf/Rr).');
    add(nearestE12(answer.Rf / (-scope.b / c.vcc)), 'Ofset oranı V_ref yerine besleme gerilimine bölünmüş: Rf/Rr = −b/Vcc alınmış (doğrusu −b/V_ref).');
  } else add(nearestE12(answer.Rg * G), 'Rf ile Rg yer değiştirmiş gibi hesaplanmış.');
  const all = e12Values();
  for (const r of shuffle(rng, slots.flatMap((s) => [-3, -2, 2, 3].map((d) => all[all.indexOf(answer[s]) + d]).filter((x): x is number => x !== undefined)))) add(r);
  if (cards.length < c.binSize) return 'kutu doldurulamadı';
  return {
    seed,
    variant,
    vcc: c.vcc,
    vlo,
    vhi,
    vref,
    ylo,
    yhi,
    tolerance: c.tolerance,
    answer,
    bin: shuffle(rng, cards).map((x, k) => ({ ...x, id: `b${k}` })),
    scope,
  };
}

export function generateOpamp(c: OpampConfig, seed: number): OpampProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (w: string) => reasons.set(w, (reasons.get(w) ?? 0) + 1);
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const cand = candidate(c, rng, seed);
    if (typeof cand === 'string') {
      reject(cand);
      continue;
    }
    const errors = verifyOpamp(c, cand);
    if (!errors.length) return cand;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Op-amp problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
