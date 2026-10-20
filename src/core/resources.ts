// İstasyon kaynakları (oksijen, güç…): hata sonuçlarının bedeli, onarımın geri kazanımı,
// onarılmayan hasarın yavaş tüketimi. Saf modül: DOM, three.js, depolama bilmez.
// Sayılar content/balance/resources.json'dan gelir; kaynak listesi de oradadır.

import type { Outcome, OutcomeKind } from './types';

export type Amounts = Record<string, number>;

export interface ResourceDef {
  label: string;
  start: number;
  max: number;
}

export interface DamageDef {
  label: string;
  loss: Amounts;
  drainPerMinute?: Amounts;
}

export interface Balance {
  resources: Record<string, ResourceDef>;
  warning: number;
  critical: number;
  recovery: Amounts;
  drainCapPerMinute: number;
  severityScale: { kinds: OutcomeKind[]; base: number; perSeverity: number; max: number };
  tension: { calmAbove: number; fullAt: number };
  outcomes: Partial<Record<Exclude<OutcomeKind, 'success'>, DamageDef>>;
  overheat: DamageDef;
}

/** Onarılmamış bir arızanın kalıcı hasarı; arıza ve kaynak türü başına tek kayıt. */
export interface Damage {
  faultId: string;
  source: OutcomeKind | 'overheat';
  label: string;
  drainPerMinute: Amounts;
}

export interface ResourceState {
  values: Amounts;
  damages: Damage[];
  /** Uyarı eşiğinin altına inişte bir kez olay üretmek için. */
  warned: Record<string, boolean>;
}

export type ResourceEvent =
  | { type: 'damage'; source: Damage['source']; label: string; loss: Amounts }
  | { type: 'repaired'; faultId: string; gain: Amounts }
  | { type: 'crossedWarning'; resource: string }
  | { type: 'critical'; resource: string; value: number };

export interface Step {
  state: ResourceState;
  events: ResourceEvent[];
}

export type Level = 'ok' | 'low' | 'critical';

// ---------------------------------------------------------------- denge dosyası

export function parseBalance(raw: unknown): Balance {
  const fail = (msg: string): never => {
    throw new Error(`Kaynak dengesi geçersiz: ${msg}`);
  };
  const o = raw as Balance;
  if (!o || typeof o !== 'object') fail('nesne değil');
  const ids = Object.keys(o.resources ?? {});
  if (ids.length === 0) fail('kaynak listesi boş');
  const pos = (x: unknown, what: string) => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) fail(`${what} negatif olmayan sayı olmalı`);
    return x as number;
  };
  const amounts = (a: unknown, what: string) => {
    if (a === undefined) return;
    if (typeof a !== 'object' || a === null) fail(`${what} nesne olmalı`);
    for (const [k, v] of Object.entries(a as object)) {
      if (!ids.includes(k)) fail(`${what}: bilinmeyen kaynak '${k}'`);
      pos(v, `${what}.${k}`);
    }
  };
  for (const id of ids) {
    const r = o.resources[id];
    if (typeof r?.label !== 'string') fail(`${id}.label eksik`);
    pos(r.max, `${id}.max`);
    if (pos(r.start, `${id}.start`) > r.max) fail(`${id}.start > max`);
  }
  pos(o.critical, 'critical');
  if (!(pos(o.warning, 'warning') > o.critical)) fail('warning > critical olmalı');
  amounts(o.recovery, 'recovery');
  pos(o.drainCapPerMinute, 'drainCapPerMinute');
  const s = o.severityScale;
  if (!Array.isArray(s?.kinds)) fail('severityScale.kinds dizi olmalı');
  pos(s.base, 'severityScale.base');
  pos(s.perSeverity, 'severityScale.perSeverity');
  if (!(pos(s.max, 'severityScale.max') >= s.base)) fail('severityScale.max >= base olmalı');
  if (!(o.tension?.calmAbove > o.tension?.fullAt)) fail('tension.calmAbove > fullAt olmalı');
  const defs: [string, DamageDef | undefined][] = [...Object.entries(o.outcomes ?? {}), ['overheat', o.overheat]];
  for (const [k, d] of defs) {
    if (!d || typeof d.label !== 'string') fail(`${k}.label eksik`);
    if (typeof d!.loss !== 'object' || d!.loss === null) fail(`${k}.loss eksik`);
    amounts(d!.loss, `${k}.loss`);
    amounts(d!.drainPerMinute, `${k}.drainPerMinute`);
  }
  return o;
}

// ---------------------------------------------------------------- durum

export function createResources(b: Balance): ResourceState {
  const values: Amounts = {};
  const warned: Record<string, boolean> = {};
  for (const [id, r] of Object.entries(b.resources)) {
    values[id] = r.start;
    warned[id] = r.start <= b.warning;
  }
  return { values, damages: [], warned };
}

export function resetEpisode(_s: ResourceState, b: Balance): ResourceState {
  return createResources(b);
}

const clampTo = (b: Balance, id: string, v: number) => Math.min(b.resources[id].max, Math.max(0, v));

function addAll(s: ResourceState, b: Balance, delta: Amounts, sign: 1 | -1): Amounts {
  const values = { ...s.values };
  for (const [id, d] of Object.entries(delta)) {
    if (id in values) values[id] = clampTo(b, id, values[id] + sign * d);
  }
  return values;
}

