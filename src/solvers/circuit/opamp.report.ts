// Olay raporu: gösterilen sayılardan kazanç ve ofset, oranlar, yerleşimin iki uçtaki çıkışı.

import { formatOhm, formatVolt } from '../../core/format';
import type { Outcome, StageResult } from '../../core/types';
import { SLOTS } from './opamp';
import type { OpampProblem } from './opamp.generate';
import { readings, resistorsOf } from './opamp.outcomes';

const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');

export function buildOpampReport(stageId: string, p: OpampProblem, placement: Record<string, string>, outcome: Outcome): StageResult {
  const slots = SLOTS[p.variant];
  const r = resistorsOf(p, placement);
  const x = readings(p, r);
  const right = readings(p, p.answer);
  const s = p.scope;
  const steps = [
    `Kazanç (eğim): G = (Y_hi − Y_lo) / (V_hi − V_lo) = (${formatVolt(p.yhi)} − ${formatVolt(p.ylo)}) / (${formatVolt(p.vhi)} − ${formatVolt(p.vlo)}) = ${num(s.G)}`,
    ...(p.variant === 'gain'
      ? [`Evirmeyen yükselteç: G = 1 + Rf/Rg → Rf/Rg = G − 1 = ${num(s.ratioFg)}`]
      : [
          `Ofset: b = Y_lo − G·V_lo = ${formatVolt(p.ylo)} − ${num(s.G)}·${formatVolt(p.vlo)} = ${formatVolt(s.b)}`,
          `(−) girişte KCL: V_out = V_s·(1 + Rf/Rg + Rf/Rr) − V_ref·Rf/Rr → Rf/Rr = −b / V_ref = ${num(s.ratioFr)}`,
          `Rf/Rg = G − 1 − Rf/Rr = ${num(s.G)} − 1 − ${num(s.ratioFr)} = ${num(s.ratioFg)}`,
        ]),
    `Kutuda bu oranları ±%${Math.round(p.tolerance * 100)} içinde veren tek yerleşim: ${slots.map((k) => `${k} = ${formatOhm(p.answer[k])}`).join(', ')} → çıkış ${formatVolt(right.lo)} … ${formatVolt(right.hi)}`,
  ];
  for (const k of slots) {
    const card = p.bin.find((b) => b.id === placement[k])!;
    if (card.mistake && card.r !== p.answer[k]) steps.push(`Olası hata (${k} = ${card.label}): ${card.mistake}`);
  }
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: slots.map((k) => `${k} = ${formatOhm(r[k as 'Rf']!)}`).join(', '),
    correctLabel: slots.map((k) => `${k} = ${formatOhm(p.answer[k])}`).join(', '),
    outcome,
    facts: [
      { label: 'Sensör aralığı', value: `${formatVolt(p.vlo)} … ${formatVolt(p.vhi)}` },
      { label: 'Hedef ADC aralığı', value: `${formatVolt(p.ylo)} … ${formatVolt(p.yhi)}` },
      { label: 'Senin çıkışın (ideal)', value: `${formatVolt(x.lo)} … ${formatVolt(x.hi)}` },
      { label: 'Besleme rayları', value: `0 … ${formatVolt(p.vcc)}` },
      ...(p.variant === 'offset' ? [{ label: 'V_ref', value: formatVolt(p.vref) }] : []),
    ],
    steps,
  };
}
