// Olay raporu: iki yük testinden R_th ve V_th, en büyük güç; kutudaki her değer için güç oranı tablosu.

import { formatOhm, formatWatt } from '../../core/format';
import type { Outcome, StageResult } from '../../core/types';
import { fillTemplate } from './design-core';
import type { MaxPowerConfig } from './max-power';
import type { MaxPowerProblem } from './max-power.generate';
import { judgeLoad } from './max-power.outcomes';

export function buildMaxPowerReport(stageId: string, c: MaxPowerConfig, p: MaxPowerProblem, cardId: string, outcome: Outcome): StageResult {
  const card = p.bin.find((b) => b.id === cardId)!;
  const answer = p.bin.find((b) => b.r === p.answer)!;
  const steps = c.steps.map((s) => fillTemplate(s, { ...p.scope, R: p.answer }));
  if (card.decoy && card.r !== p.answer) steps.push(`Olası hata: ${card.decoy}`);
  const rows = [...p.bin].sort((a, b) => a.r - b.r);
  const j = judgeLoad(p, card.r);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: card.label,
    correctLabel: answer.label,
    outcome,
    facts: [
      { label: 'Kara kutu V_th (gerçek)', value: `${p.vth.toString().replace('.', ',')} V` },
      { label: 'Kara kutu R_th (gerçek)', value: formatOhm(p.rth) },
      { label: 'En büyük güç', value: formatWatt(p.pmax) },
      { label: 'Seçilen yükün gücü', value: `${formatWatt(j.power)} (%${(j.ratio * 100).toFixed(1)})` },
    ],
    steps,
    table: {
      caption: 'Kutudaki yükler: P / P_max = 4x / (1 + x)², x = R / R_th',
      head: ['R', 'x', 'P', 'P / P_max'],
      rows: rows.map((b) => {
        const q = judgeLoad(p, b.r);
        return [b.label, q.x.toFixed(2).replace('.', ','), formatWatt(q.power), `%${(q.ratio * 100).toFixed(1)}`];
      }),
      good: rows.findIndex((b) => b.r === p.answer),
      chosen: rows.findIndex((b) => b.id === cardId),
    },
  };
}
