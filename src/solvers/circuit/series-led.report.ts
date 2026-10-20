// Olay raporu şablonu: seçilen direnç için çözücünün hesabını adım adım yazar.

import { formatAmp, formatOhm, formatVolt, formatWatt } from '../../core/format';
import type { Outcome, StageResult } from '../../core/types';
import { solveSeriesLed } from './series-led';
import type { SeriesLedProblem } from './series-led.generate';

export function buildSeriesLedReport(
  stageId: string,
  p: SeriesLedProblem,
  chosenId: string,
  outcome: Outcome,
): StageResult {
  const { spec } = p;
  const vf = spec.led.model.vf;
  const chosen = p.choices.find((c) => c.id === chosenId);
  const correct = p.choices.find((c) => c.id === p.correctId);
  if (!chosen || !correct) throw new Error('Rapor: seçenek bulunamadı');
  const sol = solveSeriesLed(spec.vs, spec.led.model, chosen.r);
  const vR = spec.vs - vf;
  const rLo = vR / spec.targetMax;
  const rHi = vR / spec.targetMin;
  const correctSol = solveSeriesLed(spec.vs, spec.led.model, correct.r);

  const steps = [
    `Seri devrede tek akım vardır. KVL: Vs = I·R + Vf`,
    `Seçilen ${chosen.label} için: I = (Vs − Vf) / R = (${formatVolt(spec.vs)} − ${formatVolt(vf)}) / ${chosen.label} = ${formatAmp(sol.current)}`,
    `Direncin harcadığı güç: P = I²·R = ${formatWatt(sol.pResistor)} (anma: ${formatWatt(spec.resistorRating)})`,
    `Ters yönden: hedef ${formatAmp(spec.targetMin)} – ${formatAmp(spec.targetMax)} için R = (Vs − Vf) / I → ${formatOhm(rLo)} ≤ R ≤ ${formatOhm(rHi)}`,
    `Kutuda bu aralıkta tek değer var: ${correct.label} → I = ${formatAmp(correctSol.current)}, P = ${formatWatt(correctSol.pResistor)}`,
  ];
  if (chosen.mistake && chosen.id !== p.correctId) steps.push(`Olası hata: ${chosen.mistake}`);

  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: chosen.label,
    correctLabel: correct.label,
    outcome,
    facts: [
      { label: 'Kaynak gerilimi', value: formatVolt(spec.vs) },
      { label: `LED (${spec.led.color}) Vf`, value: formatVolt(vf) },
      { label: 'Takılan direnç', value: chosen.label },
      { label: 'Devre akımı', value: formatAmp(sol.current) },
      { label: 'Direnç gerilimi', value: formatVolt(sol.vResistor) },
      { label: 'Direnç gücü', value: formatWatt(sol.pResistor) },
      { label: 'LED gücü', value: formatWatt(sol.pLed) },
    ],
    steps,
  };
}
