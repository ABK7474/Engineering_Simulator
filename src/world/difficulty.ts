// Oda başı zorluk: aşama yapılandırmasının üstüne uygulanır. Sonuç her zaman mevcut çözücü ve
// doğrulayıcıdan geçmek zorundadır (verifyFaultStages).
// - series-parallel: binSize = kutudaki aday direnç sayısı (topoloji sabit), tolerance = hedef toleransı.
// - series-led: ledWindow_mA = hedef akım aralığı. (Bu türde kutu bölge başına bir dirençtir; binSize yok.)
// - ds-trace: trace.ops = izleme adım sayısı, trace.structures = yapı türleri, trace.corruptions = hata türleri,
//   trace.hideCounters = döngü sayaçlarını tabloda gizle.
// - thevenin: thevenin.form (thevenin/norton), thevenin.tolerance. max-power: maxPower.binSize.
// - opamp: opamp.variants (gain/offset), opamp.tolerance. rc-rl: rcRl.kinds (rc/rl), rcRl.window.

import type { FaultCard, StageDef } from '../core/types';
import { parseSeriesLedConfig } from '../solvers/circuit/series-led';
import { generateSeriesLed } from '../solvers/circuit/series-led.generate';
import { parseSeriesParallelConfig } from '../solvers/circuit/series-parallel';
import { generateSeriesParallel } from '../solvers/circuit/series-parallel.generate';
import { parseMaxPowerConfig } from '../solvers/circuit/max-power';
import { generateMaxPower } from '../solvers/circuit/max-power.generate';
import { parseDiodeConfig } from '../solvers/circuit/diode';
import { generateDiode } from '../solvers/circuit/diode.generate';
import { parseFilterConfig } from '../solvers/circuit/filter';
import { generateFilter } from '../solvers/circuit/filter.generate';
import { parseSuperConfig } from '../solvers/circuit/superposition';
import { generateSuper } from '../solvers/circuit/superposition.generate';
import { parseTheveninConfig } from '../solvers/circuit/thevenin';
import { generateThevenin } from '../solvers/circuit/thevenin.generate';
import { parseOpampConfig } from '../solvers/circuit/opamp';
import { generateOpamp } from '../solvers/circuit/opamp.generate';
import { generateDsTrace } from '../solvers/ds/ds-trace.generate';
import { parseDampingConfig } from '../solvers/ode/damping';
import { generateDamping } from '../solvers/ode/damping.generate';
import { parseStabilityConfig } from '../solvers/math/stability';
import { generateStability } from '../solvers/math/stability.generate';
import { parseLaplaceConfig } from '../solvers/math/laplace';
import { generateLaplace } from '../solvers/math/laplace.generate';
import { parsePhasorConfig } from '../solvers/math/phasor';
import { generatePhasor } from '../solvers/math/phasor.generate';
import { parseProbConfig } from '../solvers/prob/probability';
import { generateProb } from '../solvers/prob/probability.generate';
import { parseRcRlConfig } from '../solvers/ode/rc-rl';
import { generateRcRl } from '../solvers/ode/rc-rl.generate';
import { parseDsTraceConfig } from '../solvers/ds/ir';
import type { Difficulty } from './schema';

export const DIFFICULTY_SEEDS = 20;

