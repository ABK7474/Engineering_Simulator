// Sonuç fizikten: seçilen dirençle devrenin çalışma noktası (Newton). Az akım → LED sönük/kör,
// fazla → zorlanır, mutlak sınırı aşarsa yanar. Rapor: katalogdan eğim, diyot gerilimi, direnç.

import { formatAmp, formatOhm, formatVolt } from '../../core/format';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { VT } from './diode';
import { fmtSlope, operatingCurrent, type DiodeProblem } from './diode.generate';

export type DiodeOutcomeKind = Extract<OutcomeKind, 'success' | 'no_light' | 'dim' | 'led_stressed' | 'led_burnt'>;

export function classifyDiode(p: DiodeProblem, r: number): DiodeOutcomeKind {
  const i = operatingCurrent(p, r);
  if (i > p.absMax) return 'led_burnt';
  if (i > p.target * (1 + p.tolerance)) return 'led_stressed';
  if (i < p.target * 0.5) return 'no_light';
  if (i < p.target * (1 - p.tolerance)) return 'dim';
  return 'success';
}

export function resolveDiodeOutcome(p: DiodeProblem, cardId: string): Outcome {
  const card = p.bin.find((b) => b.id === cardId);
  if (!card) throw new Error(`Geçersiz seçim: ${cardId}`);
  const kind = classifyDiode(p, card.r);
  const i = operatingCurrent(p, card.r);
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : Math.max(i / p.target, p.target / i) };
  const win = `${formatAmp(p.target * (1 - p.tolerance))} – ${formatAmp(p.target * (1 + p.tolerance))}`;
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Sensör LED\'i doğru akımda', explanation: `${card.label} ile ${formatAmp(i)}; pencere ${win}. Optik devir sensörü görüyor.` };
    case 'no_light':
      return { ...base, headline: 'LED neredeyse sönük, sensör kör', explanation: `${card.label} ile yalnız ${formatAmp(i)} (pencere ${win}).` };
    case 'dim':
      return { ...base, headline: 'LED sönük, sensör menzili kısa', explanation: `${card.label} ile ${formatAmp(i)}, pencerenin altında (${win}).` };
    case 'led_stressed':
      return { ...base, headline: 'LED zorlanıyor, sürücü kesti', explanation: `${card.label} ile ${formatAmp(i)}, pencerenin üstünde (${win}).` };
    case 'led_burnt':
      return { ...base, headline: 'LED yandı', explanation: `${card.label} ile ${formatAmp(i)}; mutlak sınır ${formatAmp(p.absMax)}.` };
  }
}

export function buildDiodeReport(stageId: string, p: DiodeProblem, cardId: string, outcome: Outcome): StageResult {
  const card = p.bin.find((b) => b.id === cardId)!;
  const answer = p.bin.find((b) => b.r === p.answer)!;
  const [a, b] = p.points;
  const steps = [
    `Shockley: V = n·V_T·ln(I/Iₛ + 1) ≈ n·V_T·ln(I/Iₛ). İki katalog noktasından eğim: n·V_T = (V₁ − V₂) / ln(I₁/I₂) = (${formatVolt(a.v)} − ${formatVolt(b.v)}) / ln(${formatAmp(a.i)}/${formatAmp(b.i)}) = ${fmtSlope(p.hand.slope)}`,
    `Hedef akımda diyot gerilimi: V_D = V₁ + n·V_T·ln(I*/I₁) = ${formatVolt(a.v)} + ${fmtSlope(p.hand.slope)}·ln(${formatAmp(p.target)}/${formatAmp(a.i)}) = ${formatVolt(p.hand.vd)}`,
    `KVL: R = (Vs − V_D) / I* = (${formatVolt(p.vs)} − ${formatVolt(p.hand.vd)}) / ${formatAmp(p.target)} = ${formatOhm(p.hand.r)} → kutuda en yakın ${answer.label}`,
    `Kontrol: devre Newton yöntemiyle ve ikiye bölmeyle ayrı ayrı çözüldü; ${answer.label} ile çalışma noktası ${formatAmp(operatingCurrent(p, p.answer))}. (Bu diyotta n = ${String(p.diode.n).replace('.', ',')}, n·V_T = ${fmtSlope(p.diode.n * VT)}.)`,
  ];
  if (card.mistake && card.r !== p.answer) steps.push(`Olası hata: ${card.mistake}`);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `${card.label} → ${formatAmp(operatingCurrent(p, card.r))}`,
    correctLabel: `${answer.label} → ${formatAmp(operatingCurrent(p, p.answer))}`,
    outcome,
    facts: [
      { label: 'Kaynak', value: formatVolt(p.vs) },
      { label: 'Hedef akım', value: `${formatAmp(p.target)} ±%${Math.round(p.tolerance * 100)}` },
      { label: 'Katalog', value: `${formatAmp(a.i)} → ${formatVolt(a.v)}; ${formatAmp(b.i)} → ${formatVolt(b.v)}` },
    ],
    steps,
  };
}
