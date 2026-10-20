// Thevenin/Norton eşdeğeri: ağ şablonları içerik JSON'undan gelir. Eşdeğer iki bağımsız yoldan bulunur:
// 1) MNA: açık devre gerilimi (Vth), kaynaklar sıfırlanıp uçlara 1 A test akımı (Rth), uçlar kısa devre (In).
// 2) Şablondaki kapalı form ifadeleri (derived/formula). İkisi uyuşmazsa şablon reddedilir.
// Klasik hatalar da MNA ile hesaplanır (akım kaynağını kısa devre saymak, gerilim kaynağını açık saymak,
// Vth'yi yük takılıyken ölçmek); doğru cevaba yakın düşen hata olan problem havuza girmez.

import { namesIn, type Scope } from '../../core/expr';
import { buildNetlist, evalDerived, type ElementDef, type Layout, type ParamDef } from './design-core';
import { solveDC, type Element } from './mna';

export type TheveninForm = 'thevenin' | 'norton';

export interface TheveninNetwork {
  id: string;
  /** Hikâyedeki karşılığı. */
  story: string;
  elements: ElementDef[];
  /** Uçlar [a, b]; eşdeğer a'dan b'ye bakılarak (Vth = Va − Vb). */
  terminals: [string, string];
  params: Record<string, ParamDef>;
  /** Yük direnci parametresi: modül bu yükü besler. */
  load: string;
  derived: Record<string, string>;
  /** Kapalı form: derived içindeki adlar. */
  formula: { Vth: string; Rth: string };
  steps: string[];
  layout: Layout;
}

export interface TheveninConfig {
  form: TheveninForm;
  /** Göreli tolerans (0.02 = ±%2). Gösterim ve giriş yuvarlamasının yayılımını kapsamalı. */
  tolerance: number;
  plausible: { Vth: [number, number]; Rth: [number, number]; Iload: [number, number] };
  networks: TheveninNetwork[];
}

export type MistakeKind = 'shortI' | 'openV' | 'withLoad';

export const MISTAKE_TEXT: Record<MistakeKind, string> = {
  shortI: 'Kaynakları sıfırlarken akım kaynağı kısa devre sayılmış; akım kaynağı sıfırlanınca AÇIK devre olur.',
  openV: 'Kaynakları sıfırlarken gerilim kaynağı açık devre sayılmış; gerilim kaynağı sıfırlanınca KISA devre olur.',
  withLoad: 'V_th yük takılıyken hesaplanmış; Thevenin gerilimi uçlar AÇIKKEN ölçülen gerilimdir.',
};

