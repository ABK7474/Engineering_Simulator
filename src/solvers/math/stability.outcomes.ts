// Sonuç fizikten: seçilen kazançla özdeğerler. Kararsız ya da salınımlı → basınç dalgalanır, kapı contası
// zorlanır; yavaş → basınç geç toparlanır, kilit su alır. Rapor: iz, det, kökler; benzetim grafiği.

import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { eigen, response } from './stability';
import { fmtK, meetsSpec, type StabilityProblem } from './stability.generate';

export type StabilityOutcomeKind = Extract<OutcomeKind, 'success' | 'valve_slam' | 'valve_late'>;

const num = (x: number, d = 3) => String(Number(x.toPrecision(d))).replace('.', ',').replace(/^-/, '−');
export const fmtRoot = ([re, im]: [number, number]) => (Math.abs(im) < 1e-12 ? num(re) : `${num(re)} ${im > 0 ? '+' : '−'} ${num(Math.abs(im))}j`);

export function classifyStability(p: StabilityProblem, k: number): StabilityOutcomeKind {
  const m = meetsSpec(p, k);
  if (!m.stable || !m.damped) return 'valve_slam';
  if (!m.fast) return 'valve_late';
  return 'success';
}

export function resolveStabilityOutcome(p: StabilityProblem, cardId: string): Outcome {
  const card = p.bin.find((b) => b.id === cardId);
  if (!card) throw new Error(`Geçersiz seçim: ${cardId}`);
  const kind = classifyStability(p, card.k);
  const e = eigen(p.plant, card.k);
  const read = `${card.label}: özdeğerler ${e.roots.map(fmtRoot).join(', ')}; en yavaş sönüm σ = ${num(-e.maxRe)} 1/s (şart ≥ ${num(p.sigmaMin)}), ζ = ${num(e.zeta)} (şart ≥ ${num(p.zetaMin)}).`;
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : e.maxRe >= 0 ? 3 : 1.5 };
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Basınç denetleyicisi kararlı', explanation: `${read} Sapma hızlı ve salınımsız sönüyor.` };
    case 'valve_slam':
      return { ...base, headline: e.maxRe >= 0 ? 'Basınç kaçtı' : 'Basınç salınıyor', explanation: `${read} ${e.maxRe >= 0 ? 'Bir özdeğer sağ yarı düzlemde: sapma büyüdü.' : 'Kökler fazla sanal: basınç ileri geri sallandı, conta zorlandı.'}` };
    case 'valve_late':
      return { ...base, headline: 'Basınç geç toparlandı', explanation: `${read} En yavaş kök sıfıra çok yakın.` };
  }
}

export function buildStabilityReport(stageId: string, p: StabilityProblem, cardId: string, outcome: Outcome): StageResult {
  const card = p.bin.find((b) => b.id === cardId)!;
  const { a, b, c } = p.plant;
  const steps = [
    `A = [[a, b], [−k, −c]] = [[${num(a)}, ${num(b)}], [−k, −${num(c)}]]. det(λI − A) = λ² − (a − c)λ + (b·k − a·c) = 0`,
    `Kararlılık için iz < 0 (a − c = ${num(a - c)}) ve det > 0: k > a·c/b = ${num((a * c) / b)}`,
    `Kökler karmaşık olmaya başladığı sınır: (a − c)² = 4(b·k − a·c) → k = (a + c)²/(4b) = ${num((a + c) ** 2 / (4 * b))}. Bunun altında kökler reel (ζ = 1) ve en yavaşı k küçüldükçe sıfıra yaklaşır; üstünde reel kısım (a − c)/2 sabit, salınım artar.`,
    `Kazançlar: ${p.bin.map((g) => `k = ${fmtK(g.k)} → ${eigen(p.plant, g.k).roots.map(fmtRoot).join(', ')}`).join(' · ')}`,
    `Şartları (σ ≥ ${num(p.sigmaMin)}, ζ ≥ ${num(p.zetaMin)}) yalnız k = ${fmtK(p.answer)} sağlar. Kontrol: benzetimden ölçülen sönüm hızı özdeğerle aynı.`,
  ];
  if (card.mistake && card.k !== p.answer) steps.push(`Olası hata: ${card.mistake}`);
  const tEnd = Math.min(20, 8 / Math.max(p.sigmaMin, 0.1));
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: card.label,
    correctLabel: `k = ${fmtK(p.answer)}`,
    outcome,
    facts: [
      { label: 'Sistem', value: `a = ${num(a)}, b = ${num(b)}, c = ${num(c)}` },
      { label: 'Şartlar', value: `σ ≥ ${num(p.sigmaMin)} 1/s, ζ ≥ ${num(p.zetaMin)}` },
    ],
    steps,
    plot: {
      caption: 'Basınç sapması x₁(t) (RK4 benzetimi)',
      xLabel: 't (s)',
      yLabel: 'x₁',
      xScale: 1,
      yScale: 1,
      threshold: 0,
      series: [
        { label: `doğru: k = ${fmtK(p.answer)}`, kind: 'correct', points: response(p.plant, p.answer, tEnd) },
        ...(card.k !== p.answer ? [{ label: `seçilen: ${card.label}`, kind: 'chosen' as const, points: response(p.plant, card.k, tEnd).map(([t, x]): [number, number] => [t, Math.max(-3, Math.min(3, x))]) }] : []),
      ],
    },
  };
}
