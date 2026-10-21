// Aşama adaptörleri: her problem türünü ortak bir arayüze bağlar (üret → panel aç → değerlendir).
// main.ts türden bağımsızdır; yeni problem türü = buraya bir adaptör kaydı.

import { checkStageTags } from '../core/courses';
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
import { parseMaxPowerConfig } from '../solvers/circuit/max-power';
import { generateMaxPower } from '../solvers/circuit/max-power.generate';
import { resolveMaxPowerOutcome } from '../solvers/circuit/max-power.outcomes';
import { buildMaxPowerReport } from '../solvers/circuit/max-power.report';
import { parseOpampConfig } from '../solvers/circuit/opamp';
import { generateOpamp } from '../solvers/circuit/opamp.generate';
import { resolveOpampOutcome } from '../solvers/circuit/opamp.outcomes';
import { buildOpampReport } from '../solvers/circuit/opamp.report';
import { parseDiodeConfig } from '../solvers/circuit/diode';
import { generateDiode } from '../solvers/circuit/diode.generate';
import { buildDiodeReport, resolveDiodeOutcome } from '../solvers/circuit/diode.outcomes';
import { parseFilterConfig } from '../solvers/circuit/filter';
import { generateFilter } from '../solvers/circuit/filter.generate';
import { buildFilterReport, resolveFilterOutcome } from '../solvers/circuit/filter.outcomes';
import { parseSuperConfig } from '../solvers/circuit/superposition';
import { generateSuper } from '../solvers/circuit/superposition.generate';
import { buildSuperReport, resolveSuperOutcome } from '../solvers/circuit/superposition.outcomes';
import { formatUnit } from '../solvers/circuit/design-core';
import { parseTheveninConfig } from '../solvers/circuit/thevenin';
import { generateThevenin } from '../solvers/circuit/thevenin.generate';
import { resolveTheveninOutcome, type TheveninAnswer } from '../solvers/circuit/thevenin.outcomes';
import { buildTheveninReport } from '../solvers/circuit/thevenin.report';
import { generateDsTrace } from '../solvers/ds/ds-trace.generate';
import { resolveTraceOutcome, type TraceAnswer } from '../solvers/ds/ds-trace.outcomes';
import { buildDsTraceReport } from '../solvers/ds/ds-trace.report';
import { parseDsTraceConfig } from '../solvers/ds/ir';
import { parseDampingConfig } from '../solvers/ode/damping';
import { generateDamping } from '../solvers/ode/damping.generate';
import { buildDampingReport, resolveDampingOutcome } from '../solvers/ode/damping.outcomes';
import { parseStabilityConfig } from '../solvers/math/stability';
import { generateStability } from '../solvers/math/stability.generate';
import { buildStabilityReport, resolveStabilityOutcome } from '../solvers/math/stability.outcomes';
import { parseLaplaceConfig } from '../solvers/math/laplace';
import { buildLaplaceReport, generateLaplace, resolveLaplaceOutcome, type LaplaceAnswer } from '../solvers/math/laplace.generate';
import { parsePhasorConfig } from '../solvers/math/phasor';
import { buildPhasorReport, generatePhasor, resolvePhasorOutcome, type PhasorAnswer } from '../solvers/math/phasor.generate';
import { parseProbConfig } from '../solvers/prob/probability';
import { BAYES_TEXT, buildProbReport, generateProb, resolveProbOutcome } from '../solvers/prob/probability.generate';
import { buildAlgoReport, generateAlgoTrace, parseAlgoTraceConfig, resolveAlgoOutcome, type AlgoTraceAnswer } from '../solvers/algo/algo-trace';
import { openAlgoTracePanel } from './algo-trace/panel';
import { buildCsReport, generateCsOutput, parseCsOutputConfig, resolveCsOutcome } from '../solvers/cs/cs-output';
import { CS_GENERATED, CS_TEMPLATES } from '../solvers/cs/content';
import { openCsOutputPanel } from './cs-output/panel';
import { parseLightDecayConfig } from '../solvers/ode/light-decay';
import { buildLightDecayReport, generateLightDecay, resolveLightDecayOutcome } from '../solvers/ode/light-decay.generate';
import { parseRcRlConfig } from '../solvers/ode/rc-rl';
import { generateRcRl } from '../solvers/ode/rc-rl.generate';
import { resolveRcRlOutcome } from '../solvers/ode/rc-rl.outcomes';
import { buildRcRlReport } from '../solvers/ode/rc-rl.report';
import { laplaceSvg, openDampingPanel, openLightDecayPanel, openOpampPanel, openRcRlPanel, openStabilityPanel } from './airlock/panels';
import { schematicSvg } from './circuit-board/schematic';
import { openNumericPanel } from './generic/numeric-panel';
import { openCircuitBoardPanel } from './circuit-board/panel';
import { openSeriesCircuitPanel } from './series-circuit/panel';
import { openDiodePanel, openMaxPowerPanel, openTheveninPanel } from './power/panels';
import { bayesSvg, openFilterPanel, openRedundancyPanel, phasorWavesSvg } from './sensor/panels';
import { openTracePanel } from './trace-table/panel';