export function parseTheveninConfig(raw: unknown): TheveninConfig {
  const c = raw as TheveninConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('thevenin yapılandırması nesne olmalı');
  need(c.form === 'thevenin' || c.form === 'norton', "form 'thevenin' ya da 'norton' olmalı");
  need(c.tolerance > 0 && c.tolerance <= 0.1, 'tolerance 0–0,1 olmalı');
  for (const k of ['Vth', 'Rth', 'Iload'] as const) need(Array.isArray(c.plausible?.[k]) && c.plausible[k][0] < c.plausible[k][1], `plausible.${k} [min, max] olmalı`);
  need(Array.isArray(c.networks) && c.networks.length > 0, 'networks boş olamaz');
  for (const n of c.networks ?? []) {
    const w = `ağ '${n.id}'`;
    const ids = new Set(n.elements.map((e) => e.id));
    need(ids.size === n.elements.length, `${w}: eleman kimlikleri tekil değil`);
    const nodes = new Set(n.elements.flatMap((e) => [e.a, e.b]));
    need(nodes.has('0'), `${w}: toprak (0) düğümü yok`);
    need(n.terminals?.length === 2 && n.terminals.every((t) => nodes.has(t)) && n.terminals[0] !== n.terminals[1], `${w}: uçlar geçersiz`);
    for (const e of n.elements) {
      need(!e.slot && e.value && e.value in n.params, `${w}: '${e.id}' için parametre yok`);
      need(n.layout?.elements?.[e.id], `${w}: '${e.id}' için şema konumu yok`);
    }
    need(n.elements.some((e) => e.kind !== 'R'), `${w}: kaynak yok`);
    need(n.load in n.params, `${w}: yük parametresi '${n.load}' yok`);
    for (const [k, p] of Object.entries(n.params)) need(p.choices?.length || p.e12, `${w}: parametre '${k}' için aralık yok`);
    const known = new Set(Object.keys(n.params));
    for (const [k, ex] of Object.entries(n.derived ?? {})) {
      for (const nm of namesIn(ex)) need(known.has(nm), `${w}: türetilen '${k}' içinde bilinmeyen '${nm}'`);
      known.add(k);
    }
    need(known.has(n.formula?.Vth) && known.has(n.formula?.Rth), `${w}: formula derived içindeki adları göstermeli`);
    for (const st of n.steps ?? []) for (const [, nm] of st.matchAll(/\{(\w+):[^}]+\}/g)) need(known.has(nm), `${w}: adımda bilinmeyen '{${nm}}'`);
  }
  if (errors.length) throw new Error(`thevenin yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export interface Equivalent {
  vth: number;
  rth: number;
  /** Kısa devre (Norton) akımı, a'dan b'ye. */
  isc: number;
}

const voltageAcross = (els: Element[], [a, b]: [string, string]) => {
  const s = solveDC(els);
  return (s.voltage[a] ?? 0) - (s.voltage[b] ?? 0);
};

/** Kaynakları sıfırla. correct: V → kısa (0 V), I → açık. Hatalı kipler klasik öğrenci hatalarıdır. */
export function zeroSources(els: Element[], mode: 'correct' | 'shortI' | 'openV'): Element[] {
  const out: Element[] = [];
  for (const e of els) {
    if (e.kind === 'V') {
      if (mode !== 'openV') out.push({ ...e, volts: 0 });
    } else if (e.kind === 'I') {
      if (mode === 'shortI') out.push({ id: e.id, kind: 'V', a: e.a, b: e.b, volts: 0 });
    } else out.push(e);
  }
  return out;
}

/** Uçlardan görülen direnç: kaynaklar sıfırlanmış ağa b'den a'ya 1 A basılır. */
export function resistanceSeen(els: Element[], t: [string, string]): number {
  return voltageAcross([...els, { id: '__test', kind: 'I', a: t[1], b: t[0], amps: 1 }], t);
}

export function solveEquivalent(n: TheveninNetwork, params: Scope): Equivalent {
  const els = buildNetlist(n.elements, params, {});
  const vth = voltageAcross(els, n.terminals);
  const rth = resistanceSeen(zeroSources(els, 'correct'), n.terminals);
  const s = solveDC([...els, { id: '__short', kind: 'V', a: n.terminals[0], b: n.terminals[1], volts: 0 }]);
  return { vth, rth, isc: s.current.__short };
}

/** Gerçek ağ yükü beslerken yük akımı (MNA; eşdeğerden bağımsız). */
export function realLoadCurrent(n: TheveninNetwork, params: Scope): number {
  const els = buildNetlist(n.elements, params, {});
  const s = solveDC([...els, { id: '__load', kind: 'R', a: n.terminals[0], b: n.terminals[1], ohms: params[n.load] }]);
  return s.current.__load;
}

/** Klasik hatanın verdiği değer; ağda uygulanamıyorsa (ör. akım kaynağı yok) null. */
export function mistakeValue(n: TheveninNetwork, params: Scope, kind: MistakeKind): { quantity: 'Vth' | 'Rth'; value: number } | null {
  const els = buildNetlist(n.elements, params, {});
  try {
    if (kind === 'withLoad') {
      return { quantity: 'Vth', value: voltageAcross([...els, { id: '__load', kind: 'R', a: n.terminals[0], b: n.terminals[1], ohms: params[n.load] }], n.terminals) };
    }
    if (kind === 'shortI' && !els.some((e) => e.kind === 'I')) return null;
    return { quantity: 'Rth', value: resistanceSeen(zeroSources(els, kind), n.terminals) };
  } catch {
    return null; // ör. gerilim kaynağı açık sayılınca bir düğüm boşta kaldı
  }
}

/** Kapalı form (şablondaki ifadeler). */
export function closedForm(n: TheveninNetwork, params: Scope): { vth: number; rth: number; scope: Scope } {
  const scope = evalDerived(n.derived, params);
  return { vth: scope[n.formula.Vth], rth: scope[n.formula.Rth], scope };
}
