// Sonuç fizikten: seçilen amortisörle kapının yanıtı (kapalı form; RK4 ile doğrulanmış). Az sönüm → kapı
// aşar ve çarpar; fazla sönüm → kapı geç kapanır, kilitte basınç kaçar. Rapor: ω_n, k, kritik c, iki eğri.

import { formatSec } from '../../core/format';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { metricsClosed, sampleClosed, zetaOf } from './damping';
import { door, fmtDamper, type DampingProblem } from './damping.generate';

export type DampingOutcomeKind = Extract<OutcomeKind, 'success' | 'valve_slam' | 'valve_late'>;

const num = (x: number, d = 3) => String(Number(x.toPrecision(d))).replace('.', ',');

export function classifyDamping(p: DampingProblem, c: number): DampingOutcomeKind {
  const z = zetaOf(door(p, c));
  if (z < p.zeta[0]) return 'valve_slam';
  if (z > p.zeta[1]) return 'valve_late';
  return 'success';
}

export function resolveDampingOutcome(p: DampingProblem, cardId: string): Outcome {
  const card = p.bin.find((b) => b.id === cardId);
  if (!card) throw new Error(`Geçersiz seçim: ${cardId}`);
  const kind = classifyDamping(p, card.c);
  const d = door(p, card.c);
  const z = zetaOf(d);
  const m = metricsClosed(d);
  const read = `${card.label}: ζ = ${num(z)}, aşma %${num(m.overshoot * 100, 2)}, %2 bandına oturma ${formatSec(m.settling)}.`;
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : Math.max(z / p.zeta[1], p.zeta[0] / z) };
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Dış kapı yumuşak ve hızlı kapandı', explanation: `${read} Kritik sönüme yakın: salınım yok, gecikme yok.` };
    case 'valve_slam':
      return { ...base, headline: 'Kapı salındı ve çarptı', explanation: `${read} Sönüm az: kapı hedefi aşıp contaya çarptı.` };
    case 'valve_late':
      return { ...base, headline: 'Kapı geç kapandı, basınç kaçağı', explanation: `${read} Sönüm fazla: kapı hedefe sürünerek yaklaştı, arada su sızdı.` };
  }
}

export function buildDampingReport(stageId: string, p: DampingProblem, cardId: string, outcome: Outcome): StageResult {
  const card = p.bin.find((b) => b.id === cardId)!;
  const answer = p.bin.find((b) => b.c === p.answer)!;
  const h = p.hand;
  const steps = [
    `Serbest salınım: ω_n = 2π / T₀ = 2π / ${formatSec(p.t0)} = ${num(h.wn)} rad/s → k = m·ω_n² = ${num(p.m)} kg · ${num(h.wn)}² = ${num(h.k)} N/m`,
    `m·x″ + c·x′ + k·x = k·x_h; sönüm oranı ζ = c / (2·√(m·k)) = c / (2·m·ω_n). Kritik sönüm (ζ = 1): c = 2·m·ω_n = ${fmtDamper(h.cCrit)}`,
    `ζ penceresi ${num(p.zeta[0])}–${num(p.zeta[1])} → ${fmtDamper(h.cLo)} ≤ c ≤ ${fmtDamper(h.cHi)}; katalogda tek değer: ${answer.label}`,
    `Kontrol: kapı yanıtı kapalı formla ve RK4 ile ayrı ayrı çözüldü; aşma ve oturma süresi aynı (grafik).`,
  ];
  if (card.mistake && card.c !== p.answer) steps.push(`Olası hata: ${card.mistake}`);
  const dRight = door(p, p.answer);
  const dChosen = door(p, card.c);
  const tEnd = Math.min(Math.max(metricsClosed(dRight).settling, metricsClosed(dChosen).settling) * 1.6, 60);
  const cut = (pts: [number, number][]) => pts.filter(([t]) => t <= tEnd).filter((_, k) => k % 8 === 0);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `${card.label} (ζ = ${num(zetaOf(dChosen))})`,
    correctLabel: `${answer.label} (ζ = ${num(zetaOf(dRight))})`,
    outcome,
    facts: [
      { label: 'Kapı kütlesi', value: `${num(p.m)} kg` },
      { label: 'Serbest periyot T₀', value: formatSec(p.t0) },
      { label: 'İstenen ζ', value: `${num(p.zeta[0])}–${num(p.zeta[1])}` },
    ],
    steps,
    plot: {
      caption: 'Kapı konumu (hedef = 1; kapalı form, RK4 ile doğrulanmış)',
      xLabel: 't (s)',
      yLabel: 'x / x_h',
      xScale: 1,
      yScale: 1,
      band: [0.98, 1.02],
      series: [
        { label: `doğru: ${answer.label}`, kind: 'correct', points: cut(sampleClosed(dRight)) },
        ...(card.c !== p.answer ? [{ label: `seçilen: ${card.label}`, kind: 'chosen' as const, points: cut(sampleClosed(dChosen)) }] : []),
      ],
    },
  };
}
