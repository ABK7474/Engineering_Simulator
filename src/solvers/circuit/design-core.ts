// Devre tasarım türlerinin ortak çekirdeği (seri-paralel, thevenin, max-power, ...): eleman tanımları,
// netlist kurma, ölçüm okuma, gösterim hassasiyeti, E12 yakınlığı, parametre seçimi, metin şablonları,
// kutudan yuvalara yerleşimler. Fizik genel MNA çözücüsündedir (mna.ts).

import { evaluate, type Scope } from '../../core/expr';
import { formatAmp, formatOhm, formatVolt, formatWatt } from '../../core/format';
import { pick, type Rng } from '../../core/rng';
import { e12Values } from './e-series';
import type { DcSolution, Element } from './mna';

export type Unit = 'V' | 'A' | 'Ω' | 'W';

export type Probe = { voltage: string } | { current: string; negate?: boolean } | { power: string };

export interface ElementDef {
  id: string;
  /** R direnç, V gerilim kaynağı (a = +), I akım kaynağı (a'dan çekip b'ye basar). */
  kind: 'R' | 'V' | 'I';
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

export interface Layout {
  viewBox: [number, number, number, number];
  /** flip: kaynağın a ucu altta (dikey) ya da solda (yatay); varsayılan üstte/sağda. */
  elements: Record<string, { x: number; y: number; dir: 'h' | 'v'; flip?: boolean }>;
  wires: [number, number][][];
  dots: [number, number][];
  ground: [number, number];
  labels: { text: string; x: number; y: number }[];
  probes: { x: number; y: number; text: string }[];
}

/** Şema çizilebilen her devre: elemanlar + yerleşim. */
export interface Drawable {
  elements: ElementDef[];
  layout: Layout;
}

export type SlotValues = Partial<Record<string, number>>;

/** Netlist: yuvaya değer verilmemişse (undefined) eleman yok = açık devre. */
export function buildNetlist(elements: readonly ElementDef[], params: Scope, slots: SlotValues): Element[] {
  const out: Element[] = [];
  for (const e of elements) {
    const v = e.slot ? slots[e.id] : params[e.value!];
    if (v === undefined) continue;
    if (e.kind === 'V') out.push({ id: e.id, kind: 'V', a: e.a, b: e.b, volts: v });
    else if (e.kind === 'I') out.push({ id: e.id, kind: 'I', a: e.a, b: e.b, amps: v });
    else out.push({ id: e.id, kind: 'R', a: e.a, b: e.b, ohms: v });
  }
  return out;
}

export function readProbe(s: DcSolution, p: Probe): number {
  if ('voltage' in p) return s.voltage[p.voltage] ?? 0;
  if ('current' in p) return (s.current[p.current] ?? 0) * (p.negate ? -1 : 1);
  return s.power[p.power] ?? 0;
}

/** Ekranda gösterilen hassasiyet (3 anlamlı basamak). Oyuncu bu sayılarla hesap yapar. */
export const shown = (x: number) => Number(x.toPrecision(3));
/** 3 anlamlı basamağa yuvarlamanın en büyük göreli hatası (yarım birim / en küçük 3 basamaklı sayı). */
export const SHOWN_REL_ERROR = 0.5 / 100;

export function nearestE12(x: number): number {
  return e12Values().reduce((best, r) => (Math.abs(Math.log(r / x)) < Math.abs(Math.log(best / x)) ? r : best));
}

export function pickParam(rng: Rng, p: { choices?: number[]; e12?: [number, number] }): number {
  return p.choices?.length ? pick(rng, p.choices) : pick(rng, e12Values(p.e12![0], p.e12![1]));
}

/** Kutudan yuvalara tüm sıralı yerleşimler (aynı kart iki yuvaya konamaz). */
export function placements(slots: string[], cards: string[]): Record<string, string>[] {
  if (slots.length === 0) return [{}];
  const [first, ...rest] = slots;
  return cards.flatMap((card) =>
    placements(rest, cards.filter((x) => x !== card)).map((p) => ({ [first]: card, ...p })),
  );
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

/** Sıralı türetilmiş değerler: her ifade öncekileri kullanabilir. */
export function evalDerived(derived: Record<string, string>, visible: Scope): Scope {
  const scope: Scope = { ...visible };
  for (const [k, ex] of Object.entries(derived)) scope[k] = evaluate(ex, scope);
  return scope;
}
