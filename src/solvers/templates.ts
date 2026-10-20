// LLM'in önerdiği şablon adaylarını doğrular (altın kural 1: LLM öneri yapar, doğruyu kod hesaplar).
// Her aday sırayla: alan/tip/aralık denetimi → türün yapılandırmasına dönüştürme → mevcut
// ayrıştırıcı → birçok tohumda üretim (her üretim mevcut doğrulayıcıdan geçmek zorunda) → tekrar
// denetimi. Geçemeyen aday havuza girmez; nedeni raporlanır.

import type { StageDef } from '../core/types';
import { e12Values } from './circuit/e-series';
import { parseSeriesLedConfig } from './circuit/series-led';
import { generateSeriesLed } from './circuit/series-led.generate';
import { parseSeriesParallelConfig } from './circuit/series-parallel';
import { generateSeriesParallel } from './circuit/series-parallel.generate';

/** LLM'in aday önerebildiği türler. Trace (ds-trace) bu adımda yalnız elle yazılmış şablonlarla gelir. */
export type TemplateType = Exclude<StageDef['type'], 'ds-trace'>;

/** Kabul için her adayın bu kadar farklı tohumda doğrulanmış problem üretmesi gerekir. */
export const TEMPLATE_SEEDS = 20;
export const MAX_CANDIDATES = 8;

export interface TopicRef {
  id: string;
  name: string;
  courseName: string;
  briefing: string;
}

export interface ValidationRun {
  type: TemplateType;
  total: number;
  accepted: StageDef[];
  rejected: { index: number; reason: string }[];
}

class Reject extends Error {}
const reject = (msg: string): never => {
  throw new Reject(msg);
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function onlyKeys(o: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  if (extra.length) reject(`bilinmeyen alan: ${extra.join(', ')}`);
  const missing = allowed.filter((k) => !(k in o));
  if (missing.length) reject(`eksik alan: ${missing.join(', ')}`);
}

function numVal(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) reject(`'${label}' sayı değil`);
  if ((v as number) < min || (v as number) > max) reject(`'${label}' = ${v}; izinli aralık ${min}–${max}`);
  return v as number;
}

const num = (o: Record<string, unknown>, k: string, min: number, max: number) => numVal(o[k], k, min, max);

function str(o: Record<string, unknown>, k: string, maxLen: number): string {
  const v = o[k];
  if (typeof v !== 'string' || !v.trim()) reject(`'${k}' boş ya da metin değil`);
  if ((v as string).length > maxLen) reject(`'${k}' çok uzun (en fazla ${maxLen} karakter)`);
  return (v as string).trim();
}

function numList(o: Record<string, unknown>, k: string, maxItems: number, min: number, max: number): number[] {
  const v = o[k];
  if (!Array.isArray(v) || v.length === 0 || v.length > maxItems) reject(`'${k}' 1–${maxItems} öğeli dizi olmalı`);
  return (v as unknown[]).map((x, i) => numVal(x, `${k}[${i}]`, min, max));
}

function e12Range(o: Record<string, unknown>, k: string): [number, number] {
  const v = o[k];
  if (!Array.isArray(v) || v.length !== 2) reject(`'${k}' [min, max] olmalı`);
  const [lo, hi] = (v as unknown[]).map((x, i) => numVal(x, `${k}[${i}]`, 1, 1_000_000));
  if (!(lo < hi)) reject(`'${k}' ters ya da boş aralık`);
  if (e12Values(lo, hi).length === 0) reject(`'${k}' içinde E12 değeri yok`);
  return [lo, hi];
}

// ---------------------------------------------------------------- türlere göre dönüştürme

const LED_KEYS = ['title', 'story', 'supplyVoltages', 'leds', 'targetMin_mA', 'targetMax_mA', 'absMax_mA', 'visibleMin_mA', 'fuse_mA', 'resistorRating_W'];
const SP_KEYS = ['title', 'story', 'Vs_choices', 'Rm_range', 'Rold_range', 'R1_range', 'R2_range', 'tolerance', 'slotRating_W'];

