// Seri-paralel ters problem türü: topoloji, gizli parametre, ölçüm, hedefler, çözüm zinciri,
// tuzaklar ve rapor adımları içerik JSON'undan gelir. Fizik genel MNA çözücüsüyle hesaplanır;
// yeni topoloji eklemek kod gerektirmez.

import { namesIn, type Scope } from '../../core/expr';
import {
  buildNetlist as coreNetlist,
  evalDerived,
  readProbe,
  type ElementDef,
  type Layout,
  type ParamDef,
  type Probe,
  type SlotValues,
  type Unit,
} from './design-core';
import { solveDC, type DcSolution, type Element } from './mna';

// Ortak çekirdek (design-core.ts) buradan da dışa verilir; mevcut içe aktarmalar değişmeden çalışır.
export { fillTemplate, formatUnit, nearestE12, readProbe, shown } from './design-core';
export type { ElementDef, Layout, ParamDef, Probe, SlotValues, Unit } from './design-core';

export interface TargetDef {
  id: string;
  label: string;
  probe: Probe;
  unit: Unit;
  /** Göreli tolerans (0.04 = ±%4). */
  tolerance: number;
}

export interface SeriesParallelConfig {
  elements: ElementDef[];
  params: Record<string, ParamDef>;
  /** Her yuva için cevabın E12 aralığı. */
  answer: Record<string, [number, number]>;
  measurement: {
    id: string;
    set: Record<string, string>;
    open: string[];
    probe: Probe;
    unit: Unit;
    identifies: string;
    text: string;
  };
  targets: TargetDef[];
  roles: { load: string; supply: string };
  limits: { slotRating_W: number };
  /** Üretimde gerçekçilik sınırları: yük akımı aralığı ve düğüm geriliminin kaynağa oranı. */
  plausible: { load: [number, number]; node: string; nodeFraction: [number, number] };
  binSize: number;
  derived: Record<string, string>;
  solution: Record<string, string>;
  mistakes: { expr: string; text: string }[];
  steps: string[];
  reportProbes: { label: string; probe: Probe; unit: Unit }[];
  layout: Layout;
}

export const slotIds = (c: SeriesParallelConfig) => c.elements.filter((e) => e.slot).map((e) => e.id);

// ---------------------------------------------------------------- ayrıştırma

export function parseSeriesParallelConfig(raw: unknown): SeriesParallelConfig {
  const c = raw as SeriesParallelConfig;
  const fail = (m: string): never => {
    throw new Error(`series-parallel yapılandırması: ${m}`);
  };
  if (!c || !Array.isArray(c.elements) || c.elements.length < 3) fail('en az 3 eleman gerekir');
  const ids = new Set(c.elements.map((e) => e.id));
  if (ids.size !== c.elements.length) fail('eleman kimlikleri tekil değil');
  const nodes = new Set(c.elements.flatMap((e) => [e.a, e.b]));
  const slots = slotIds(c);
  if (slots.length < 2) fail('en az 2 yuva gerekir');
  for (const e of c.elements) {
    if (e.slot && e.kind !== 'R') fail(`yuva '${e.id}' direnç olmalı`);
    if (!e.slot && !(e.value && e.value in c.params)) fail(`'${e.id}' için parametre yok`);
  }
  if (!c.elements.filter((e) => e.kind === 'R').length) fail('direnç yok');
  for (const s of slots) if (!c.answer?.[s]) fail(`yuva '${s}' için cevap aralığı yok`);
  for (const [k, p] of Object.entries(c.params)) if (!p.choices?.length && !p.e12) fail(`parametre '${k}' için aralık yok`);
  const probeOk = (p: Probe) =>
    'voltage' in p ? nodes.has(p.voltage) : 'current' in p ? ids.has(p.current) : ids.has(p.power);
  const m = c.measurement;
  if (!m || !probeOk(m.probe)) fail('ölçüm noktası geçersiz');
  if (!(m.identifies in c.params) || !c.params[m.identifies].hidden) fail('ölçüm gizli bir parametreyi tanımlamalı');
  for (const [s, prm] of Object.entries(m.set)) if (!slots.includes(s) || !(prm in c.params)) fail(`ölçüm ataması '${s}'`);
  for (const s of m.open) if (!slots.includes(s)) fail(`ölçümde açık yuva '${s}'`);
  for (const t of c.targets) if (!probeOk(t.probe) || !(t.tolerance > 0)) fail(`hedef '${t.id}'`);
  const targetIds = c.targets.map((t) => t.id);
  if (!targetIds.includes(c.roles.load) || !targetIds.includes(c.roles.supply)) fail('roller hedeflere bağlı değil');
  for (const r of c.reportProbes) if (!probeOk(r.probe)) fail(`rapor ölçümü '${r.label}'`);

  // İfadelerde geçen her ad tanımlı olmalı (içerikteki yazım hatalarını erken yakala).
  const known = new Set([...Object.keys(c.params).filter((k) => !c.params[k].hidden), m.id, ...targetIds]);
  for (const [k, ex] of Object.entries(c.derived)) {
    for (const n of namesIn(ex)) if (!known.has(n)) fail(`türetilen '${k}' içinde bilinmeyen '${n}'`);
    known.add(k);
  }
  for (const s of slots) {
    const ex = c.solution[s];
    if (!ex) fail(`yuva '${s}' için çözüm ifadesi yok`);
    for (const n of namesIn(ex)) if (!known.has(n)) fail(`çözüm '${s}' içinde bilinmeyen '${n}'`);
  }
  for (const mk of c.mistakes) for (const n of namesIn(mk.expr)) if (!known.has(n)) fail(`tuzak içinde bilinmeyen '${n}'`);
  const stepNames = new Set([...known, ...slots]);
  for (const st of [...c.steps, m.text]) {
    for (const [, n] of st.matchAll(/\{(\w+):[^}]+\}/g)) if (!stepNames.has(n)) fail(`metinde bilinmeyen '{${n}}'`);
  }
  for (const id of ids) if (!c.layout?.elements?.[id]) fail(`'${id}' için şema konumu yok`);
  if (!(c.binSize >= slots.length + 2)) fail('kutu en az yuva sayısı + 2 direnç içermeli');
  return c;
}

