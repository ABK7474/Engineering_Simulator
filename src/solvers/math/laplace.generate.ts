// Laplace üretici + doğrulayıcı + sonuç + rapor. Parametreler listelerden; teoremler ile benzetim uyuşmalı,
// klasik hatalar (G(0)'da sıfırı ya da paydayı unutmak, eğimi sıfır sanmak) doğru cevaptan açıkça ayrışmalı.

import { createRng, pick } from '../../core/rng';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { finalValue, initialSlope, measuredBySimulation, simulateStep, type LaplaceConfig, type Tf } from './laplace';

export const MAX_ATTEMPTS = 200;
export const MISTAKE_MARGIN = 3;

export interface LaplaceProblem {
  seed: number;
  g: Tf;
  u: number;
  tolerance: number;
  final: number;
  slope: number;
  mistakes: { quantity: 'final' | 'slope'; value: number; text: string }[];
}

export interface LaplaceAnswer {
  final: number;
  slope: number;
}

const rel = (a: number, b: number) => Math.abs(a / b - 1);
const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');

export function verifyLaplace(p: LaplaceProblem): string[] {
  const errors: string[] = [];
  if (Math.abs(p.g.p1 - p.g.p2) < 0.1) errors.push('kutuplar çakışık');
  const sim = measuredBySimulation(p.g, p.u);
  if (rel(sim.final, p.final) > 1e-4) errors.push('son değer teoremi benzetimle uyuşmuyor');
  if (rel(sim.slope, p.slope) > 1e-3) errors.push('başlangıç eğimi benzetimle uyuşmuyor');
  for (const m of p.mistakes) {
    const right = m.quantity === 'final' ? p.final : p.slope;
    if (rel(m.value, right) < MISTAKE_MARGIN * p.tolerance) errors.push(`'${m.text.slice(0, 30)}…' doğru cevaba çok yakın`);
  }
  return errors;
}

export function generateLaplace(c: LaplaceConfig, seed: number): LaplaceProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const g: Tf = { K: pick(rng, c.K), z: pick(rng, c.z), p1: pick(rng, c.p1), p2: pick(rng, c.p2) };
    const u = pick(rng, c.U);
    const p: LaplaceProblem = {
      seed,
      g,
      u,
      tolerance: c.tolerance,
      final: finalValue(g, u),
      slope: initialSlope(g, u),
      mistakes: [
        { quantity: 'final', value: u * g.K, text: 'Son değerde G(0) yerine yalnız K alınmış: (s + z) ve paydadaki kutuplar s = 0\'da değerlendirilmeli.' },
        { quantity: 'final', value: (u * g.K) / (g.p1 * g.p2), text: 'G(0) hesaplanırken paydaki sıfır (z) unutulmuş.' },
        { quantity: 'final', value: u * g.K * g.z, text: 'G(0) hesaplanırken paydadaki kutuplar (p₁·p₂) unutulmuş.' },
        { quantity: 'slope', value: u * g.K * g.z, text: 'Başlangıç eğimi s → ∞ yerine s = 0 civarında değerlendirilmiş.' },
        { quantity: 'slope', value: (u * g.K * g.z) / (g.p1 * g.p2), text: 'Başlangıç eğimi son değerle karıştırılmış.' },
      ],
    };
    const errors = verifyLaplace(p);
    if (!errors.length) return p;
    reasons.set(errors[0], (reasons.get(errors[0]) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Laplace problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}

export type LaplaceOutcomeKind = Extract<OutcomeKind, 'success' | 'valve_slam' | 'valve_late' | 'sensor_misread'>;

export function classifyLaplace(p: LaplaceProblem, a: LaplaceAnswer): LaplaceOutcomeKind {
  const fOk = rel(a.final, p.final) <= p.tolerance;
  const sOk = rel(a.slope, p.slope) <= p.tolerance;
  if (fOk && sOk) return 'success';
  if (!fOk) return a.final > p.final ? 'valve_slam' : 'valve_late';
  return 'sensor_misread';
}

export function resolveLaplaceOutcome(p: LaplaceProblem, a: LaplaceAnswer): Outcome {
  const kind = classifyLaplace(p, a);
  const read = `Ayar: son basınç ${num(a.final)} bar, ilk artış hızı ${num(a.slope)} bar/s. Gerçek: ${num(p.final)} bar, ${num(p.slope)} bar/s.`;
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : Math.max(a.final / p.final, p.final / a.final, 1.2) };
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Dolum pompası doğru ayarlandı', explanation: `${read} Koruma eşikleri yerinde.` };
    case 'valve_slam':
      return { ...base, headline: 'Koruma eşiği yüksek, kilit aşırı basınçlandı', explanation: `${read} Beklenen son basınç fazla yazıldı; pompa durmadı.` };
    case 'valve_late':
      return { ...base, headline: 'Koruma erken kesti, kilit dolmadı', explanation: `${read} Beklenen son basınç az yazıldı; pompa erken durdu, dış kapı basınç farkıyla açılamadı.` };
    case 'sensor_misread':
      return { ...base, headline: 'Pompa arıza sandı, durdu', explanation: `${read} Başlangıç eğimi yanlış: ilk saniyedeki gerçek artış "kaçak" ya da "tıkanma" sanıldı.` };
  }
}