export function applyDifficulty(stage: StageDef, d: Difficulty): StageDef {
  const config = structuredClone(stage.config) as Record<string, unknown>;
  if (stage.type === 'series-parallel') {
    if (d.binSize !== undefined) config.binSize = d.binSize;
    if (d.tolerance !== undefined) for (const t of config.targets as { tolerance: number }[]) t.tolerance = d.tolerance;
  } else if (stage.type === 'series-led') {
    if (d.ledWindow_mA) [config.targetMin_mA, config.targetMax_mA] = d.ledWindow_mA;
  } else if (stage.type === 'ds-trace' && d.trace) {
    if (d.trace.ops) config.ops = d.trace.ops;
    if (d.trace.structures) config.structures = d.trace.structures;
    if (d.trace.corruptions) config.corruptions = d.trace.corruptions;
    if (d.trace.hideCounters !== undefined) config.hideCounters = d.trace.hideCounters;
  } else if (stage.type === 'thevenin' && d.thevenin) {
    if (d.thevenin.form) config.form = d.thevenin.form;
    if (d.thevenin.tolerance !== undefined) config.tolerance = d.thevenin.tolerance;
  } else if (stage.type === 'max-power' && d.maxPower) {
    if (d.maxPower.binSize !== undefined) config.binSize = d.maxPower.binSize;
  } else if (stage.type === 'opamp' && d.opamp) {
    if (d.opamp.variants) config.variants = d.opamp.variants;
    if (d.opamp.tolerance !== undefined) config.tolerance = d.opamp.tolerance;
  } else if (stage.type === 'rc-rl' && d.rcRl) {
    if (d.rcRl.kinds) config.kinds = d.rcRl.kinds;
    if (d.rcRl.window !== undefined) config.window = d.rcRl.window;
  }
  return { ...stage, config };
}

/** Arızanın oyunda kullanılacak aşamaları: kart aşamaları + odanın zorluğu. */
export function faultStages(card: FaultCard, d: Difficulty): StageDef[] {
  return card.stages.map((s) => applyDifficulty(s, d));
}

/** Tür → (yapılandırma) → (tohum) problem üret; üretemezse hata fırlatır. */
const CHECKERS: Record<StageDef['type'], (config: unknown) => (seed: number) => unknown> = {
  'series-led': (c) => ((cfg) => (seed: number) => generateSeriesLed(cfg, seed))(parseSeriesLedConfig(c)),
  'series-parallel': (c) => ((cfg) => (seed: number) => generateSeriesParallel(cfg, seed))(parseSeriesParallelConfig(c)),
  'ds-trace': (c) => ((cfg) => (seed: number) => generateDsTrace(cfg, seed))(parseDsTraceConfig(structuredClone(c))),
  thevenin: (c) => ((cfg) => (seed: number) => generateThevenin(cfg, seed))(parseTheveninConfig(c)),
  'max-power': (c) => ((cfg) => (seed: number) => generateMaxPower(cfg, seed))(parseMaxPowerConfig(c)),
  opamp: (c) => ((cfg) => (seed: number) => generateOpamp(cfg, seed))(parseOpampConfig(c)),
  'rc-rl': (c) => ((cfg) => (seed: number) => generateRcRl(cfg, seed))(parseRcRlConfig(c)),
  superposition: (c) => ((cfg) => (seed: number) => generateSuper(cfg, seed))(parseSuperConfig(c)),
  diode: (c) => ((cfg) => (seed: number) => generateDiode(cfg, seed))(parseDiodeConfig(c)),
  filter: (c) => ((cfg) => (seed: number) => generateFilter(cfg, seed))(parseFilterConfig(c)),
  damping: (c) => ((cfg) => (seed: number) => generateDamping(cfg, seed))(parseDampingConfig(c)),
  stability: (c) => ((cfg) => (seed: number) => generateStability(cfg, seed))(parseStabilityConfig(c)),
  laplace: (c) => ((cfg) => (seed: number) => generateLaplace(cfg, seed))(parseLaplaceConfig(c)),
  phasor: (c) => ((cfg) => (seed: number) => generatePhasor(cfg, seed))(parsePhasorConfig(c)),
  probability: (c) => ((cfg) => (seed: number) => generateProb(cfg, seed))(parseProbConfig(c)),
};

/** Her aşama birçok tohumda doğrulanmış problem üretebilmeli; üretemeyenler açıklamalı döner. */
export function verifyFaultStages(faultId: string, stages: StageDef[], seeds = DIFFICULTY_SEEDS): string[] {
  const problems: string[] = [];
  for (const s of stages) {
    try {
      const check = CHECKERS[s.type](s.config);
      for (let seed = 1; seed <= seeds; seed++) check(seed);
    } catch (e) {
      problems.push(`arıza '${faultId}' aşama '${s.id}': zorluk ayarıyla doğrulanabilir problem üretilemiyor (${(e as Error).message.split('\n')[0]})`);
    }
  }
  return problems;
}
