// Fazör üretici + doğrulayıcı + sonuç + rapor. Klasik hatalar (genlikleri doğrudan toplamak, fazların ortalaması,
// farkı almak) doğru cevaptan açıkça ayrışmalı; karmaşık toplam ile örnekleme uyuşmalı.

import { createRng, pick } from '../../core/rng';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { angleDiff, sumBySampling, sumPhasor, wrapDeg, type PhasorConfig, type Wave } from './phasor';

export const MAX_ATTEMPTS = 200;

export interface PhasorProblem {
  seed: number;
  w1: Wave;
  w2: Wave;
  sum: Wave;
  ampTol: number;
  phaseTol: number;
  mistakes: { a: number; phi: number; text: string }[];
}

export interface PhasorAnswer {
  a: number;
  phi: number;
}

const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',').replace(/^-/, '−');

export const accepted = (p: PhasorProblem, x: PhasorAnswer) => Math.abs(x.a / p.sum.a - 1) <= p.ampTol && angleDiff(x.phi, p.sum.phi) <= p.phaseTol;

export function verifyPhasor(p: PhasorProblem): string[] {
  const errors: string[] = [];
  const s = sumBySampling(p.w1, p.w2);
  if (Math.abs(s.a / p.sum.a - 1) > 1e-6 || angleDiff(s.phi, p.sum.phi) > 0.02) errors.push('karmaşık toplam örneklemeyle uyuşmuyor');
  if (p.sum.a < 0.15 * Math.max(p.w1.a, p.w2.a)) errors.push('sinyaller neredeyse birbirini götürüyor (faz kararsız)');
  if (Math.abs(wrapDeg(p.w1.phi - p.w2.phi)) < 20) errors.push('fazlar çok yakın (toplam önemsiz)');
  for (const m of p.mistakes) if (accepted(p, m)) errors.push(`hata kabul ediliyor: ${m.text.slice(0, 30)}…`);
  return errors;
}

export function generatePhasor(c: PhasorConfig, seed: number): PhasorProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const w1: Wave = { a: pick(rng, c.amp), phi: pick(rng, c.phase) };
    const w2: Wave = { a: pick(rng, c.amp), phi: pick(rng, c.phase) };
    const sum = sumPhasor(w1, w2);
    const p: PhasorProblem = {
      seed,
      w1,
      w2,
      sum,
      ampTol: c.ampTol,
      phaseTol: c.phaseTol,
      mistakes: [
        { a: w1.a + w2.a, phi: wrapDeg((w1.phi + w2.phi) / 2), text: 'Genlikler doğrudan toplanmış ve fazların ortalaması alınmış; aynı fazda değillerse fazörler vektör gibi toplanır.' },
        { a: Math.abs(w1.a - w2.a), phi: w1.a >= w2.a ? w1.phi : w2.phi, text: 'Sinyaller tam ters fazdaymış gibi genlikler çıkarılmış.' },
        { a: Math.sqrt(w1.a ** 2 + w2.a ** 2), phi: wrapDeg((w1.phi + w2.phi) / 2), text: 'Fazörler dik sanılmış (√(A₁² + A₂²)); aradaki açı hesaba katılmalı.' },
      ],
    };
    const errors = verifyPhasor(p);
    if (!errors.length) return p;
    reasons.set(errors[0], (reasons.get(errors[0]) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Fazör problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}

export type PhasorOutcomeKind = Extract<OutcomeKind, 'success' | 'sensor_misread'>;

export function resolvePhasorOutcome(p: PhasorProblem, x: PhasorAnswer): Outcome {
  const ok = accepted(p, x);
  const kind: PhasorOutcomeKind = ok ? 'success' : 'sensor_misread';
  const read = `Girilen: ${num(x.a)} mV ∠ ${num(x.phi)}°; gerçek toplam: ${num(p.sum.a)} mV ∠ ${num(p.sum.phi)}°.`;
  return ok
    ? { kind, severity: 0, resistorOverheat: false, headline: 'Hidrofonlar eşlendi', explanation: `${read} Sonar hedef yönünü doğru hesaplıyor.` }
    : { kind, severity: 1 + Math.abs(x.a / p.sum.a - 1) * 3 + angleDiff(x.phi, p.sum.phi) / 30, resistorOverheat: false, headline: 'Hedef yönü yanlış hesaplandı', explanation: `${read} Sonar yankıyı yanlış yerde gösteriyor.` };
}

export function buildPhasorReport(stageId: string, p: PhasorProblem, x: PhasorAnswer, outcome: Outcome): StageResult {
  const c = (w: Wave) => [w.a * Math.cos((w.phi * Math.PI) / 180), w.a * Math.sin((w.phi * Math.PI) / 180)];
  const [r1, i1] = c(p.w1);
  const [r2, i2] = c(p.w2);
  const steps = [
    `Aynı frekanstaki sinüsler fazörle toplanır: A∠φ = A₁∠φ₁ + A₂∠φ₂ (karmaşık sayı toplamı)`,
    `A₁∠φ₁ = ${num(p.w1.a)}∠${num(p.w1.phi)}° = ${num(r1)} + ${num(i1)}j · A₂∠φ₂ = ${num(p.w2.a)}∠${num(p.w2.phi)}° = ${num(r2)} + ${num(i2)}j`,
    `Toplam = ${num(r1 + r2)} + ${num(i1 + i2)}j → A = √(re² + im²) = ${num(p.sum.a)} mV, φ = atan2(im, re) = ${num(p.sum.phi)}°`,
    `Kontrol: toplam sinyal bir periyot boyunca örneklendi; tepe değeri ve tepe anından bulunan faz aynı.`,
  ];
  for (const m of p.mistakes) if (Math.abs(x.a / m.a - 1) <= p.ampTol && angleDiff(x.phi, m.phi) <= p.phaseTol) steps.push(`Olası hata: ${m.text}`);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `${num(x.a)} mV ∠ ${num(x.phi)}°`,
    correctLabel: `${num(p.sum.a)} mV ∠ ${num(p.sum.phi)}°`,
    outcome,
    facts: [
      { label: 'Hidrofon 1', value: `${num(p.w1.a)} mV ∠ ${num(p.w1.phi)}°` },
      { label: 'Hidrofon 2', value: `${num(p.w2.a)} mV ∠ ${num(p.w2.phi)}°` },
      { label: 'Kabul', value: `genlik ±%${Math.round(p.ampTol * 100)}, faz ±${p.phaseTol}°` },
    ],
    steps,
  };
}