export function buildLaplaceReport(stageId: string, p: LaplaceProblem, a: LaplaceAnswer, outcome: Outcome): StageResult {
  const { K, z, p1, p2 } = p.g;
  const steps = [
    `Y(s) = G(s)·U/s = ${num(K)}·(s + ${num(z)}) / ((s + ${num(p1)})(s + ${num(p2)})) · ${num(p.u)}/s`,
    `Son değer teoremi (kutuplar sol yarı düzlemde, uygulanabilir): y(∞) = lim s→0 s·Y(s) = U·K·z/(p₁·p₂) = ${num(p.u)}·${num(K)}·${num(z)} / (${num(p1)}·${num(p2)}) = ${num(p.final)} bar`,
    `Başlangıç değeri: y(0⁺) = lim s→∞ s·Y(s) = 0 (paydanın derecesi büyük). Eğim: y′(0⁺) = lim s→∞ s·[s·Y(s) − 0] = lim s·U·G(s) = U·K = ${num(p.slope)} bar/s`,
    `Kontrol: aynı sistem durum uzayında RK4 ile benzetildi; son değer ve ilk eğim teoremlerle aynı (grafik).`,
  ];
  for (const m of p.mistakes) {
    const mine = m.quantity === 'final' ? a.final : a.slope;
    if (rel(mine, m.value) <= p.tolerance) steps.push(`Olası hata: ${m.text}`);
  }
  const tEnd = 6 / Math.min(p1, p2);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `y(∞) = ${num(a.final)} bar, y′(0⁺) = ${num(a.slope)} bar/s`,
    correctLabel: `y(∞) = ${num(p.final)} bar, y′(0⁺) = ${num(p.slope)} bar/s`,
    outcome,
    facts: [
      { label: 'G(s)', value: `${num(K)}(s + ${num(z)}) / ((s + ${num(p1)})(s + ${num(p2)}))` },
      { label: 'Basamak komutu', value: `${num(p.u)}` },
      { label: 'Kabul toleransı', value: `±%${Math.round(p.tolerance * 100)}` },
    ],
    steps,
    plot: {
      caption: 'Kilit basıncı y(t) (RK4 benzetimi); kesikli çizgi: son değer',
      xLabel: 't (s)',
      yLabel: 'y (bar)',
      xScale: 1,
      yScale: 1,
      threshold: p.final,
      series: [{ label: 'gerçek yanıt', kind: 'correct', points: simulateStep(p.g, p.u, tEnd, 300) }],
    },
  };
}
