// Seri-paralel aşamanın fiziksel sonucu: MNA ile çözülen devre → bölge → sonuç havuzu.
// Rastgelelik yalnız havuz içinde; motor akımı büyüdükçe yanma olasılığı artar.

import { formatAmp, formatWatt } from '../../core/format';
import { weightedPick, type Rng } from '../../core/rng';
import type { Outcome, OutcomeKind } from '../../core/types';
import type { DcSolution } from './mna';
import {
  classify,
  readingFor,
  SEVERE_RATIO,
  slotIds,
  solveWith,
  type Reading,
  type SeriesParallelConfig,
  type SpZone,
} from './series-parallel';
import type { SpProblem } from './series-parallel.generate';

export type Placement = Record<string, string>;

export interface SpEvaluation {
  outcome: Outcome;
  solution: DcSolution;
  reading: Reading;
  zone: SpZone;
  values: Record<string, number>;
}

export function outcomePool(z: SpZone, r: Reading): { value: OutcomeKind; weight: number }[] {
  switch (z) {
    case 'ok':
      return [{ value: 'success', weight: 1 }];
    case 'fuse':
      return [{ value: 'fuse_blown', weight: 1 }];
    case 'stall':
      return [{ value: 'motor_stall', weight: 1 }];
    case 'slow':
    case 'regulator_low':
      return [{ value: 'motor_slow', weight: 1 }];
    case 'over_mild': {
      const lo = 1 + r.loadTol;
      const p = (r.load / r.loadTarget - lo) / (SEVERE_RATIO - lo);
      return [
        { value: 'motor_overheat', weight: 1 - p },
        { value: 'motor_burnt', weight: p },
      ];
    }
    case 'over_severe':
      return [{ value: 'motor_burnt', weight: 1 }];
    case 'resistor_overheat':
      return [{ value: 'resistor_burnt', weight: 1 }];
  }
}

export function evaluatePlacement(c: SeriesParallelConfig, p: SpProblem, placement: Placement, rng: Rng): SpEvaluation {
  const values = Object.fromEntries(
    slotIds(c).map((s) => {
      const card = p.bin.find((b) => b.id === placement[s]);
      if (!card) throw new Error(`Yuva '${s}' boş`);
      return [s, card.r];
    }),
  );
  const solution = solveWith(c, p.params, values);
  const reading = readingFor(c, solution, p.targets);
  const zone = classify(reading);
  const kind = weightedPick(rng, outcomePool(zone, reading));
  return { outcome: describe(kind, zone, reading), solution, reading, zone, values };
}

function describe(kind: OutcomeKind, zone: SpZone, r: Reading): Outcome {
  const im = formatAmp(r.load);
  const is = formatAmp(r.supply);
  const tIm = formatAmp(r.loadTarget);
  const tIs = formatAmp(r.supplyTarget);
  const lr = r.load / r.loadTarget;
  const base = { kind, resistorOverheat: r.slotPowerMax > r.rating };
  const text = (headline: string, explanation: string, severity: number): Outcome => ({ ...base, headline, explanation, severity });
  switch (kind) {
    case 'success':
      return text('Motor döndü, sürücü çalışıyor', `Motor ${im} (hedef ${tIm}), regülatör ${is} (hedef ${tIs}). İkisi de çalışma aralığında.`, 0);
    case 'fuse_blown':
      return text(
        'Hat koruması attı',
        `Regülatörden ${is} çekildi; çalışma aralığının üstü (${tIs} ± %${Math.round(r.supplyTol * 100)}). Elektronik sigorta hattı kesti.`,
        r.supply / (r.supplyTarget * (1 + r.supplyTol)),
      );
    case 'motor_stall':
      return text('Motor dönmedi', `Motor akımı ${im}; hedefin (${tIm}) yarısından az. Tork kilidi açmaya yetmedi.`, r.loadTarget / Math.max(r.load, 1e-9));
    case 'motor_slow':
      return zone === 'regulator_low'
        ? text(
            'Regülatör kararsız, motor tekledi',
            `Motor akımı doğru (${im}) ama regülatörden yalnız ${is} çekildi; minimum yükün (${tIs} − %${Math.round(r.supplyTol * 100)}) altında çıkış dalgalandı, motor yarıda takıldı.`,
            r.supplyTarget / Math.max(r.supply, 1e-9),
          )
        : text('Motor zayıf, yarıda takıldı', `Motor akımı ${im}, hedefin (${tIm}) altında. Motor yavaş dönüp yarıda takıldı.`, r.loadTarget / Math.max(r.load, 1e-9));
    case 'motor_overheat':
      return text('Termik koruma motoru kesti', `Motor akımı ${im}, hedefin %${Math.round((lr - 1) * 100)} üstünde. Sargı ısındı, termik koruma devreye girdi.`, lr);
    case 'motor_burnt':
      return text('Motor sargısı yandı', `Motor akımı ${im}, hedefin ${lr.toFixed(1).replace('.', ',')} katı. Sargı yalıtımı eridi; duman.`, lr);
    case 'resistor_burnt':
      return text('Güç direnci yandı', `Bir yuva direnci ${formatWatt(r.slotPowerMax)} harcadı; anma gücü ${formatWatt(r.rating)}.`, r.slotPowerMax / r.rating);
    default:
      throw new Error(`Seri-paralel aşama '${kind}' sonucunu üretmez`);
  }
}

