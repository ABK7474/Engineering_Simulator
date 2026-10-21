// Sonuç fizikten: seçilen R ile kesim frekansı ve iki frekanstaki kazanç. Sinyal fazla zayıflarsa sonar
// yankıyı duyamaz (verici zayıf); gürültü yeterince bastırılmazsa gürültü yankı sanılır (sensör yanlış okur).

import { formatFarad, formatHenry, formatHz, formatOhm } from '../../core/format';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { cutoff, gainClosed, toDb } from './filter';
import { meets, type FilterProblem } from './filter.generate';

export type FilterOutcomeKind = Extract<OutcomeKind, 'success' | 'signal_weak' | 'sensor_misread'>;

export const fmtDb = (db: number) => `${db.toFixed(2).replace('.', ',').replace('-', '−')} dB`;

export function classifyFilter(p: FilterProblem, r: number): FilterOutcomeKind {
  const m = meets(p, r);
  if (!m.signal) return 'signal_weak';
  if (!m.noise) return 'sensor_misread';
  return 'success';
}

export function resolveFilterOutcome(p: FilterProblem, cardId: string): Outcome {
  const card = p.bin.find((b) => b.id === cardId);
  if (!card) throw new Error(`Geçersiz seçim: ${cardId}`);
  const kind = classifyFilter(p, card.r);
  const m = meets(p, card.r);
  const fc = formatHz(cutoff(p.parts, card.r));
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : 1 + Math.abs(kind === 'signal_weak' ? p.gsDb - m.gs : m.gn - p.gnDb) / 3 };
  const read = `Kesim ${fc}: sinyalde ${fmtDb(m.gs)} (şart ≥ ${fmtDb(p.gsDb)}), gürültüde ${fmtDb(m.gn)} (şart ≤ ${fmtDb(p.gnDb)}).`;
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Sonar ön katı temiz', explanation: read };
    case 'signal_weak':
      return { ...base, headline: 'Yankı kayboldu', explanation: `${read} Kesim çok düşük: sinyal de bastırıldı.` };
    case 'sensor_misread':
      return { ...base, headline: 'Gürültü yankı sanıldı', explanation: `${read} Kesim çok yüksek: pompa gürültüsü ekranda hedef gibi görünüyor.` };
  }
}

export function buildFilterReport(stageId: string, p: FilterProblem, cardId: string, outcome: Outcome): StageResult {
  const card = p.bin.find((b) => b.id === cardId)!;
  const answer = p.bin.find((b) => b.r === p.answer)!;
  const rc = p.parts.kind === 'rc';
  const part = rc ? formatFarad(p.parts.part) : formatHenry(p.parts.part);
  const h = p.hand;
  const steps = [
    `Birinci mertebe alçak geçiren: |H(f)| = 1 / √(1 + (f/f_c)²); dB'de 20·log₁₀|H|. Şart g dB ise: (f/f_c)² = 10^(−g/10) − 1`,
    `Sinyal şartı (${formatHz(p.fs)}, en fazla ${fmtDb(p.gsDb)}): f_c ≥ fₛ / √(10^(−gₛ/10) − 1) = ${formatHz(h.fcLo)}`,
    `Gürültü şartı (${formatHz(p.fn)}, en az ${fmtDb(p.gnDb)}): f_c ≤ fₙ / √(10^(−gₙ/10) − 1) = ${formatHz(h.fcHi)}`,
    rc
      ? `f_c = 1/(2πRC), C = ${part} → R = 1/(2πC·f_c): ${formatOhm(Math.min(h.rLo, h.rHi))} ≤ R ≤ ${formatOhm(Math.max(h.rLo, h.rHi))}`
      : `f_c = R/(2πL), L = ${part} → R = 2πL·f_c: ${formatOhm(Math.min(h.rLo, h.rHi))} ≤ R ≤ ${formatOhm(Math.max(h.rLo, h.rHi))}`,
    `Kutuda bu aralıkta tek değer: ${answer.label} → f_c = ${formatHz(cutoff(p.parts, p.answer))}. Kontrol: kazanç karmaşık empedans bölücüsüyle de aynı.`,
  ];
  if (card.mistake && card.r !== p.answer) steps.push(`Olası hata: ${card.mistake}`);
  const rows = [...p.bin].sort((a, b) => a.r - b.r);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `${card.label} → f_c = ${formatHz(cutoff(p.parts, card.r))}`,
    correctLabel: `${answer.label} → f_c = ${formatHz(cutoff(p.parts, p.answer))}`,
    outcome,
    facts: [
      { label: rc ? 'Kondansatör' : 'Bobin', value: part },
      { label: 'Sinyal', value: `${formatHz(p.fs)}, ≥ ${fmtDb(p.gsDb)}` },
      { label: 'Gürültü', value: `${formatHz(p.fn)}, ≤ ${fmtDb(p.gnDb)}` },
    ],
    steps,
    table: {
      caption: 'Kutudaki dirençlerle kesim ve kazanç',
      head: ['R', 'f_c', `|H| @ ${formatHz(p.fs)}`, `|H| @ ${formatHz(p.fn)}`],
      rows: rows.map((b) => {
        const fc = cutoff(p.parts, b.r);
        return [b.label, formatHz(fc), fmtDb(toDb(gainClosed(fc, p.fs))), fmtDb(toDb(gainClosed(fc, p.fn)))];
      }),
      good: rows.findIndex((b) => b.r === p.answer),
      chosen: rows.findIndex((b) => b.id === cardId),
    },
  };
}
