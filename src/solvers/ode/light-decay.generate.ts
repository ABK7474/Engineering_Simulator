// Acil aydınlatma üretici + doğrulayıcı + sonuç + rapor. Cevap R önce E12'den seçilir; eşikler onun eğrisinden
// güvenlik payıyla yerleşir (gösterilen 3 basamaklı değerlerle). Kutuda iki şartı birlikte sağlayan tek aday
// cevaptır; diğerleri en az bir şartı açık farkla bozar; kapalı form ve RK4 her aday için uyuşur.

import { formatFarad, formatOhm, formatSec, formatVolt } from '../../core/format';
import { createRng, pick, shuffle, type Rng } from '../../core/rng';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { nearestE12, shown } from '../circuit/design-core';
import { e12Values } from '../circuit/e-series';
import { lampAt, lampAtRk4, tau, type DecayParams, type LightDecayConfig } from './light-decay';

export const MAX_ATTEMPTS = 200;
/** Kutudaki yanlış adaylar bozdukları şartı en az bu oranda bozmalı. */
export const OUTSIDE_MARGIN = 0.03;

export interface DecayCard {
  id: string;
  r: number;
  label: string;
  mistake?: string;
}

export interface LightDecayProblem {
  seed: number;
  params: DecayParams;
  tWalk: number;
  tArr: number;
  vSee: number;
  vDet: number;
  answer: number;
  bin: DecayCard[];
}

export const seesAt = (p: LightDecayProblem, r: number) => lampAt(p.params, r, p.tWalk);
export const darkAt = (p: LightDecayProblem, r: number) => lampAt(p.params, r, p.tArr);
const ok = (p: LightDecayProblem, r: number) => seesAt(p, r) >= p.vSee && darkAt(p, r) <= p.vDet;

export function verifyLightDecay(c: LightDecayConfig, p: LightDecayProblem): string[] {
  const errors: string[] = [];
  const rs = p.bin.map((b) => b.r);
  if (new Set(rs).size !== rs.length) errors.push('kutuda aynı değer iki kez');
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  if (!rs.includes(p.answer)) errors.push('cevap kutuda yok');
  if (!(p.vDet < p.vSee)) errors.push('tespit eşiği görme eşiğinden küçük olmalı');
  const all = e12Values();
  const idx = all.indexOf(p.answer);
  for (const nb of [all[idx - 1], all[idx + 1]]) if (nb !== undefined && ok(p, nb)) errors.push(`bitişik E12 (${nb} Ω) de şartları sağlıyor`);
  for (const r of rs) {
    for (const t of [p.tWalk, p.tArr]) {
      if (Math.abs(lampAtRk4(p.params, r, t) / lampAt(p.params, r, t) - 1) > 1e-6) errors.push(`${r} Ω: kapalı form ile RK4 uyuşmuyor`);
    }
    if (r === p.answer) {
      if (!ok(p, r)) errors.push('cevap şartları sağlamıyor');
      continue;
    }
    if (ok(p, r)) errors.push(`${r} Ω da şartları sağlıyor`);
    const seeShort = 1 - seesAt(p, r) / p.vSee; // > 0: görünmüyor
    const detOver = darkAt(p, r) / p.vDet - 1; // > 0: tespit edilir
    if (Math.max(seeShort, detOver) < OUTSIDE_MARGIN) errors.push(`${r} Ω şart sınırına çok yakın`);
  }
  return [...new Set(errors)];
}

