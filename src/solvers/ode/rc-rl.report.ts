// Olay raporu: ateşleme anının adım adım hesabı, iki eğri (doğru ve seçilen, RK4) ile eşik ve pencere.

import { formatAmp, formatOhm, formatVolt } from '../../core/format';
import type { Outcome, StageResult } from '../../core/types';
import { crossingClosed, curve, tau, threshold } from './rc-rl';
import type { RcRlProblem } from './rc-rl.generate';
import { fmtTime } from './rc-rl.outcomes';

const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');

export function buildRcRlReport(stageId: string, p: RcRlProblem, cardId: string, outcome: Outcome): StageResult {
  const card = p.bin.find((b) => b.id === cardId)!;
  const answer = p.bin.find((b) => b.r === p.answer)!;
  const tA = crossingClosed(p.params, p.answer)!;
  const tC = crossingClosed(p.params, card.r);
  const q = p.params;
  const steps =
    q.kind === 'rc'
      ? [
          `Diferansiyel denklem: RC·dv/dt + v = Vs, v(0) = V₀ → v(t) = Vs + (V₀ − Vs)·e^(−t/RC)`,
          `v(t) = V_eş anı: t = RC·ln((Vs − V₀)/(Vs − V_eş)) = RC·ln((${formatVolt(q.vs)} − ${formatVolt(q.v0)}) / (${formatVolt(q.vs)} − ${formatVolt(q.vth)})) = RC·${num(Math.log((q.vs - q.v0) / (q.vs - q.vth)))}`,
          `Pencerenin ortası için: R = t / (C·ln(...)) = ${fmtTime((p.tmin + p.tmax) / 2)} / (${num(q.c * 1e6)} µF · ${num(Math.log((q.vs - q.v0) / (q.vs - q.vth)))}) ≈ ${formatOhm((p.tmin + p.tmax) / 2 / (q.c * Math.log((q.vs - q.v0) / (q.vs - q.vth))))}`,
          `Kutuda pencereye düşen tek değer: ${answer.label} → τ = ${fmtTime(tau(q, p.answer))}, t = ${fmtTime(tA)}`,
        ]
      : [
          `Diferansiyel denklem: L·di/dt + R·i = Vs, i(0) = I₀ → i(t) = I∞ + (I₀ − I∞)·e^(−tR/L), I∞ = Vs/R`,
          `Çekme akımına varış: t = (L/R)·ln((I∞ − I₀)/(I∞ − I_eş)); I_eş ≥ I∞ ise valf hiç ateşlemez. R hem τ'da hem I∞'da: her adayı tek tek dene.`,
          `${answer.label}: I∞ = ${formatAmp(q.vs / p.answer)}, τ = ${fmtTime(tau(q, p.answer))}, t = ${fmtTime(tA)} (pencere içinde)`,
        ];
  if (card.r !== p.answer) {
    steps.push(tC === null ? `${card.label}: I∞ = ${formatAmp(q.vs / card.r)} < I_eş — eşiğe hiç ulaşılmaz.` : `${card.label}: τ = ${fmtTime(tau(q, card.r))}, t = ${fmtTime(tC)} (pencere dışında)`);
    if (card.mistake) steps.push(`Olası hata: ${card.mistake}`);
  }
  steps.push('Kontrol: aynı denklem RK4 ile sayısal olarak çözüldü; ateşleme anı kapalı formla %0,1 içinde aynı (grafikteki eğriler RK4).');
  const tEnd = Math.max(p.tmax * 1.5, (tC ?? 0) * 1.15, tA * 1.5);
  const ry = q.kind === 'rc' ? 1 : 1000;
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `${card.label} → ${tC === null ? 'ateşleme yok' : fmtTime(tC)}`,
    correctLabel: `${answer.label} → ${fmtTime(tA)}`,
    outcome,
    facts:
      q.kind === 'rc'
        ? [
            { label: 'Kaynak', value: formatVolt(q.vs) },
            { label: 'Kondansatör', value: `${num(q.c * 1e6)} µF, V₀ = ${formatVolt(q.v0)}` },
            { label: 'Eşik', value: formatVolt(q.vth) },
            { label: 'Pencere', value: `${fmtTime(p.tmin)} – ${fmtTime(p.tmax)}` },
          ]
        : [
            { label: 'Kaynak', value: formatVolt(q.vs) },
            { label: 'Bobin', value: `${num(q.l * 1000)} mH, I₀ = ${formatAmp(q.i0)}` },
            { label: 'Çekme akımı', value: formatAmp(q.ith) },
            { label: 'Pencere', value: `${fmtTime(p.tmin)} – ${fmtTime(p.tmax)}` },
          ],
    steps,
    plot: {
      caption: q.kind === 'rc' ? 'Kondansatör gerilimi (RK4)' : 'Bobin akımı (RK4)',
      xLabel: tEnd >= 1 ? 't (s)' : 't (ms)',
      yLabel: q.kind === 'rc' ? 'v (V)' : 'i (mA)',
      xScale: tEnd >= 1 ? 1 : 1000,
      yScale: ry,
      threshold: threshold(q),
      window: [p.tmin, p.tmax],
      series: [
        { label: `doğru: ${answer.label}`, kind: 'correct', points: curve(q, p.answer, tEnd) },
        ...(card.r !== p.answer ? [{ label: `seçilen: ${card.label}`, kind: 'chosen' as const, points: curve(q, card.r, tEnd) }] : []),
      ],
    },
  };
}