/** Eşik olayları: uyarı eşiğinin altına ilk inişte bir kez; kritikte her değerlendirmede. */
function withThresholds(s: ResourceState, b: Balance, events: ResourceEvent[]): Step {
  const warned = { ...s.warned };
  for (const [id, v] of Object.entries(s.values)) {
    if (v <= b.warning) {
      if (!warned[id]) events.push({ type: 'crossedWarning', resource: id });
      warned[id] = true;
    } else {
      warned[id] = false;
    }
  }
  for (const [id, v] of Object.entries(s.values)) {
    if (v <= b.critical) events.push({ type: 'critical', resource: id, value: v });
  }
  return { state: { ...s, warned }, events };
}

/** Aşırı akım türlerinde kaybı çözücünün hesapladığı şiddetle ölçekler (tavanlı). */
export function severityFactor(b: Balance, o: Outcome): number {
  const sc = b.severityScale;
  if (!sc.kinds.includes(o.kind)) return 1;
  if (!Number.isFinite(o.severity)) return sc.max;
  return Math.min(sc.max, Math.max(sc.base, sc.base + sc.perSeverity * o.severity));
}

function upsertDamage(list: Damage[], d: Damage): Damage[] {
  const rest = list.filter((x) => !(x.faultId === d.faultId && x.source === d.source));
  return [...rest, d];
}

/** Çözücünün fiziksel sonucunu kaynaklara uygular. Başarı = onarım. */
export function applyOutcome(s: ResourceState, b: Balance, faultId: string, o: Outcome): Step {
  if (o.kind === 'success') return repair(s, b, faultId);
  const events: ResourceEvent[] = [];
  let state = s;
  const hit = (source: Damage['source'], def: DamageDef, scale: number) => {
    const loss: Amounts = {};
    for (const [id, v] of Object.entries(def.loss)) loss[id] = v * scale;
    state = { ...state, values: addAll(state, b, loss, -1) };
    if (def.drainPerMinute && Object.keys(def.drainPerMinute).length > 0) {
      state = {
        ...state,
        damages: upsertDamage(state.damages, { faultId, source, label: def.label, drainPerMinute: { ...def.drainPerMinute } }),
      };
    }
    events.push({ type: 'damage', source, label: def.label, loss });
  };
  const def = b.outcomes[o.kind];
  if (def) hit(o.kind, def, severityFactor(b, o));
  if (o.resistorOverheat && o.kind !== 'resistor_burnt') hit('overheat', b.overheat, 1);
  return withThresholds(state, b, events);
}

/** Doğru onarım: küçük geri kazanım + o arızanın kalıcı hasarı silinir. */
export function repair(s: ResourceState, b: Balance, faultId: string): Step {
  const state: ResourceState = {
    ...s,
    values: addAll(s, b, b.recovery, 1),
    damages: s.damages.filter((d) => d.faultId !== faultId),
  };
  return withThresholds(state, b, [{ type: 'repaired', faultId, gain: { ...b.recovery } }]);
}

/** İpucu gibi bilinçli harcamalar için (henüz kullanılmıyor). */
export function spend(s: ResourceState, b: Balance, cost: Amounts): Step {
  return withThresholds({ ...s, values: addAll(s, b, cost, -1) }, b, []);
}

/** Kaynak başına toplam kalıcı tüketim (/dk), tavanlı. */
export function drainPerMinute(s: ResourceState, b: Balance): Amounts {
  const out: Amounts = {};
  for (const id of Object.keys(b.resources)) out[id] = 0;
  for (const d of s.damages) for (const [id, v] of Object.entries(d.drainPerMinute)) if (id in out) out[id] += v;
  for (const id of Object.keys(out)) out[id] = Math.min(b.drainCapPerMinute, out[id]);
  return out;
}

/** Oyun saatiyle `seconds` saniyelik kalıcı tüketim. */
export function tick(s: ResourceState, b: Balance, seconds: number): Step {
  if (!(seconds > 0) || s.damages.length === 0) return { state: s, events: [] };
  const rate = drainPerMinute(s, b);
  const loss: Amounts = {};
  for (const [id, r] of Object.entries(rate)) loss[id] = (r * seconds) / 60;
  return withThresholds({ ...s, values: addAll(s, b, loss, -1) }, b, []);
}

export function level(b: Balance, v: number): Level {
  return v <= b.critical ? 'critical' : v <= b.warning ? 'low' : 'ok';
}

export function isCritical(s: ResourceState, b: Balance): boolean {
  return Object.values(s.values).some((v) => v <= b.critical);
}

export function anyLow(s: ResourceState, b: Balance): boolean {
  return Object.values(s.values).some((v) => v <= b.warning);
}

/** En düşük kaynağa göre 0..1 gerilim: calmAbove ve üstü 0, fullAt ve altı 1. */
export function tensionFor(s: ResourceState, b: Balance): number {
  const m = Math.min(...Object.values(s.values));
  const { calmAbove, fullAt } = b.tension;
  return Math.min(1, Math.max(0, (calmAbove - m) / (calmAbove - fullAt)));
}