function ledConfig(c: Record<string, unknown>): object {
  onlyKeys(c, LED_KEYS);
  const leds = c.leds;
  if (!Array.isArray(leds) || leds.length === 0 || leds.length > 4) reject("'leds' 1–4 öğeli dizi olmalı");
  return {
    supplyVoltages: numList(c, 'supplyVoltages', 4, 1, 48),
    leds: (leds as unknown[]).map((l, i) => {
      if (!isObj(l)) return reject(`leds[${i}] nesne değil`);
      onlyKeys(l, ['color', 'vf']);
      return { color: str(l, 'color', 20), vf: num(l, 'vf', 1, 4.5) };
    }),
    targetMin_mA: num(c, 'targetMin_mA', 0.1, 2000),
    targetMax_mA: num(c, 'targetMax_mA', 0.1, 2000),
    absMax_mA: num(c, 'absMax_mA', 0.1, 2000),
    visibleMin_mA: num(c, 'visibleMin_mA', 0.01, 2000),
    fuse_mA: num(c, 'fuse_mA', 0.1, 10000),
    resistorRating_W: num(c, 'resistorRating_W', 0.05, 10),
  };
}

/** Topoloji ve çözüm zinciri temel şablondan gelir; LLM yalnız sayısal aralıkları değiştirir. */
function spConfig(c: Record<string, unknown>, base: StageDef): object {
  onlyKeys(c, SP_KEYS);
  const cfg = structuredClone(base.config) as {
    params: Record<string, { choices?: number[]; e12?: [number, number] }>;
    answer: Record<string, [number, number]>;
    targets: { tolerance: number }[];
    limits: { slotRating_W: number };
  };
  cfg.params.Vs.choices = numList(c, 'Vs_choices', 4, 1, 60);
  cfg.params.Rm.e12 = e12Range(c, 'Rm_range');
  cfg.params.Rold.e12 = e12Range(c, 'Rold_range');
  cfg.answer.R1 = e12Range(c, 'R1_range');
  cfg.answer.R2 = e12Range(c, 'R2_range');
  const tol = num(c, 'tolerance', 0.02, 0.08);
  for (const t of cfg.targets) t.tolerance = tol;
  cfg.limits.slotRating_W = num(c, 'slotRating_W', 0.25, 50);
  return cfg;
}

const KINDS: Record<TemplateType, { build: (c: Record<string, unknown>, base: StageDef) => object; check: (cfg: unknown, seed: number) => void }> = {
  'series-led': {
    build: (c) => ledConfig(c),
    check: (cfg, seed) => void generateSeriesLed(parseSeriesLedConfig(cfg), seed),
  },
  'series-parallel': {
    build: spConfig,
    check: (cfg, seed) => void generateSeriesParallel(parseSeriesParallelConfig(cfg), seed),
  },
};

// ---------------------------------------------------------------- ana giriş

export function validateCandidates(
  type: TemplateType,
  raw: unknown,
  ctx: { base: StageDef; topic: TopicRef; existing: StageDef[]; seeds?: number },
): ValidationRun {
  const run: ValidationRun = { type, total: 0, accepted: [], rejected: [] };
  if (!Array.isArray(raw)) {
    run.rejected.push({ index: -1, reason: 'yanıt aday dizisi değil' });
    return run;
  }
  run.total = raw.length;
  const seen = new Set([ctx.base, ...ctx.existing].filter((s) => s.type === type).map((s) => JSON.stringify(s.config)));
  const seeds = ctx.seeds ?? TEMPLATE_SEEDS;

  raw.forEach((c, index) => {
    try {
      if (index >= MAX_CANDIDATES) reject(`en fazla ${MAX_CANDIDATES} aday işlenir`);
      if (!isObj(c)) reject('aday bir nesne değil');
      const cand = c as Record<string, unknown>;
      const title = str(cand, 'title', 80);
      const story = str(cand, 'story', 300);
      const kind = KINDS[type];
      const config = kind.build(cand, ctx.base);
      const key = JSON.stringify(config);
      if (seen.has(key)) reject('aynı şablon havuzda zaten var');
      for (let seed = 1; seed <= seeds; seed++) {
        try {
          kind.check(config, seed);
        } catch (e) {
          reject(`${seed}. tohumda doğrulanabilir problem yok: ${(e as Error).message}`);
        }
      }
      seen.add(key);
      run.accepted.push({
        id: `tpl:${ctx.topic.id}:${type}:${index}`,
        type,
        title,
        briefing: `${story} ${ctx.topic.briefing}`,
        config,
        source: { topicId: ctx.topic.id, topicName: ctx.topic.name, courseName: ctx.topic.courseName },
      });
    } catch (e) {
      if (!(e instanceof Reject)) {
        run.rejected.push({ index, reason: `beklenmeyen hata: ${(e as Error).message}` });
        return;
      }
      run.rejected.push({ index, reason: e.message });
    }
  });
  return run;
}
