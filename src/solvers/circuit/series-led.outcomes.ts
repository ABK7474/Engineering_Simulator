// Hata sonucu havuzu: hangi sonuçların mümkün olduğunu fizik (bölge) belirler,
// rastgelelik yalnızca havuz içindeki seçimdir. Hata büyüdükçe ağır sonucun ağırlığı artar.

import { formatAmp, formatWatt } from '../../core/format';
import { weightedPick, type Rng } from '../../core/rng';
import type { Outcome, OutcomeKind } from '../../core/types';
import { classify, type SeriesLedSolution, type SeriesLedSpec } from './series-led';

/** Seri LED devresinin üretebildiği sonuçlar. */
export type LedOutcomeKind = Extract<
  OutcomeKind,
  'success' | 'no_light' | 'dim' | 'led_stressed' | 'led_burnt' | 'resistor_burnt' | 'fuse_blown'
>;

export interface PoolEntry {
  value: LedOutcomeKind;
  weight: number;
}

export function outcomePool(spec: SeriesLedSpec, sol: SeriesLedSolution): PoolEntry[] {
  switch (classify(spec, sol)) {
    case 'ok':
      return [{ value: 'success', weight: 1 }];
    case 'no_light':
      return [{ value: 'no_light', weight: 1 }];
    case 'dim':
      return [{ value: 'dim', weight: 1 }];
    case 'over_mild': {
      // Hedefin hemen üstünde LED genelde dayanır; mutlak sınıra yaklaştıkça yanma olasılığı 1'e gider.
      const p = (sol.current - spec.targetMax) / (spec.absMax - spec.targetMax);
      return [
        { value: 'led_stressed', weight: 1 - p },
        { value: 'led_burnt', weight: p },
      ];
    }
    case 'over_severe':
      return [{ value: 'led_burnt', weight: 1 }];
    case 'fuse':
      return [{ value: 'fuse_blown', weight: 1 }];
    case 'resistor_overheat':
      return [{ value: 'resistor_burnt', weight: 1 }];
  }
}

export function resolveOutcome(spec: SeriesLedSpec, sol: SeriesLedSolution, rng: Rng): Outcome {
  const kind = weightedPick(rng, outcomePool(spec, sol));
  const resistorOverheat = sol.pResistor > spec.resistorRating;
  const i = formatAmp(sol.current);
  const text = describe(kind, spec, sol, i);
  return { kind, severity: severityOf(kind, spec, sol), resistorOverheat, ...text };
}

function severityOf(kind: LedOutcomeKind, spec: SeriesLedSpec, sol: SeriesLedSolution): number {
  switch (kind) {
    case 'success':
      return 0;
    case 'no_light':
    case 'dim':
      return sol.current > 0 ? spec.targetMin / sol.current : Infinity;
    case 'led_stressed':
    case 'led_burnt':
      return sol.current / spec.targetMax;
    case 'fuse_blown':
      return sol.current / spec.fuse;
    case 'resistor_burnt':
      return sol.pResistor / spec.resistorRating;
  }
}

function describe(
  kind: LedOutcomeKind,
  spec: SeriesLedSpec,
  sol: SeriesLedSolution,
  i: string,
): { headline: string; explanation: string } {
  const window = `${formatAmp(spec.targetMin)} – ${formatAmp(spec.targetMax)}`;
  switch (kind) {
    case 'success':
      return {
        headline: 'LED yandı, devre onaylandı',
        explanation: `Akım ${i}; hedef aralık ${window} içinde. Sürücü LED'i gördü ve devreyi onayladı.`,
      };
    case 'no_light':
      return {
        headline: 'LED hiç yanmadı',
        explanation: `Akım yalnızca ${i}; gözle görülür ışık için en az ${formatAmp(spec.visibleMin)} gerekir. Sürücü hiçbir şey görmedi.`,
      };
    case 'dim':
      return {
        headline: 'LED sönük, sürücü kararsız',
        explanation: `Akım ${i}, hedefin altı (${window}). Sürücü sinyali kararsız gördü; devre onaylanmadı.`,
      };
    case 'led_stressed':
      return {
        headline: 'LED aşırı parladı ve söndü',
        explanation: `Akım ${i}, hedefin üstü (${window}) ama mutlak sınırın (${formatAmp(spec.absMax)}) altında. LED ısındı, sürücü aşırı akımı görüp hattı kesti.`,
      };
    case 'led_burnt':
      return {
        headline: 'LED patladı',
        explanation: `Akım ${i}; LED'in dayanabileceği ${formatAmp(spec.absMax)} sınırının ${(sol.current / spec.absMax).toFixed(1).replace('.', ',')} katı. Eklem aşırı ısındı ve koptu.`,
      };
    case 'fuse_blown':
      return {
        headline: 'Sigorta attı',
        explanation: `Akım ${i}; hat sigortası ${formatAmp(spec.fuse)}. Direnç neredeyse kısa devre gibi davrandı, bölmenin enerjisi kesildi.`,
      };
    case 'resistor_burnt':
      return {
        headline: 'Direnç yandı',
        explanation: `Direnç ${formatWatt(sol.pResistor)} harcadı; anma gücü ${formatWatt(spec.resistorRating)}.`,
      };
  }
}
