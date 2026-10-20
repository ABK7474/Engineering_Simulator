// Max-power üretici + doğrulayıcı. Kutu seyrek: bütün değer çiftleri en az `spacing` kat ayrık; doğru aday
// tek, tuzaklar (R₁, akımı en büyük yapan küçük değer, hatalı R_th) dış bölgede. Sağlanamazsa 200 denemeden
// sonra açıklamalı hata.

import { evaluate, type Scope } from '../../core/expr';
import { formatOhm } from '../../core/format';
import { createRng, pick, shuffle, type Rng } from '../../core/rng';
import { evalDerived, fillTemplate, nearestE12, shown } from './design-core';
import { e12Values } from './e-series';
import {
  ANSWER_ZONE,
  DECOY_ABOVE,
  DECOY_BELOW,
  DECOY_MAX_RATIO,
  inDecoyZone,
  loadPower,
  loadVoltage,
  powerRatio,
  SUCCESS_RATIO,
  type MaxPowerConfig,
} from './max-power';

export const MAX_ATTEMPTS = 200;

export interface PowerCard {
  id: string;
  r: number;
  label: string;
  /** Tuzaksa nedeni (raporda). */
  decoy?: string;
}

export interface MaxPowerProblem {
  seed: number;
  vth: number;
  rth: number;
  /** Oyuncunun gördüğü sayılar: R1, V1, R2, V2 (V'ler 3 anlamlı basamak). */
  visible: Scope;
  /** Oyuncunun sayılarıyla türetilenler (elle çözüm). */
  scope: Scope;
  logText: string;
  answer: number;
  bin: PowerCard[];
  pmax: number;
  /** Kaynak akımı bunu aşarsa sigorta atar. */
  fuseCurrent: number;
}

const ratioApart = (a: number, b: number) => Math.max(a / b, b / a);

export function verifyMaxPower(c: MaxPowerConfig, p: MaxPowerProblem): string[] {
  const errors: string[] = [];
  const rs = p.bin.map((b) => b.r);
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (ratioApart(rs[i], rs[j]) < c.spacing) errors.push(`kutuda ${rs[i]} ile ${rs[j]} çok yakın (< ${c.spacing} kat)`);
  if (!rs.includes(p.answer)) errors.push('cevap kutuda yok');
  const ax = p.answer / p.rth;
  if (ax < ANSWER_ZONE[0] || ax > ANSWER_ZONE[1]) errors.push(`cevap x = ${ax.toFixed(2)} doğru bölgede değil`);
  // Güç: MNA ile kapalı form uyuşmalı; yalnız cevap başarı eşiğinde, diğerleri ≤ %93
  for (const r of rs) {
    const { p: pw } = loadPower(p.vth, p.rth, r);
    const closed = (p.vth * p.vth * r) / (p.rth + r) ** 2;
    if (Math.abs(pw / closed - 1) > 1e-9) errors.push('MNA gücü kapalı formla uyuşmuyor');
    const ratio = pw / p.pmax;
    if (r === p.answer && ratio < SUCCESS_RATIO) errors.push('cevap başarı eşiğinin altında');
    if (r !== p.answer) {
      if (ratio > DECOY_MAX_RATIO) errors.push(`${r} Ω güç oranı %${(ratio * 100).toFixed(1)} (≤ %93 olmalı)`);
      if (!inDecoyZone(r / p.rth)) errors.push(`${r} Ω tuzak bölgesinde değil`);
    }
  }
  if (Math.abs(powerRatio(ax) - loadPower(p.vth, p.rth, p.answer).p / p.pmax) > 1e-9) errors.push('güç oranı formülü uyuşmuyor');
  // Elle çözüm: gösterilen (yuvarlanmış) V₁, V₂ ile bulunan R_th en yakın E12'de cevaba varır ve bölgede kalır
  const rCalc = p.scope[c.solution];
  if (!(rCalc > 0) || nearestE12(rCalc) !== p.answer) errors.push(`elle çözüm ${rCalc} Ω veriyor; en yakın E12 cevap değil`);
  else if (p.answer / rCalc < ANSWER_ZONE[0] || p.answer / rCalc > ANSWER_ZONE[1]) errors.push('elle çözümle cevap bölgesi kayıyor');
  for (const b of p.bin) if (b.r !== p.answer && Math.abs(Math.log(b.r / rCalc)) < Math.log(c.spacing) / 2) errors.push('bir tuzak elle çözüme cevaptan yakın');
  if (!p.bin.some((b) => b.r === p.visible.R1 && b.decoy)) errors.push('R₁ tuzağı kutuda yok');
  const decoys = p.bin.filter((b) => b.decoy).length;
  if (decoys < 2) errors.push(`kutuda ${decoys} tuzak var (en az 2 olmalı)`);
  return [...new Set(errors)];
}