export interface StagePanelContext {
  root: HTMLElement;
  title: string;
  briefing: string;
  onSubmit: (answer: unknown) => void;
  onCancel: () => void;
  onSound: (s: 'click' | 'switch') => void;
  source?: { label: string; onFlag: () => void };
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
            source: ctx.source,
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
            source: ctx.source,
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
  'ds-trace': {
    validate: (def) => void parseDsTraceConfig(structuredClone(def.config)),
    prepare(def, seed) {
      const problem = generateDsTrace(parseDsTraceConfig(structuredClone(def.config)), seed);
      return {
        open: (ctx) =>
          openTracePanel(ctx.root, {
            title: ctx.title,
            briefing: ctx.briefing,
            problem,
            onSound: ctx.onSound,
            onCancel: ctx.onCancel,
            source: ctx.source,
            onSubmit: (a) => ctx.onSubmit(a),
          }),
        evaluate(answer, rng) {
          const a = answer as TraceAnswer;
          const outcome = resolveTraceOutcome(problem, a, rng);
          return { outcome, result: buildDsTraceReport(def.id, problem, a, outcome) };
        },
      };
    },
  },
  thevenin: {
    validate: (def) => void parseTheveninConfig(def.config),
    prepare(def, seed) {
      const problem = generateThevenin(parseTheveninConfig(def.config), seed);
      return {
        open: (ctx) => openTheveninPanel(ctx.root, { ...ctx, problem, onSubmit: (a) => ctx.onSubmit(a) }),
        evaluate(answer) {
          const a = answer as TheveninAnswer;
          const outcome = resolveTheveninOutcome(problem, a);
          return { outcome, result: buildTheveninReport(def.id, problem, a, outcome) };
        },
      };
    },
  },
  'max-power': {
    validate: (def) => void parseMaxPowerConfig(def.config),
    prepare(def, seed) {
      const config = parseMaxPowerConfig(def.config);
      const problem = generateMaxPower(config, seed);
      return {
        open: (ctx) => openMaxPowerPanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const id = answer as string;
          const outcome = resolveMaxPowerOutcome(problem, id);
          return { outcome, result: buildMaxPowerReport(def.id, config, problem, id, outcome) };
        },
      };
    },
  },
  opamp: {
    validate: (def) => void parseOpampConfig(def.config),
    prepare(def, seed) {
      const problem = generateOpamp(parseOpampConfig(def.config), seed);
      return {
        open: (ctx) => openOpampPanel(ctx.root, { ...ctx, problem, onSubmit: (pl) => ctx.onSubmit(pl) }),
        evaluate(answer) {
          const pl = answer as Record<string, string>;
          const outcome = resolveOpampOutcome(problem, pl);
          return { outcome, result: buildOpampReport(def.id, problem, pl, outcome) };
        },
      };
    },
  },
  'rc-rl': {
    validate: (def) => void parseRcRlConfig(def.config),
    prepare(def, seed) {
      const problem = generateRcRl(parseRcRlConfig(def.config), seed);
      return {
        open: (ctx) => openRcRlPanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const id = answer as string;
          const outcome = resolveRcRlOutcome(problem, id);
          return { outcome, result: buildRcRlReport(def.id, problem, id, outcome) };
        },
      };
    },
  },
  superposition: {
    validate: (def) => void parseSuperConfig(def.config),
    prepare(def, seed) {
      const problem = generateSuper(parseSuperConfig(def.config), seed);
      const n = problem.network;
      const unit = n.params[n.unknown].unit;
      return {
        open: (ctx) =>
          openNumericPanel(ctx.root, {
            ...ctx,
            info: [
              { heading: 'Bara kaydı', text: `${n.story} Her iki kaynak açıkken ölçülen ${n.probeLabel}: ${formatUnit(problem.measured, n.probeUnit)}.` },
              { heading: 'Görev', text: `${n.params[n.unknown].label} değerini bul; yedek jeneratör bu değere ayarlanacak.` },
            ],
            drawing: schematicSvg(n, { filled: {}, armed: false, visible: Object.fromEntries(Object.entries(problem.params).filter(([k]) => k !== n.unknown)) }),
            fields: [{ id: 'x', label: `${n.params[n.unknown].label} (${unit})`, unit: unit === 'Ω' || unit === 'W' ? 'Ω' : unit }],
            note: `Kabul: ±%${Math.round(problem.tolerance * 100)}. Virgül ya da nokta, k/m önekleri olur.`,
            submitLabel: 'Jeneratörü ayarla',
            onSubmit: (v) => ctx.onSubmit(v.x),
          }),
        evaluate(answer) {
          const v = answer as number;
          const outcome = resolveSuperOutcome(problem, v);
          return { outcome, result: buildSuperReport(def.id, problem, v, outcome) };
        },
      };
    },
  },
  diode: {
    validate: (def) => void parseDiodeConfig(def.config),
    prepare(def, seed) {
      const problem = generateDiode(parseDiodeConfig(def.config), seed);
      return {
        open: (ctx) => openDiodePanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const id = answer as string;
          const outcome = resolveDiodeOutcome(problem, id);
          return { outcome, result: buildDiodeReport(def.id, problem, id, outcome) };
        },
      };
    },
  },
  filter: {
    validate: (def) => void parseFilterConfig(def.config),
    prepare(def, seed) {
      const problem = generateFilter(parseFilterConfig(def.config), seed);
      return {
        open: (ctx) => openFilterPanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const id = answer as string;
          const outcome = resolveFilterOutcome(problem, id);
          return { outcome, result: buildFilterReport(def.id, problem, id, outcome) };
        },
      };
    },
  },
  damping: {
    validate: (def) => void parseDampingConfig(def.config),
    prepare(def, seed) {
      const problem = generateDamping(parseDampingConfig(def.config), seed);
      return {
        open: (ctx) => openDampingPanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const id = answer as string;
          const outcome = resolveDampingOutcome(problem, id);
          return { outcome, result: buildDampingReport(def.id, problem, id, outcome) };
        },
      };
    },
  },
  stability: {
    validate: (def) => void parseStabilityConfig(def.config),
    prepare(def, seed) {
      const problem = generateStability(parseStabilityConfig(def.config), seed);
      return {
        open: (ctx) => openStabilityPanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const id = answer as string;
          const outcome = resolveStabilityOutcome(problem, id);
          return { outcome, result: buildStabilityReport(def.id, problem, id, outcome) };
        },
      };
    },
  },
  laplace: {
    validate: (def) => void parseLaplaceConfig(def.config),
    prepare(def, seed) {
      const problem = generateLaplace(parseLaplaceConfig(def.config), seed);
      return {
        open: (ctx) =>
          openNumericPanel(ctx.root, {
            ...ctx,
            info: [
              { heading: 'Pompa modeli', text: `Kilit basıncı y, dolum komutu U'ya G(s) transfer fonksiyonuyla bağlı; komut t = 0'da basamak olarak verilir, kilit başta boş (y(0) = 0).` },
              { heading: 'Görev', text: 'Koruma denetleyicisine iki sayı girilecek: beklenen son basınç y(∞) ve ilk anki artış hızı y′(0⁺). Benzetim yapmadan, Laplace teoremleriyle bul.' },
            ],
            drawing: laplaceSvg(problem),
            fields: [
              { id: 'final', label: 'Son basınç y(∞) (bar)', unit: '' },
              { id: 'slope', label: 'İlk artış hızı y′(0⁺) (bar/s)', unit: '' },
            ],
            note: `Kabul: her biri ±%${Math.round(problem.tolerance * 100)}. Virgül ya da nokta olur.`,
            submitLabel: 'Eşikleri yükle',
            onSubmit: (v) => ctx.onSubmit({ final: v.final, slope: v.slope }),
          }),
        evaluate(answer) {
          const a = answer as LaplaceAnswer;
          const outcome = resolveLaplaceOutcome(problem, a);
          return { outcome, result: buildLaplaceReport(def.id, problem, a, outcome) };
        },
      };
    },
  },
  phasor: {
    validate: (def) => void parsePhasorConfig(def.config),
    prepare(def, seed) {
      const problem = generatePhasor(parsePhasorConfig(def.config), seed);
      return {
        open: (ctx) =>
          openNumericPanel(ctx.root, {
            ...ctx,
            info: [
              { heading: 'Hidrofon kaydı', text: `İki hidrofon aynı frekansta yankı alıyor: v₁ = ${problem.w1.a.toString().replace('.', ',')}·cos(ωt ${problem.w1.phi < 0 ? '−' : '+'} ${Math.abs(problem.w1.phi)}°) mV, v₂ = ${problem.w2.a.toString().replace('.', ',')}·cos(ωt ${problem.w2.phi < 0 ? '−' : '+'} ${Math.abs(problem.w2.phi)}°) mV.` },
              { heading: 'Görev', text: 'Işın oluşturucu toplam sinyali v = A·cos(ωt + φ) biçiminde bekliyor. A ve φ\'yi gir (φ: −180° ile 180° arası).' },
            ],
            drawing: phasorWavesSvg(problem),
            fields: [
              { id: 'a', label: 'Genlik A (mV)', unit: '' },
              { id: 'phi', label: 'Faz φ (derece)', unit: '', signed: true },
            ],
            note: `Kabul: genlik ±%${Math.round(problem.ampTol * 100)}, faz ±${problem.phaseTol}°. Virgül ya da nokta olur.`,
            submitLabel: 'Işını eşle',
            onSubmit: (v) => ctx.onSubmit({ a: v.a, phi: v.phi }),
          }),
        evaluate(answer) {
          const a = answer as PhasorAnswer;
          const outcome = resolvePhasorOutcome(problem, a);
          return { outcome, result: buildPhasorReport(def.id, problem, a, outcome) };
        },
      };
    },
  },
  probability: {
    validate: (def) => void parseProbConfig(def.config),
    prepare(def, seed) {
      const problem = generateProb(parseProbConfig(def.config), seed);
      return {
        open: (ctx) =>
          problem.variant === 'bayes'
            ? openNumericPanel(ctx.root, {
                ...ctx,
                info: [
                  {
                    heading: 'Sensör kaydı',
                    text: `${BAYES_TEXT[problem.theme].prior} %${String(problem.input.prior).replace('.', ',')}. İki algılayıcı birbirinden bağımsız çalışır. ${problem.input.obs === 'both' ? BAYES_TEXT[problem.theme].both : BAYES_TEXT[problem.theme].firstOnly}`,
                  },
                  { heading: 'Görev', text: BAYES_TEXT[problem.theme].task },
                ],
                drawing: bayesSvg(problem),
                fields: [{ id: 'p', label: BAYES_TEXT[problem.theme].field, unit: '%' }],
                note: `Kabul: ±${(problem.tolerance * 100).toFixed(1).replace('.', ',')} puan. "12,5" ya da "12,5%" yazabilirsin.`,
                submitLabel: 'Kararı gönder',
                onSubmit: (v) => ctx.onSubmit(v.p),
              })
            : openRedundancyPanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const x = problem.variant === 'bayes' ? (answer as number) : problem.bin.find((b) => b.id === answer)!.n;
          const outcome = resolveProbOutcome(problem, x);
          return { outcome, result: buildProbReport(def.id, problem, x, outcome) };
        },
      };
    },
  },
  'algo-trace': {
    validate: (def) => void parseAlgoTraceConfig(def.config),
    prepare(def, seed) {
      const problem = generateAlgoTrace(parseAlgoTraceConfig(def.config), seed);
      return {
        open: (ctx) => openAlgoTracePanel(ctx.root, { ...ctx, problem, onSubmit: (a) => ctx.onSubmit(a) }),
        evaluate(answer, rng) {
          const a = answer as AlgoTraceAnswer;
          const outcome = resolveAlgoOutcome(problem, a, rng);
          return { outcome, result: buildAlgoReport(def.id, problem, a, outcome) };
        },
      };
    },
  },
  'cs-output': {
    validate: (def) => void parseCsOutputConfig(def.config, CS_TEMPLATES, CS_GENERATED),
    prepare(def, seed) {
      const problem = generateCsOutput(parseCsOutputConfig(def.config, CS_TEMPLATES, CS_GENERATED), seed, CS_TEMPLATES, CS_GENERATED);
      return {
        open: (ctx) => openCsOutputPanel(ctx.root, { ...ctx, problem, onSubmit: (lines) => ctx.onSubmit(lines) }),
        evaluate(answer) {
          const lines = answer as string[];
          const outcome = resolveCsOutcome(problem, lines);
          return { outcome, result: buildCsReport(def.id, problem, lines, outcome) };
        },
      };
    },
  },
  'light-decay': {
    validate: (def) => void parseLightDecayConfig(def.config),
    prepare(def, seed) {
      const problem = generateLightDecay(parseLightDecayConfig(def.config), seed);
      return {
        open: (ctx) => openLightDecayPanel(ctx.root, { ...ctx, problem, onSubmit: (id) => ctx.onSubmit(id) }),
        evaluate(answer) {
          const id = answer as string;
          const outcome = resolveLightDecayOutcome(problem, id);
          return { outcome, result: buildLightDecayReport(def.id, problem, id, outcome) };
        },
      };
    },
  },
};

export function validateStage(def: StageDef): void {
  const a = ADAPTERS[def.type];
  if (!a) throw new Error(`Bilinmeyen aşama türü: ${def.type}`);
  checkStageTags(def);
  a.validate(def);
}

export function prepareStage(def: StageDef, seed: number): StageRun {
  return ADAPTERS[def.type].prepare(def, seed);
}
