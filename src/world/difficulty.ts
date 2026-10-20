// Oda başı zorluk: aşama yapılandırmasının üstüne uygulanır. Sonuç her zaman mevcut çözücü ve
// doğrulayıcıdan geçmek zorundadır (verifyFaultStages).
// - series-parallel: binSize = kutudaki aday direnç sayısı (topoloji sabit), tolerance = hedef toleransı.
// - series-led: ledWindow_mA = hedef akım aralığı. (Bu türde kutu bölge başına bir dirençtir; binSize yok.)
// - ds-trace: trace.ops = izleme adım sayısı, trace.structures = yapı türleri, trace.corruptions = hata türleri,
//   trace.hideCounters = döngü sayaçlarını tabloda gizle.

import type { FaultCard, StageDef } from '../core/types';
import { parseSeriesLedConfig } from '../solvers/circuit/series-led';
import { generateSeriesLed } from '../solvers/circuit/series-led.generate';
import { parseSeriesParallelConfig } from '../solvers/circuit/series-parallel';
import { generateSeriesParallel } from '../solvers/circuit/series-parallel.generate';
import { generateDsTrace } from '../solvers/ds/ds-trace.generate';
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
  }
  return { ...stage, config };
}

/** Arızanın oyunda kullanılacak aşamaları: kart aşamaları + odanın zorluğu. */
export function faultStages(card: FaultCard, d: Difficulty): StageDef[] {
  return card.stages.map((s) => applyDifficulty(s, d));
}

/** Her aşama birçok tohumda doğrulanmış problem üretebilmeli; üretemeyenler açıklamalı döner. */
export function verifyFaultStages(faultId: string, stages: StageDef[], seeds = DIFFICULTY_SEEDS): string[] {
  const problems: string[] = [];
  for (const s of stages) {
    try {
      const check =
        s.type === 'series-led'
          ? ((cfg) => (seed: number) => generateSeriesLed(cfg, seed))(parseSeriesLedConfig(s.config))
          : s.type === 'ds-trace'
            ? ((cfg) => (seed: number) => generateDsTrace(cfg, seed))(parseDsTraceConfig(structuredClone(s.config)))
            : ((cfg) => (seed: number) => generateSeriesParallel(cfg, seed))(parseSeriesParallelConfig(s.config));
      for (let seed = 1; seed <= seeds; seed++) check(seed);
    } catch (e) {
      problems.push(`arıza '${faultId}' aşama '${s.id}': zorluk ayarıyla doğrulanabilir problem üretilemiyor (${(e as Error).message.split('\n')[0]})`);
    }
  }
  return problems;
}
