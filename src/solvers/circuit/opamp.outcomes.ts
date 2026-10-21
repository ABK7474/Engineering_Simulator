// Sonuç fizikten: yerleşimle iki uçta (sensör alt/üst) çıkış MNA ile hesaplanır, tek besleme rayına kırpılır.
// Ray aşılırsa op-amp doyar (kırpma); aralık ya da kazanç yanlışsa ADC basıncı yanlış okur.

import { formatVolt } from '../../core/format';
import type { Outcome, OutcomeKind } from '../../core/types';
import { clip, outputMna, SLOTS, type Resistors } from './opamp';
import type { OpampProblem } from './opamp.generate';

export type OpampOutcomeKind = Extract<OutcomeKind, 'success' | 'opamp_saturated' | 'sensor_misread'>;

export function readings(p: OpampProblem, r: Resistors) {
  const lo = outputMna(p.variant, p.vlo, p.vref, r);
  const hi = outputMna(p.variant, p.vhi, p.vref, r);
  return { lo, hi, loClip: clip(lo, p.vcc), hiClip: clip(hi, p.vcc) };
}

export function resistorsOf(p: OpampProblem, placement: Record<string, string>): Resistors {
  return Object.fromEntries(SLOTS[p.variant].map((s) => [s, p.bin.find((b) => b.id === placement[s])!.r]));
}

export function classifyOpamp(p: OpampProblem, r: Resistors): OpampOutcomeKind {
  const x = readings(p, r);
  if (x.lo !== x.loClip || x.hi !== x.hiClip) return 'opamp_saturated';
  const tol = p.tolerance * (p.yhi - p.ylo);
  return Math.abs(x.lo - p.ylo) <= tol && Math.abs(x.hi - p.yhi) <= tol ? 'success' : 'sensor_misread';
}

export function resolveOpampOutcome(p: OpampProblem, placement: Record<string, string>): Outcome {
  const r = resistorsOf(p, placement);
  const kind = classifyOpamp(p, r);
  const x = readings(p, r);
  const span = p.yhi - p.ylo;
  const severity = Math.max(Math.abs(x.lo - p.ylo), Math.abs(x.hi - p.yhi)) / (p.tolerance * span);
  const base = { kind, resistorOverheat: false };
  const read = `En düşük basınçta ${formatVolt(x.loClip)} (hedef ${formatVolt(p.ylo)}), en yüksekte ${formatVolt(x.hiClip)} (hedef ${formatVolt(p.yhi)}).`;
  switch (kind) {
    case 'success':
      return { ...base, severity: 0, headline: 'Basınç sensörü kalibre, ADC tam aralıkta', explanation: read };
    case 'opamp_saturated':
      return {
        ...base,
        severity,
        headline: 'Op-amp doydu, sinyal kırpıldı',
        explanation: `İdeal çıkış ${formatVolt(x.lo)} … ${formatVolt(x.hi)} olurdu; tek beslemede 0 … ${formatVolt(p.vcc)} dışına çıkamaz. ${read} Kırpılan bölgede basınç değişimi görülmüyor.`,
      };
    case 'sensor_misread':
      return { ...base, severity, headline: 'Basınç yanlış okunuyor', explanation: `${read} Kazanç ya da ofset hatalı; kilit kontrolü yanlış basınçla çalışıyor.` };
  }
}
