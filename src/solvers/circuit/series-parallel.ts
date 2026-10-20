// Seri-paralel ters problem türü: topoloji, gizli parametre, ölçüm, hedefler, çözüm zinciri,
// tuzaklar ve rapor adımları içerik JSON'undan gelir. Fizik genel MNA çözücüsüyle hesaplanır;
// yeni topoloji eklemek kod gerektirmez.

import { evaluate, namesIn, type Scope } from '../../core/expr';
import { formatAmp, formatOhm, formatVolt, formatWatt } from '../../core/format';
import { e12Values } from './e-series';
import { solveDC, type DcSolution, type Element } from './mna';

export type Unit = 'V' | 'A' | 'Ω' | 'W';

export type Probe = { voltage: string } | { current: string; negate?: boolean } | { power: string };

export interface ElementDef {
  id: string;
  kind: 'R' | 'V';
  a: string;
  b: string;
  /** Parametre adı (slot değilse). */
  value?: string;
  slot?: boolean;
  label: string;
  symbol?: 'motor';
}

export interface ParamDef {
  label: string;
  unit: Unit;
  choices?: number[];
  /** E12 aralığı [min, max]. */
  e12?: [number, number];
  hidden?: boolean;
}

export interface TargetDef {
  id: string;
  label: string;
  probe: Probe;
  unit: Unit;
  /** Göreli tolerans (0.04 = ±%4). */
  tolerance: number;
}

export interface Layout {
  viewBox: [number, number, number, number];
  elements: Record<string, { x: number; y: number; dir: 'h' | 'v' }>;
  wires: [number, number][][];
  dots: [number, number][];
  ground: [number, number];
  labels: { text: string; x: number; y: number }[];
  probes: { x: number; y: number; text: string }[];
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

export type SlotValues = Partial<Record<string, number>>;

/** Netlist: yuvaya değer verilmemişse (undefined) eleman yok = açık devre. */
export function buildNetlist(c: SeriesParallelConfig, params: Scope, slots: SlotValues): Element[] {
  const out: Element[] = [];
  for (const e of c.elements) {
    const v = e.slot ? slots[e.id] : params[e.value!];
    if (v === undefined) continue;
    out.push(e.kind === 'V' ? { id: e.id, kind: 'V', a: e.a, b: e.b, volts: v } : { id: e.id, kind: 'R', a: e.a, b: e.b, ohms: v });
  }
  return out;
}

export function readProbe(s: DcSolution, p: Probe): number {
  if ('voltage' in p) return s.voltage[p.voltage] ?? 0;
  if ('current' in p) return (s.current[p.current] ?? 0) * (p.negate ? -1 : 1);
  return s.power[p.power] ?? 0;
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

/** Ekranda gösterilen hassasiyet (3 anlamlı basamak). Oyuncu bu sayılarla hesap yapar. */
export const shown = (x: number) => Number(x.toPrecision(3));

export function nearestE12(x: number): number {
  return e12Values().reduce((best, r) => (Math.abs(Math.log(r / x)) < Math.abs(Math.log(best / x)) ? r : best));
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

// ---------------------------------------------------------------- metin şablonu

const FORMAT: Record<Unit, (x: number) => string> = { V: formatVolt, A: formatAmp, 'Ω': formatOhm, W: formatWatt };

export function formatUnit(x: number, unit: Unit): string {
  return FORMAT[unit](x);
}

/** "{ad:birim}" yer tutucularını kapsamdaki değerlerle doldurur. */
export function fillTemplate(text: string, scope: Scope): string {
  return text.replace(/\{(\w+):([^}]+)\}/g, (_m, name: string, unit: string) => {
    if (!(name in scope)) throw new Error(`Şablonda bilinmeyen '${name}'`);
    return formatUnit(scope[name], unit as Unit);
  });
}

/** Oyuncunun gördüğü sayılarla (yuvarlanmış) türetilen değerler: elle çözümün aynısı. */
export function derivedScope(c: SeriesParallelConfig, visible: Scope): Scope {
  const scope: Scope = { ...visible };
  for (const [k, ex] of Object.entries(c.derived)) scope[k] = evaluate(ex, scope);
  return scope;
}
