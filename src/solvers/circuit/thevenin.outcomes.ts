// Eşdeğer kaynak modülü, oyuncunun girdiği değerlerle yükü besler. Sonuç fizikten: modülün verdiği yük
// akımı gerçek ağınkiyle karşılaştırılır (az → motor zayıf/dönmez, fazla → ısınır/yanar). Akım tutup
// değerler yanlışsa (birbirini götüren hatalar) boşta gerilim farklıdır: fazlası korumayı attırır.

import { formatAmp, formatOhm, formatVolt } from '../../core/format';
import type { Outcome, OutcomeKind } from '../../core/types';
import type { TheveninProblem } from './thevenin.generate';

export type TheveninOutcomeKind = Extract<OutcomeKind, 'success' | 'motor_stall' | 'motor_slow' | 'motor_overheat' | 'motor_burnt' | 'fuse_blown'>;

/** Oyuncunun girdisi: Thevenin biçiminde (Vth, Rth), Norton biçiminde (In, Rn). */
export interface TheveninAnswer {
  a: number;
  b: number;
}

export const STALL_RATIO = 0.5;
export const SEVERE_RATIO = 1.5;

/** Girdiyi Thevenin eşdeğerine çevirir. */
export function asThevenin(p: TheveninProblem, ans: TheveninAnswer): { vth: number; rth: number } {
  return p.form === 'thevenin' ? { vth: ans.a, rth: ans.b } : { vth: ans.a * ans.b, rth: ans.b };
}

/** Doğru değerler oyuncunun biçiminde. */
export function expected(p: TheveninProblem): TheveninAnswer {
  return p.form === 'thevenin' ? { a: p.eq.vth, b: p.eq.rth } : { a: p.eq.isc, b: p.eq.rth };
}

export function judge(p: TheveninProblem, ans: TheveninAnswer) {
  const want = expected(p);
  const okA = Math.abs(ans.a / want.a - 1) <= p.tolerance;
  const okB = Math.abs(ans.b / want.b - 1) <= p.tolerance;
  const emu = asThevenin(p, ans);
  const iEmu = emu.vth / (emu.rth + p.rl);
  return { okA, okB, emu, iEmu, ratio: iEmu / p.iLoad, idle: emu.vth / p.eq.vth };
}

export function classifyThevenin(p: TheveninProblem, ans: TheveninAnswer): TheveninOutcomeKind {
  const j = judge(p, ans);
  if (j.okA && j.okB) return 'success';
  if (j.ratio < STALL_RATIO) return 'motor_stall';
  if (j.ratio < 1 - p.tolerance) return 'motor_slow';
  if (j.ratio >= SEVERE_RATIO) return 'motor_burnt';
  if (j.ratio > 1 + p.tolerance) return 'motor_overheat';
  return j.idle > 1 ? 'fuse_blown' : 'motor_slow';
}

export function resolveTheveninOutcome(p: TheveninProblem, ans: TheveninAnswer): Outcome {
  if (!(ans.a > 0 && ans.b > 0)) throw new Error('Girdi pozitif olmalı');
  const kind = classifyThevenin(p, ans);
  const j = judge(p, ans);
  const iR = formatAmp(p.iLoad);
  const iE = formatAmp(j.iEmu);
  const base = { kind, resistorOverheat: false };
  const sev = kind === 'success' ? 0 : j.ratio >= 1 ? j.ratio : 1 / Math.max(j.ratio, 1e-9);
  switch (kind) {
    case 'success':
      return { ...base, severity: 0, headline: 'Modül programlandı, bara besleniyor', explanation: `Eşdeğer modül yükü ${iE} ile besliyor; gerçek ağ ${iR} verirdi. Bara dengede.` };
    case 'motor_stall':
      return { ...base, severity: sev, headline: 'Pompa motoru dönmedi', explanation: `Modül yükten yalnız ${iE} geçirdi (gerçek ağ ${iR}); motor kalkış akımına ulaşamadı.` };
    case 'motor_slow':
      return {
        ...base,
        severity: sev,
        headline: 'Pompa zayıf çalışıyor',
        explanation:
          Math.abs(j.ratio - 1) <= p.tolerance
            ? `Yükte akım tuttu (${iE}) ama eşdeğer yanlış: boşta gerilim ${formatVolt(j.emu.vth)} (olması gereken ${formatVolt(p.eq.vth)}). Hatalar birbirini götürdü; yük değişince pompa zayıflıyor.`
            : `Modül ${iE} verdi, gerçek ağ ${iR} verirdi. Pompa hedef debinin altında.`,
      };
    case 'motor_overheat':
      return { ...base, severity: sev, headline: 'Motor ısındı, termik koruma', explanation: `Modül ${iE} verdi, gerçek ağ ${iR} verirdi. Fazla akım sargıyı ısıttı.` };
    case 'motor_burnt':
      return { ...base, severity: sev, headline: 'Motor sargısı yandı', explanation: `Modül ${iE} bastı; gerçek ağın ${iR} akımının ${j.ratio.toFixed(1)} katı. Sargı dayanmadı.` };
    case 'fuse_blown':
      return {
        ...base,
        severity: j.idle,
        headline: 'Boşta aşırı gerilim, koruma attı',
        explanation: `Yükte akım tuttu (${iE}) ama modülün boşta gerilimi ${formatVolt(j.emu.vth)}, gerçek ${formatVolt(p.eq.vth)}. Yük ayrılınca bara gerilimi fırladı; koruma hattı kesti. (R = ${formatOhm(j.emu.rth)})`,
      };
  }
}