/** Verilen (yanlış) modelle hedef değere ulaştıran R (log ölçekte ikiye bölme); bulunamazsa null. */
function solveR(f: (r: number) => number, target: number): number | null {
  let lo = 0.5;
  let hi = 5000;
  const g = (r: number) => f(r) - target;
  if (Math.sign(g(lo)) === Math.sign(g(hi))) return null;
  for (let k = 0; k < 80; k++) {
    const mid = Math.sqrt(lo * hi);
    if (Math.sign(g(mid)) === Math.sign(g(lo))) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

function candidate(c: LightDecayConfig, rng: Rng, seed: number): LightDecayProblem | string {
  const params: DecayParams = { v0: pick(rng, c.V0), c: pick(rng, c.C_F), rl: pick(rng, c.RL) };
  const tWalk = pick(rng, c.tWalk);
  const tArr = pick(rng, c.tArr);
  const answer = pick(rng, e12Values(...c.answer));
  // Tek çözüm için iki şart da bağlayıcı olmalı: t_walk > τ iken V_L(t) R ile artar; görme şartı R'yi alttan,
  // gizlenme şartı üstten sınırlar. t_walk < τ olsaydı daha küçük R iki şartı birden iyileştirirdi.
  const T = tau(params, answer);
  if (tWalk < 1.3 * T) return 'görme şartı bağlayıcı değil (t_walk ≤ 1,3τ)';
  if (tArr > 6 * T) return 'varışta lamba çok sönük (t_arr > 6τ)';
  const vSee = shown(lampAt(params, answer, tWalk) * (1 - c.margin));
  const vDet = shown(lampAt(params, answer, tArr) * (1 + c.margin));
  if (!(vDet < vSee * 0.8)) return 'eşikler birbirine çok yakın';
  if (vDet < 0.05) return 'tespit eşiği gösterilemeyecek kadar küçük';

  const cards: Omit<DecayCard, 'id'>[] = [{ r: answer, label: formatOhm(answer) }];
  const add = (r: number | null, mistake?: string) => {
    if (r === null || !(r > 0) || !Number.isFinite(r)) return;
    const e = nearestE12(r);
    if (cards.length < c.binSize && !cards.some((x) => x.r === e)) cards.push({ r: e, label: formatOhm(e), mistake });
  };
  const { v0, rl, c: C } = params;
  // Yanlış modeller: tespit şartını tam sınırda sağlayan R
  add(solveR((r) => ((v0 * rl) / (r + rl)) * Math.exp(-tArr / (r * C)), vDet), 'Lamba direnci zaman sabitine katılmamış: τ = R·C sanılmış (akım R ve R_L\'nin ikisinden de geçer).');
  add(solveR((r) => v0 * Math.exp(-tArr / ((r + rl) * C)), vDet), 'Gerilim bölücü unutulmuş: lamba V₀\'dan başlıyor sanılmış (V_L = V·R_L/(R + R_L)).');
  add(solveR((r) => ((v0 * rl) / (r + rl)) * Math.exp(-tWalk / ((r + rl) * C)), vSee * 0.98), 'Yalnız görme şartı sağlanmış: lamba yaratık geldiğinde hâlâ fazla parlak.');
  for (const r of shuffle(rng, e12Values(answer / 5, answer * 5))) add(r);
  if (cards.length < c.binSize) return 'kutu doldurulamadı';
  return { seed, params, tWalk, tArr, vSee, vDet, answer, bin: shuffle(rng, cards).map((x, k) => ({ ...x, id: `b${k}` })) };
}

export function generateLightDecay(c: LightDecayConfig, seed: number): LightDecayProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (w: string) => reasons.set(w, (reasons.get(w) ?? 0) + 1);
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const cand = candidate(c, rng, seed);
    if (typeof cand === 'string') {
      reject(cand);
      continue;
    }
    const errors = verifyLightDecay(c, cand);
    if (!errors.length) return cand;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`light-decay problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}

// ---------------------------------------------------------------- sonuç

export type DecayOutcomeKind = Extract<OutcomeKind, 'success' | 'creature_alerted' | 'dark_stumble'>;

export function classifyLightDecay(p: LightDecayProblem, r: number): DecayOutcomeKind {
  if (darkAt(p, r) > p.vDet) return 'creature_alerted';
  if (seesAt(p, r) < p.vSee) return 'dark_stumble';
  return 'success';
}

export function resolveLightDecayOutcome(p: LightDecayProblem, cardId: string): Outcome {
  const card = p.bin.find((b) => b.id === cardId);
  if (!card) throw new Error(`Geçersiz kart: ${cardId}`);
  const r = card.r;
  const kind = classifyLightDecay(p, r);
  const read = `R = ${formatOhm(r)}: t = ${formatSec(p.tWalk)}'de lamba ${formatVolt(seesAt(p, r))}, t = ${formatSec(p.tArr)}'de ${formatVolt(darkAt(p, r))}.`;
  switch (kind) {
    case 'success':
      return { kind, severity: 0, resistorOverheat: false, headline: 'Karanlıkta beklendi', explanation: `${read} Siper alana kadar yol göründü; yaratık geldiğinde ışık tespit eşiğinin altındaydı. Gölge istasyonun yanından geçip gitti.` };
    case 'creature_alerted':
      return {
        kind,
        severity: 1 + Math.min(3, darkAt(p, r) / p.vDet - 1),
        resistorOverheat: false,
        headline: 'Işık fark edildi',
        explanation: `${read} Yaratık geldiğinde lamba hâlâ ${formatVolt(p.vDet)} tespit eşiğinin üstündeydi. Gövdeye çarptı; dış kaplama ve bir güç hattı hasar aldı.`,
      };
    case 'dark_stumble':
      return {
        kind,
        severity: 1 + Math.min(2, 1 - seesAt(p, r) / p.vSee),
        resistorOverheat: false,
        headline: 'Karanlıkta kalındı',
        explanation: `${read} Lamba siper alınmadan ${formatVolt(p.vSee)} görme eşiğinin altına indi. Karanlıkta bir boruya çarptın; maske kayıp yeniden oturana kadar oksijen kaçtı.`,
      };
  }
}

const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');

export function buildLightDecayReport(stageId: string, p: LightDecayProblem, cardId: string, outcome: Outcome): StageResult {
  const card = p.bin.find((b) => b.id === cardId)!;
  const { v0, c, rl } = p.params;
  const steps = [
    `Seri devre: akım R ve lamba R_L'den geçer, τ = (R + R_L)·C; lamba gerilimi bölücüden V_L(t) = V₀·R_L/(R + R_L)·e^(−t/τ).`,
    `Şart 1 (görme): V_L(${num(p.tWalk)} s) ≥ ${num(p.vSee)} V. Şart 2 (gizlenme): V_L(${num(p.tArr)} s) ≤ ${num(p.vDet)} V. R büyüdükçe başlangıç gerilimi düşer ama sönüm yavaşlar: ikisi birlikte denenmeli.`,
    `Doğru seçim R = ${formatOhm(p.answer)}: τ = (${num(p.answer)} + ${num(rl)})·${num(c)} = ${num(tau(p.params, p.answer))} s; V_L(0) = ${num((v0 * rl) / (p.answer + rl))} V; V_L(${num(p.tWalk)} s) = ${num(seesAt(p, p.answer))} V, V_L(${num(p.tArr)} s) = ${num(darkAt(p, p.answer))} V.`,
    'Kontrol: her aday için kondansatör denklemi dV/dt = −V/τ RK4 ile benzetildi; iki zamandaki lamba gerilimi kapalı formla aynı.',
  ];
  if (card.mistake) steps.push(`Olası hata: ${card.mistake}`);
  const tEnd = p.tArr * 1.3;
  const curve = (r: number) => Array.from({ length: 161 }, (_, k): [number, number] => [(tEnd * k) / 160, lampAt(p.params, r, (tEnd * k) / 160)]);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: formatOhm(card.r),
    correctLabel: formatOhm(p.answer),
    outcome,
    facts: [
      { label: 'Süperkapasitör', value: `${formatFarad(c)}, ${formatVolt(v0)}` },
      { label: 'Lamba', value: formatOhm(rl) },
      { label: 'Siper / varış', value: `${formatSec(p.tWalk)} / ${formatSec(p.tArr)}` },
    ],
    steps,
    table: {
      caption: 'Kutudaki adaylar',
      head: ['R', `V_L(${num(p.tWalk)} s)`, `V_L(${num(p.tArr)} s)`, 'sonuç'],
      rows: p.bin.map((b) => [formatOhm(b.r), `${num(seesAt(p, b.r))} V`, `${num(darkAt(p, b.r))} V`, { success: 'iki şart da tamam', creature_alerted: 'fark edilir', dark_stumble: 'erken karanlık' }[classifyLightDecay(p, b.r)]]),
      good: p.bin.findIndex((b) => b.r === p.answer),
      chosen: p.bin.findIndex((b) => b.id === cardId),
    },
    plot: {
      caption: 'Lamba gerilimi; bant: tespit eşiği ile görme eşiği arası, pencere: siper alma → varış',
      xLabel: 't (s)',
      yLabel: 'V_L (V)',
      xScale: 1,
      yScale: 1,
      threshold: p.vDet,
      window: [p.tWalk, p.tArr],
      band: [p.vDet, p.vSee],
      series: [
        { label: `doğru: ${formatOhm(p.answer)}`, kind: 'correct', points: curve(p.answer) },
        ...(card.r === p.answer ? [] : [{ label: `seçilen: ${formatOhm(card.r)}`, kind: 'chosen' as const, points: curve(card.r) }]),
      ],
    },
  };
}