// ---------------------------------------------------------------- devre kurma ve ölçüm

/** Netlist: yuvaya değer verilmemişse (undefined) eleman yok = açık devre. */
export function buildNetlist(c: SeriesParallelConfig, params: Scope, slots: SlotValues): Element[] {
  return coreNetlist(c.elements, params, slots);
}

export function solveWith(c: SeriesParallelConfig, params: Scope, slots: SlotValues): DcSolution {
  return solveDC(buildNetlist(c, params, slots));
}

/** Ölçüm senaryosu: bazı yuvalara eski parçalar takılı, bazıları sökülü. */
export function measure(c: SeriesParallelConfig, params: Scope): number {
  const slots: SlotValues = {};
  for (const [s, prm] of Object.entries(c.measurement.set)) slots[s] = params[prm];
  return readProbe(solveWith(c, params, slots), c.measurement.probe);
}

// ---------------------------------------------------------------- sınıflandırma (fizik)

export type SpZone = 'ok' | 'fuse' | 'stall' | 'slow' | 'over_mild' | 'over_severe' | 'regulator_low' | 'resistor_overheat';

export const STALL_RATIO = 0.5;
export const SEVERE_RATIO = 1.5;

export interface Reading {
  load: number;
  supply: number;
  loadTarget: number;
  supplyTarget: number;
  loadTol: number;
  supplyTol: number;
  slotPowerMax: number;
  rating: number;
}

export function readingFor(c: SeriesParallelConfig, s: DcSolution, shownTargets: Record<string, number>): Reading {
  const t = (id: string) => c.targets.find((x) => x.id === id)!;
  const load = t(c.roles.load);
  const supply = t(c.roles.supply);
  return {
    load: readProbe(s, load.probe),
    supply: readProbe(s, supply.probe),
    loadTarget: shownTargets[load.id],
    supplyTarget: shownTargets[supply.id],
    loadTol: load.tolerance,
    supplyTol: supply.tolerance,
    slotPowerMax: Math.max(...slotIds(c).map((id) => Math.abs(s.power[id] ?? 0))),
    rating: c.limits.slotRating_W,
  };
}

/**
 * Fiziksel bölge:
 * - Regülatör çıkışı üst sınırı aşarsa elektronik sigortası hattı keser.
 * - Motor akımı hedefin yarısının altında: dönmez; hedefin altında: zayıf; üstünde: ısınır/yanar.
 * - Motor doğru ama regülatör minimum yükün altında: kararsız çalışır, motor tekler.
 * - Yuva direnci anma gücünü aşarsa yanar.
 */
export function classify(r: Reading): SpZone {
  const lr = r.load / r.loadTarget;
  const sr = r.supply / r.supplyTarget;
  if (sr > 1 + r.supplyTol) return 'fuse';
  if (lr < STALL_RATIO) return 'stall';
  if (lr < 1 - r.loadTol) return 'slow';
  if (lr >= SEVERE_RATIO) return 'over_severe';
  if (lr > 1 + r.loadTol) return 'over_mild';
  if (sr < 1 - r.supplyTol) return 'regulator_low';
  if (r.slotPowerMax > r.rating) return 'resistor_overheat';
  return 'ok';
}

/** Hedeflerden en büyük göreli sapma (doğrulayıcı: yanlış ikililer açık farkla kaçırmalı). */
export function worstError(r: Reading): number {
  return Math.max(Math.abs(r.load / r.loadTarget - 1), Math.abs(r.supply / r.supplyTarget - 1));
}

/** Oyuncunun gördüğü sayılarla (yuvarlanmış) türetilen değerler: elle çözümün aynısı. */
export function derivedScope(c: SeriesParallelConfig, visible: Scope): Scope {
  return evalDerived(c.derived, visible);
}
