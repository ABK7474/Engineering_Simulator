// Süperpozisyon (ters problem): iki kaynaklı doğrusal ağda bir kaynağın değeri bilinmiyor (etiketi silinmiş).
// Her iki kaynak açıkken bir dal akımı ya da düğüm gerilimi ölçülmüş. Yanıt = a·(bilinen) + b·(bilinmeyen);
// a ve b kaynaklar tek tek açıkken (diğeri sıfırlanmış: V kısa, I açık) bulunur. Oyuncu bilinmeyeni girer.
// İki bağımsız yol: MNA ile tek kaynaklı katkıların toplamı (doğrusallık) ve şablonun kapalı formu.

import { namesIn, type Scope } from '../../core/expr';
import { buildNetlist, evalDerived, readProbe, type ElementDef, type Layout, type ParamDef, type Probe, type Unit } from './design-core';
import { solveDC, type Element } from './mna';
import { zeroSources } from './thevenin';

export interface SuperNetwork {
  id: string;
  story: string;
  elements: ElementDef[];
  params: Record<string, ParamDef>;
  /** Değeri bilinmeyen kaynağın parametresi (oyuncu bulur). */
  unknown: string;
  /** Her iki kaynak açıkken ölçülen büyüklük. */
  probe: Probe;
  probeLabel: string;
  probeUnit: Unit;
  /** Kapalı form: oyuncunun gördüğü sayılar + ölçüm `M` → derived; `formula` bilinmeyeni veren ad. */
  derived: Record<string, string>;
  formula: string;
  steps: string[];
  layout: Layout;
}

export interface SuperConfig {
  /** Göreli kabul toleransı. */
  tolerance: number;
  networks: SuperNetwork[];
}

export function parseSuperConfig(raw: unknown): SuperConfig {
  const c = raw as SuperConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('superposition yapılandırması nesne olmalı');
  need(c.tolerance > 0 && c.tolerance <= 0.1, 'tolerance 0–0,1 olmalı');
  need(Array.isArray(c.networks) && c.networks.length > 0, 'networks boş olamaz');
  for (const n of c.networks ?? []) {
    const w = `ağ '${n.id}'`;
    const sources = n.elements.filter((e) => e.kind !== 'R');
    need(sources.length === 2, `${w}: tam iki kaynak olmalı`);
    need(sources.some((e) => e.value === n.unknown), `${w}: bilinmeyen '${n.unknown}' bir kaynağın parametresi olmalı`);
    for (const e of n.elements) need(e.value && e.value in n.params && n.layout?.elements?.[e.id], `${w}: '${e.id}' parametresi/şema konumu eksik`);
    const known = new Set([...Object.keys(n.params).filter((k) => k !== n.unknown), 'M']);
    for (const [k, ex] of Object.entries(n.derived ?? {})) {
      for (const nm of namesIn(ex)) need(known.has(nm), `${w}: türetilen '${k}' içinde bilinmeyen '${nm}'`);
      known.add(k);
    }
    need(known.has(n.formula), `${w}: formula derived içinde olmalı`);
    for (const st of n.steps ?? []) for (const [, nm] of st.matchAll(/\{(\w+):[^}]+\}/g)) need(known.has(nm) || nm === n.unknown, `${w}: adımda bilinmeyen '{${nm}}'`);
  }
  if (errors.length) throw new Error(`superposition yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

const solveProbe = (els: Element[], p: Probe) => readProbe(solveDC(els), p);

/** Ölçülen yanıt (iki kaynak da açık). */
export function response(n: SuperNetwork, params: Scope): number {
  return solveProbe(buildNetlist(n.elements, params, {}), n.probe);
}

/** Yalnız bir kaynak açıkken (diğeri doğru biçimde sıfırlanmış) yanıt. `mode` klasik hatalar için. */
export function contribution(n: SuperNetwork, params: Scope, only: string, mode: 'correct' | 'shortI' | 'openV' = 'correct'): number {
  const els = buildNetlist(n.elements, params, {});
  const keep = els.filter((e) => e.kind === 'R' || n.elements.find((d) => d.id === e.id)!.value === only);
  const others = zeroSources(
    els.filter((e) => !keep.includes(e)),
    mode,
  );
  return solveProbe([...keep, ...others], n.probe);
}

/** Yanıtın bilinmeyen kaynağa göre katsayısı b ve bilinen kaynağın katkısı. */
export function decompose(n: SuperNetwork, params: Scope, mode: 'correct' | 'shortI' | 'openV' = 'correct'): { known: number; perUnit: number } {
  const knownParam = n.elements.find((e) => e.kind !== 'R' && e.value !== n.unknown)!.value!;
  const known = contribution(n, params, knownParam, mode);
  const perUnit = contribution(n, { ...params, [n.unknown]: 1 }, n.unknown, mode);
  return { known, perUnit };
}

/** Kapalı form (şablon): oyuncunun gördüğü sayılar ve ölçümden bilinmeyen. */
export function closedForm(n: SuperNetwork, visible: Scope): { value: number; scope: Scope } {
  const scope = evalDerived(n.derived, visible);
  return { value: scope[n.formula], scope };
}
