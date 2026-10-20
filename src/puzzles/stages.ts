// Aşama adaptörleri: her problem türünü ortak bir arayüze bağlar (üret → panel aç → değerlendir).
// main.ts türden bağımsızdır; yeni problem türü = buraya bir adaptör kaydı.

import type { Rng } from '../core/rng';
import type { Outcome, StageDef, StageResult } from '../core/types';
import { parseSeriesLedConfig, solveSeriesLed } from '../solvers/circuit/series-led';
import { generateSeriesLed } from '../solvers/circuit/series-led.generate';
import { resolveOutcome } from '../solvers/circuit/series-led.outcomes';
import { buildSeriesLedReport } from '../solvers/circuit/series-led.report';
import { parseSeriesParallelConfig } from '../solvers/circuit/series-parallel';
import { generateSeriesParallel } from '../solvers/circuit/series-parallel.generate';
import { evaluatePlacement } from '../solvers/circuit/series-parallel.outcomes';
import { buildSeriesParallelReport } from '../solvers/circuit/series-parallel.report';
import { openCircuitBoardPanel } from './circuit-board/panel';
import { openSeriesCircuitPanel } from './series-circuit/panel';

export interface StagePanelContext {
  root: HTMLElement;
  title: string;
  briefing: string;
  onSubmit: (answer: unknown) => void;
  onCancel: () => void;
  onSound: (s: 'click' | 'switch') => void;
}

/** Üretilmiş, doğrulanmış tek bir aşama problemi. */
export interface StageRun {
  open: (ctx: StagePanelContext) => void;
  evaluate: (answer: unknown, rng: Rng) => { outcome: Outcome; result: StageResult };
}

interface StageAdapter {
  /** İçerik yapılandırmasını doğrular (açılışta, hatalı içerik erken yakalansın). */
  validate: (def: StageDef) => void;
  prepare: (def: StageDef, seed: number) => StageRun;
}

const ADAPTERS: Record<StageDef['type'], StageAdapter> = {
  'series-led': {
    validate: (def) => void parseSeriesLedConfig(def.config),
    prepare(def, seed) {
      const problem = generateSeriesLed(parseSeriesLedConfig(def.config), seed);
      return {
        open: (ctx) =>
          openSeriesCircuitPanel(ctx.root, {
            title: ctx.title,
            briefing: ctx.briefing,
            problem,
            onSound: ctx.onSound,
            onCancel: ctx.onCancel,
            onSubmit: (id) => ctx.onSubmit(id),
          }),
        evaluate(answer, rng) {
          const id = answer as string;
          const choice = problem.choices.find((c) => c.id === id);
          if (!choice) throw new Error(`Geçersiz seçim: ${id}`);
          const sol = solveSeriesLed(problem.spec.vs, problem.spec.led.model, choice.r);
          const outcome = resolveOutcome(problem.spec, sol, rng);
          return { outcome, result: buildSeriesLedReport(def.id, problem, id, outcome) };
        },
      };
    },
  },
  'series-parallel': {
    validate: (def) => void parseSeriesParallelConfig(def.config),
    prepare(def, seed) {
      const config = parseSeriesParallelConfig(def.config);
      const problem = generateSeriesParallel(config, seed);
      return {
        open: (ctx) =>
          openCircuitBoardPanel(ctx.root, {
            title: ctx.title,
            briefing: ctx.briefing,
            config,
            problem,
            onSound: ctx.onSound,
            onCancel: ctx.onCancel,
            onSubmit: (placement) => ctx.onSubmit(placement),
          }),
        evaluate(answer, rng) {
          const placement = answer as Record<string, string>;
          const ev = evaluatePlacement(config, problem, placement, rng);
          return { outcome: ev.outcome, result: buildSeriesParallelReport(def.id, config, problem, placement, ev, ev.outcome) };
        },
      };
    },
  },
};

export function validateStage(def: StageDef): void {
  const a = ADAPTERS[def.type];
  if (!a) throw new Error(`Bilinmeyen aşama türü: ${def.type}`);
  a.validate(def);
}

export function prepareStage(def: StageDef, seed: number): StageRun {
  return ADAPTERS[def.type].prepare(def, seed);
}
