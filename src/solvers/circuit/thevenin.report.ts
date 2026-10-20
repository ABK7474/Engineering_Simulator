// Olay raporu: eşdeğerin adım adım hesabı (şablonun kapalı formu), gerçek ve modül yük akımı,
// oyuncunun girdisi klasik bir hataya denk geliyorsa açıklaması.

import { formatAmp, formatOhm, formatVolt } from '../../core/format';
import type { Outcome, StageResult } from '../../core/types';
import { fillTemplate } from './design-core';
import { MISTAKE_TEXT } from './thevenin';
import type { TheveninProblem } from './thevenin.generate';
import { asThevenin, judge, type TheveninAnswer } from './thevenin.outcomes';

const fmt = (p: TheveninProblem, a: TheveninAnswer) =>
  p.form === 'thevenin' ? `V_th = ${formatVolt(a.a)}, R_th = ${formatOhm(a.b)}` : `I_N = ${formatAmp(a.a)}, R_N = ${formatOhm(a.b)}`;

export function buildTheveninReport(stageId: string, p: TheveninProblem, ans: TheveninAnswer, outcome: Outcome): StageResult {
  const j = judge(p, ans);
  const emu = asThevenin(p, ans);
  const correct: TheveninAnswer = p.form === 'thevenin' ? { a: p.eq.vth, b: p.eq.rth } : { a: p.eq.isc, b: p.eq.rth };
  const scope = { ...p.scope, Vth: p.eq.vth, Rth: p.eq.rth, In: p.eq.isc, RL: p.rl, IL: p.iLoad };
  const steps = [
    ...p.network.steps.map((s) => fillTemplate(s, scope)),
    p.form === 'norton'
      ? `Norton: I_N = V_th / R_th = ${formatVolt(p.eq.vth)} / ${formatOhm(p.eq.rth)} = ${formatAmp(p.eq.isc)} (uçlar kısa devreyken akan akım), R_N = R_th`
      : `Kontrol: uçlar kısa devre edilince akan akım I_N = V_th / R_th = ${formatAmp(p.eq.isc)}`,
    `Yük kontrolü: I = V_th / (R_th + R_L) = ${formatVolt(p.eq.vth)} / (${formatOhm(p.eq.rth)} + ${formatOhm(p.rl)}) = ${formatAmp(p.iLoad)}`,
  ];
  for (const m of p.mistakes) {
    const mine = m.quantity === 'Vth' ? emu.vth : emu.rth;
    if (Math.abs(mine / m.value - 1) <= p.tolerance) steps.push(`Olası hata: ${MISTAKE_TEXT[m.kind]}`);
  }
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: fmt(p, ans),
    correctLabel: fmt(p, correct),
    outcome,
    facts: [
      { label: 'Yük (R_L)', value: formatOhm(p.rl) },
      { label: 'Gerçek ağın yük akımı', value: formatAmp(p.iLoad) },
      { label: 'Modülün yük akımı', value: formatAmp(j.iEmu) },
      { label: 'Modülün boşta gerilimi', value: formatVolt(emu.vth) },
      { label: 'Kabul toleransı', value: `±%${(p.tolerance * 100).toFixed(0)}` },
    ],
    steps,
  };
}
