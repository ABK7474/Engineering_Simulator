// Doğrulayıcı: üretilen problem havuza girmeden önce buradan geçmek zorunda.

import {
  classify,
  currentBoundaries,
  solveSeriesLed,
  type SeriesLedSpec,
  type Zone,
} from './series-led';
import type { SeriesLedProblem } from './series-led.generate';

/** Seçeneğin akımı herhangi bir bölge sınırına bu orandan daha yakınsa belirsiz sayılır. */
export const BOUNDARY_MARGIN = 0.05;

export function clearOfBoundaries(spec: SeriesLedSpec, current: number, margin = BOUNDARY_MARGIN): boolean {
  return currentBoundaries(spec).every((b) => Math.abs(current - b) / b >= margin);
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

export const REQUIRED_ZONES: readonly Zone[] = ['ok', 'no_light', 'dim', 'over_mild', 'over_severe', 'fuse'];

export function verifySeriesLed(p: SeriesLedProblem): VerifyResult {
  const errors: string[] = [];
  const { spec } = p;
  const vf = spec.led.model.vf;

  if (!(spec.vs > vf)) errors.push(`Vs (${spec.vs}) Vf'den (${vf}) büyük olmalı`);

  const rs = p.choices.map((c) => c.r);
  if (new Set(rs).size !== rs.length) errors.push('Aynı değerde iki direnç var');

  const zones = p.choices.map((c) => classify(spec, solveSeriesLed(spec.vs, spec.led.model, c.r)));
  for (const z of REQUIRED_ZONES) {
    const n = zones.filter((x) => x === z).length;
    if (n !== 1) errors.push(`'${z}' bölgesinde ${n} seçenek var (1 olmalı)`);
  }

  const okChoices = p.choices.filter((_, k) => zones[k] === 'ok');
  if (okChoices.length === 1 && okChoices[0].id !== p.correctId) {
    errors.push('İşaretli doğru cevap çözücünün bulduğuyla uyuşmuyor');
  }

  for (const c of p.choices) {
    const sol = solveSeriesLed(spec.vs, spec.led.model, c.r);
    if (!clearOfBoundaries(spec, sol.current)) {
      errors.push(`${c.r} Ω seçeneği bir bölge sınırına çok yakın (belirsiz)`);
    }
  }

  // Bağımsız çapraz kontrol: doğru direnç aralığını kapalı formdan hesapla (classify'dan farklı yol).
  const correct = p.choices.find((c) => c.id === p.correctId);
  if (!correct) {
    errors.push('Doğru cevap seçenekler arasında yok');
  } else {
    const rLo = (spec.vs - vf) / spec.targetMax;
    const rHi = (spec.vs - vf) / spec.targetMin;
    if (!(correct.r >= rLo && correct.r <= rHi)) {
      errors.push(`Doğru direnç ${correct.r} Ω, [${rLo.toFixed(1)}, ${rHi.toFixed(1)}] aralığında değil`);
    }
    const pR = (spec.vs - vf) ** 2 / correct.r;
    if (pR > spec.resistorRating) errors.push('Doğru direnç anma gücünü aşıyor');
  }

  return { ok: errors.length === 0, errors };
}
