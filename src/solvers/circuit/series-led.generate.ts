// Tohumdan somut problem üretir: doğru direnç + her hata bölgesinden bir tuzak.

import { formatAmp, formatOhm, formatVolt, formatWatt } from '../../core/format';
import { createRng, pick, shuffle, type Rng } from '../../core/rng';
import { e12Values } from './e-series';
import {
  classify,
  solveSeriesLed,
  type SeriesLedConfig,
  type SeriesLedSpec,
  type Zone,
} from './series-led';
import { clearOfBoundaries, REQUIRED_ZONES, verifySeriesLed } from './series-led.verify';

export interface ResistorChoice {
  id: string;
  r: number;
  label: string;
  /** Tipik hata kaynağı; seçilirse olay raporunda açıklanır. */
  mistake?: string;
}

export interface SeriesLedProblem {
  seed: number;
  spec: SeriesLedSpec;
  choices: ResistorChoice[];
  correctId: string;
  prompt: string;
}

const MAX_ATTEMPTS = 100;

export function generateSeriesLed(config: SeriesLedConfig, seed: number): SeriesLedProblem {
  const rng = createRng(seed);
  const rejections: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const p = buildCandidate(config, rng, seed);
    if (!p) continue;
    const v = verifySeriesLed(p);
    if (v.ok) return p;
    rejections.push(...v.errors);
  }
  throw new Error(`Doğrulanabilir problem üretilemedi (tohum ${seed}): ${rejections.slice(0, 3).join('; ')}`);
}

function buildCandidate(config: SeriesLedConfig, rng: Rng, seed: number): SeriesLedProblem | null {
  const led = pick(rng, config.leds);
  const vs = pick(rng, config.supplyVoltages);
  if (vs <= led.vf + 1) return null; // dirençte anlamlı gerilim kalmalı

  const spec: SeriesLedSpec = {
    vs,
    led: { color: led.color, model: { kind: 'constant-vf', vf: led.vf } },
    targetMin: config.targetMin,
    targetMax: config.targetMax,
    absMax: config.absMax,
    visibleMin: config.visibleMin,
    fuse: config.fuse,
    resistorRating: config.resistorRating,
  };

  const byZone = new Map<Zone, number[]>();
  for (const r of e12Values(1, 1_000_000)) {
    const sol = solveSeriesLed(vs, spec.led.model, r);
    if (!clearOfBoundaries(spec, sol.current)) continue;
    const z = classify(spec, sol);
    byZone.set(z, [...(byZone.get(z) ?? []), r]);
  }

  const chosen = new Map<Zone, ResistorChoice>();

  // Klasik hata: Vf'yi unutup R = Vs / I_hedef hesaplamak.
  const iMid = (spec.targetMin + spec.targetMax) / 2;
  const forgotVf = zoneOf(byZone, nearestE12(vs / iMid));
  if (forgotVf && forgotVf.zone !== 'ok') {
    chosen.set(forgotVf.zone, {
      id: '',
      r: forgotVf.r,
      label: formatOhm(forgotVf.r),
      mistake: `LED'in ileri gerilimi (Vf) unutulursa R = Vs / I = ${formatVolt(vs)} / ${formatAmp(iMid)} ≈ ${formatOhm(vs / iMid)} bulunur; en yakın standart değer budur.`,
    });
  }

  for (const z of REQUIRED_ZONES) {
    if (chosen.has(z)) continue;
    const pool = byZone.get(z);
    if (!pool || pool.length === 0) return null;
    const r = pick(rng, pool);
    chosen.set(z, { id: '', r, label: formatOhm(r) });
  }

  const choices = shuffle(rng, [...chosen.values()]).map((c, k) => ({ ...c, id: `r${k}` }));
  const correctR = chosen.get('ok')!.r;
  const correctId = choices.find((c) => c.r === correctR)!.id;

  const prompt =
    `Kilit sürücüsü, durum LED'inden ${formatAmp(spec.targetMin)} – ${formatAmp(spec.targetMax)} arası akım ` +
    `görmeden kapıyı açmıyor. Kaynak: ${formatVolt(vs)}. LED: ${led.color}, Vf ≈ ${formatVolt(led.vf)}, ` +
    `mutlak en yüksek akım ${formatAmp(spec.absMax)}. Hat sigortası ${formatAmp(spec.fuse)}. ` +
    `Kutudaki dirençler ${formatWatt(spec.resistorRating)} anma gücünde. Seri hatta hangi direnci takarsın?`;

  return { seed, spec, choices, correctId, prompt };
}

function nearestE12(target: number): number {
  return e12Values().reduce((best, r) =>
    Math.abs(Math.log(r / target)) < Math.abs(Math.log(best / target)) ? r : best,
  );
}

/** Değer sınıra yapışık olduğu için elendiyse null döner. */
function zoneOf(byZone: Map<Zone, number[]>, r: number): { zone: Zone; r: number } | null {
  for (const [zone, rs] of byZone) if (rs.includes(r)) return { zone, r };
  return null;
}
