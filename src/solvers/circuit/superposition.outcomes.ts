// Sonuç fizikten: yedek jeneratör oyuncunun girdiği değere ayarlanır; yük, bilinen katkı + birim katkı × girilen
// değer kadar yanıt alır (MNA katsayıları). Gerçek yanıta oranla az → motor zayıf/dönmez, fazla → ısınır/yanar,
// işaret dönerse motor ters zorlanır. Rapor: katkılar adım adım.

import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { fillTemplate, formatUnit } from './design-core';
import { SUPER_MISTAKE_TEXT, type SuperProblem } from './superposition.generate';

export type SuperOutcomeKind = Extract<OutcomeKind, 'success' | 'motor_stall' | 'motor_slow' | 'motor_overheat' | 'motor_burnt'>;

const unknownUnit = (p: SuperProblem) => p.network.params[p.network.unknown].unit;

export function classifySuper(p: SuperProblem, value: number): { kind: SuperOutcomeKind; ratio: number } {
  const resp = p.known + p.perUnit * value;
  const ratio = resp / p.measured;
  if (Math.abs(value / p.answer - 1) <= p.tolerance) return { kind: 'success', ratio };
  if (ratio < 0.5) return { kind: 'motor_stall', ratio };
  if (ratio < 1) return { kind: 'motor_slow', ratio };
  if (ratio >= 1.5) return { kind: 'motor_burnt', ratio };
  return { kind: 'motor_overheat', ratio };
}

export function resolveSuperOutcome(p: SuperProblem, value: number): Outcome {
  const { kind, ratio } = classifySuper(p, value);
  const u = p.network.probeUnit;
  const got = formatUnit(p.known + p.perUnit * value, u);
  const want = formatUnit(p.measured, u);
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : ratio > 0 ? Math.max(ratio, 1 / ratio) : 3 };
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Yedek jeneratör eşlendi', explanation: `${p.network.probeLabel}: ${got} (kayıttaki ${want}). Pompa eski düzeninde çalışıyor.` };
    case 'motor_stall':
      return { ...base, headline: ratio < 0 ? 'Akım ters döndü, pompa kilitlendi' : 'Pompa dönmedi', explanation: `${p.network.probeLabel} ${got} oldu, olması gereken ${want}. ${ratio < 0 ? 'Katkılar birbirini aştı, yük ters yönde zorlandı.' : 'Yük kalkış için yeterli besleme alamadı.'}` };
    case 'motor_slow':
      return { ...base, headline: 'Pompa zayıf çalışıyor', explanation: `${p.network.probeLabel} ${got}, olması gereken ${want}.` };
    case 'motor_overheat':
      return { ...base, headline: 'Motor ısındı, termik koruma', explanation: `${p.network.probeLabel} ${got}, olması gereken ${want}. Fazla besleme sargıyı ısıttı.` };
    case 'motor_burnt':
      return { ...base, headline: 'Motor sargısı yandı', explanation: `${p.network.probeLabel} ${got}: gerekenin ${ratio.toFixed(1)} katı.` };
  }
}

export function buildSuperReport(stageId: string, p: SuperProblem, value: number, outcome: Outcome): StageResult {
  const uu = unknownUnit(p);
  const scope = { ...p.scope, [p.network.unknown]: p.answer };
  const steps = [
    ...p.network.steps.map((s) => fillTemplate(s, scope)),
    `Kontrol (MNA): bilinen kaynağın katkısı ${formatUnit(p.known, p.network.probeUnit)}, bilinmeyenin birim başına katkısı ${formatUnit(p.perUnit, p.network.probeUnit)}/${uu}; toplam ${formatUnit(p.known + p.perUnit * p.answer, p.network.probeUnit)}.`,
  ];
  for (const m of p.mistakes) if (Math.abs(value / m.value - 1) <= p.tolerance) steps.push(`Olası hata: ${SUPER_MISTAKE_TEXT[m.kind]}`);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: formatUnit(value, uu),
    correctLabel: formatUnit(p.answer, uu),
    outcome,
    facts: [
      { label: p.network.probeLabel, value: formatUnit(p.measured, p.network.probeUnit) },
      { label: 'Senin değerinle yanıt', value: formatUnit(p.known + p.perUnit * value, p.network.probeUnit) },
      { label: 'Kabul toleransı', value: `±%${Math.round(p.tolerance * 100)}` },
    ],
    steps,
  };
}
