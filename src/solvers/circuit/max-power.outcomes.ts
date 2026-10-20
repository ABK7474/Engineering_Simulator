// Sonuç fizikten: seçilen yükün aldığı güç (MNA) ve kaynak akımı. Çok küçük yük kaynağı kısa devreye
// yaklaştırır → sigorta; güç oranı başarı eşiğinin altında → verici zayıf, sinyal ulaşmaz.

import { formatAmp, formatOhm, formatWatt } from '../../core/format';
import type { Outcome, OutcomeKind } from '../../core/types';
import { loadPower, SUCCESS_RATIO } from './max-power';
import type { MaxPowerProblem } from './max-power.generate';

export type MaxPowerOutcomeKind = Extract<OutcomeKind, 'success' | 'signal_weak' | 'fuse_blown'>;

export function judgeLoad(p: MaxPowerProblem, r: number) {
  const { p: pw, i } = loadPower(p.vth, p.rth, r);
  return { power: pw, current: i, ratio: pw / p.pmax, x: r / p.rth };
}

export function classifyMaxPower(p: MaxPowerProblem, r: number): MaxPowerOutcomeKind {
  const j = judgeLoad(p, r);
  if (j.current > p.fuseCurrent) return 'fuse_blown';
  return j.ratio >= SUCCESS_RATIO ? 'success' : 'signal_weak';
}

export function resolveMaxPowerOutcome(p: MaxPowerProblem, cardId: string): Outcome {
  const card = p.bin.find((b) => b.id === cardId);
  if (!card) throw new Error(`Geçersiz seçim: ${cardId}`);
  const kind = classifyMaxPower(p, card.r);
  const j = judgeLoad(p, card.r);
  const pct = `%${(j.ratio * 100).toFixed(1)}`;
  const base = { kind, resistorOverheat: false };
  switch (kind) {
    case 'success':
      return { ...base, severity: 0, headline: 'Verici tam güçte, sonar yayında', explanation: `${card.label} yükü ${formatWatt(j.power)} aldı: kara kutunun verebileceği en büyük gücün ${pct}'i.` };
    case 'signal_weak':
      return {
        ...base,
        severity: 1 / Math.max(j.ratio, 1e-9),
        headline: 'Verici zayıf, sinyal ulaşmıyor',
        explanation: `${card.label} yükü yalnız ${formatWatt(j.power)} aldı (en büyük gücün ${pct}'i). Yük R_th'den ${j.x < 1 ? 'küçük' : 'büyük'}; güç kaynağın iç direncinde ${j.x < 1 ? 'harcandı' : 'aktarılamadı'}.`,
      };
    case 'fuse_blown':
      return {
        ...base,
        severity: j.current / p.fuseCurrent,
        headline: 'Kaynak sigortası attı',
        explanation: `${card.label} çok küçük: kara kutudan ${formatAmp(j.current)} çekildi (sigorta ${formatAmp(p.fuseCurrent)}). En büyük akım en büyük güç demek değil. (R_th ≈ ${formatOhm(p.rth)})`,
      };
  }
}
