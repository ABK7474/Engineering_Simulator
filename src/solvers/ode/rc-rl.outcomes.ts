// Sonuç fizikten: seçilen R ile ateşleme anı (kapalı form; RK4 ile doğrulanmış). Erken → valf çarpar,
// geç → basınç kaçağı, hiç → valf kapanmaz.

import type { Outcome, OutcomeKind } from '../../core/types';
import { crossingClosed } from './rc-rl';
import type { RcRlProblem } from './rc-rl.generate';

export type RcRlOutcomeKind = Extract<OutcomeKind, 'success' | 'valve_slam' | 'valve_late' | 'valve_stuck'>;

export const fmtTime = (t: number) => (t >= 1 ? `${String(Number(t.toPrecision(3))).replace('.', ',')} s` : `${String(Number((t * 1000).toPrecision(3))).replace('.', ',')} ms`);

export function classifyRcRl(p: RcRlProblem, r: number): RcRlOutcomeKind {
  const t = crossingClosed(p.params, r);
  if (t === null) return 'valve_stuck';
  if (t < p.tmin) return 'valve_slam';
  if (t > p.tmax) return 'valve_late';
  return 'success';
}

export function resolveRcRlOutcome(p: RcRlProblem, cardId: string): Outcome {
  const card = p.bin.find((b) => b.id === cardId);
  if (!card) throw new Error(`Geçersiz seçim: ${cardId}`);
  const kind = classifyRcRl(p, card.r);
  const t = crossingClosed(p.params, card.r);
  const win = `${fmtTime(p.tmin)} – ${fmtTime(p.tmax)}`;
  const base = { kind, resistorOverheat: false };
  switch (kind) {
    case 'success':
      return { ...base, severity: 0, headline: 'Valf zamanında kapandı, kilit hazır', explanation: `${card.label} ile ateşleme ${fmtTime(t!)} anında; pencere ${win}.` };
    case 'valve_slam':
      return { ...base, severity: p.tmin / t!, headline: 'Valf erken kapandı, darbe', explanation: `${card.label} ile ateşleme ${fmtTime(t!)}: pencereden (${win}) önce. Basınç dengelenmeden kapanan valf çarptı.` };
    case 'valve_late':
      return { ...base, severity: t! / p.tmax, headline: 'Valf geç kapandı, basınç kaçağı', explanation: `${card.label} ile ateşleme ${fmtTime(t!)}: pencereden (${win}) sonra. Arada hava kilidinden su sızdı.` };
    case 'valve_stuck':
      return {
        ...base,
        severity: 2,
        headline: 'Valf hiç ateşlemedi',
        explanation: `${card.label} ile ${p.kind === 'rc' ? 'kondansatör gerilimi' : 'bobin akımı'} eşiğe asimptotik olarak bile ulaşmıyor; kalıcı değer eşiğin altında.`,
      };
  }
}