function logUniform(rng: Rng, [lo, hi]: [number, number]): number {
  return shown(lo * (hi / lo) ** rng());
}

function candidate(c: MaxPowerConfig, rng: Rng, seed: number): MaxPowerProblem | string {
  const vth = pick(rng, c.vth);
  const rth = logUniform(rng, c.rth);
  const answer = nearestE12(rth);
  // İyi koşullu iki test: biri R_th'nin altında, biri üstünde (ikisi de dış bölgede); sıra rastgele
  const below = e12Values(c.testR[0], c.testR[1]).filter((r) => r / rth < DECOY_BELOW);
  const above = e12Values(c.testR[0], c.testR[1]).filter((r) => r / rth > DECOY_ABOVE && r / rth < 12);
  if (!below.length || !above.length) return 'yük testi için dış bölgede direnç yok';
  const [r1, r2] = shuffle(rng, [pick(rng, below), pick(rng, above)]);
  const visible: Scope = { R1: r1, V1: shown(loadVoltage(vth, rth, r1)), R2: r2, V2: shown(loadVoltage(vth, rth, r2)) };
  let scope: Scope;
  try {
    scope = evalDerived(c.derived, visible);
  } catch {
    return 'türetilen değerler hesaplanamadı';
  }

  const cards: Omit<PowerCard, 'id'>[] = [{ r: answer, label: formatOhm(answer) }];
  const fits = (r: number) => inDecoyZone(r / rth) && cards.every((x) => ratioApart(x.r, r) >= c.spacing);
  const tryAdd = (r: number, decoy?: string) => {
    if (cards.length < c.binSize && r > 0 && Number.isFinite(r) && fits(r)) cards.push({ r, label: formatOhm(r), decoy });
  };
  tryAdd(r1, `R₁ = ${formatOhm(r1)}: yük testindeki direnç; testteki güç en büyük güç değildir.`);
  if (!cards.some((x) => x.r === r1)) return 'R₁ tuzağı kutuya sığmadı';
  for (const m of c.mistakes) {
    let v: number;
    try {
      v = evaluate(m.expr, scope);
    } catch {
      continue;
    }
    if (v > 0) tryAdd(nearestE12(v), fillTemplate(m.text, { ...scope, value: v }));
  }
  tryAdd(nearestE12(rth / 5), 'En küçük yük en büyük AKIMI çeker ama güç P = I²R küçük kalır; kaynak sigortası da zorlanır.');
  if (cards.filter((x) => x.decoy).length < 2) return 'en az iki tuzak dış bölgeye sığmadı';
  for (const r of shuffle(rng, e12Values(rth / 12, rth * 12))) tryAdd(r);
  if (cards.length < c.binSize) return 'seyrek kutu doldurulamadı';

  const pmax = (vth * vth) / (4 * rth);
  return {
    seed,
    vth,
    rth,
    visible,
    scope,
    logText: fillTemplate(c.log, visible),
    answer,
    bin: shuffle(rng, cards).map((x, k) => ({ ...x, id: `b${k}` })),
    pmax,
    fuseCurrent: (c.fuseRatio * vth) / rth,
  };
}

export function generateMaxPower(c: MaxPowerConfig, seed: number): MaxPowerProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (why: string) => reasons.set(why, (reasons.get(why) ?? 0) + 1);
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const cand = candidate(c, rng, seed);
    if (typeof cand === 'string') {
      reject(cand);
      continue;
    }
    const errors = verifyMaxPower(c, cand);
    if (!errors.length) return cand;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Max-power problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
