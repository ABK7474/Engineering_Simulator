// Thevenin üretici + doğrulayıcı. Ağ ve parametreler seçilir, eşdeğer iki bağımsız yoldan hesaplanır,
// klasik hatalar doğru cevaptan açıkça ayrışmalı ve tolerans yuvarlama yayılımını kapsamalı.
// 200 denemede geçerli problem yoksa açıklamalı hata.

import type { Scope } from '../../core/expr';
import { createRng, pick } from '../../core/rng';
import { pickParam, SHOWN_REL_ERROR } from './design-core';
import {
  closedForm,
  mistakeValue,
  realLoadCurrent,
  solveEquivalent,
  type Equivalent,
  type MistakeKind,
  type TheveninConfig,
  type TheveninForm,
  type TheveninNetwork,
} from './thevenin';

export const MAX_ATTEMPTS = 200;
/** Klasik hata, doğru cevaptan toleransın en az bu katı uzakta olmalı. */
export const MISTAKE_MARGIN = 3;

export interface TheveninProblem {
  seed: number;
  network: TheveninNetwork;
  params: Scope;
  form: TheveninForm;
  tolerance: number;
  eq: Equivalent;
  rl: number;
  /** Gerçek ağın yükü beslerken verdiği akım. */
  iLoad: number;
  /** Kapalı form değerleri (rapor adımları). */
  scope: Scope;
  mistakes: { kind: MistakeKind; quantity: 'Vth' | 'Rth'; value: number }[];
  /** Gösterim ve giriş yuvarlamasının cevapta yol açabileceği en büyük göreli sapma. */
  spread: number;
}

const rel = (a: number, b: number) => Math.abs(a / b - 1);

/** Her parametre ±%0,5 (3 anlamlı basamak) oynarsa Vth ve Rth'nin en büyük göreli sapması (birinci mertebe toplam). */
export function roundingSpread(n: TheveninNetwork, params: Scope, eq: Equivalent): number {
  let dv = 0;
  let dr = 0;
  for (const k of Object.keys(n.params)) {
    if (k === n.load) continue;
    const e = solveEquivalent(n, { ...params, [k]: params[k] * (1 + SHOWN_REL_ERROR) });
    dv += rel(e.vth, eq.vth);
    dr += rel(e.rth, eq.rth);
  }
  // Oyuncunun kendi girdiği sayının 3 basamağa yuvarlanması da eklenir
  return Math.max(dv, dr) + SHOWN_REL_ERROR;
}

export function verifyThevenin(c: TheveninConfig, p: TheveninProblem): string[] {
  const errors: string[] = [];
  const { eq } = p;
  if (!(eq.vth > 0 && eq.rth > 0 && Number.isFinite(eq.vth) && Number.isFinite(eq.rth))) return ['eşdeğer pozitif değil (uçlar ters ya da ağ dejenere)'];
  const inRange = (x: number, [lo, hi]: [number, number]) => x >= lo && x <= hi;
  if (!inRange(eq.vth, c.plausible.Vth)) errors.push(`Vth ${eq.vth.toFixed(3)} V gerçekçi aralıkta değil`);
  if (!inRange(eq.rth, c.plausible.Rth)) errors.push(`Rth ${eq.rth.toFixed(1)} Ω gerçekçi aralıkta değil`);
  if (!inRange(p.iLoad, c.plausible.Iload)) errors.push('yük akımı gerçekçi aralıkta değil');
  // İki bağımsız yol: MNA ile kapalı form; Norton ile Thevenin; gerçek yük akımı ile eşdeğerin verdiği
  const cf = closedForm(p.network, p.params);
  if (rel(cf.vth, eq.vth) > 1e-9 || rel(cf.rth, eq.rth) > 1e-9) errors.push('kapalı form MNA ile uyuşmuyor (şablon hatası)');
  if (rel(eq.isc, eq.vth / eq.rth) > 1e-9) errors.push('Norton akımı Vth/Rth ile uyuşmuyor');
  if (rel(p.iLoad, eq.vth / (eq.rth + p.rl)) > 1e-9) errors.push('eşdeğer devre gerçek yük akımını vermiyor');
  // Klasik hatalar ayrışmalı
  for (const m of p.mistakes) {
    const right = m.quantity === 'Vth' ? eq.vth : eq.rth;
    if (rel(m.value, right) < MISTAKE_MARGIN * p.tolerance) errors.push(`'${m.kind}' hatası doğru cevaba çok yakın (belirsiz)`);
  }
  if (p.spread > p.tolerance) errors.push(`yuvarlama yayılımı %${(p.spread * 100).toFixed(2)} toleransı (%${p.tolerance * 100}) aşıyor`);
  return errors;
}

export function generateThevenin(c: TheveninConfig, seed: number): TheveninProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const network = pick(rng, c.networks);
    const params: Scope = {};
    for (const [name, def] of Object.entries(network.params)) params[name] = pickParam(rng, def);
    let p: TheveninProblem;
    try {
      const eq = solveEquivalent(network, params);
      const mistakes = (['shortI', 'openV', 'withLoad'] as MistakeKind[])
        .map((kind) => ({ kind, m: mistakeValue(network, params, kind) }))
        .filter((x): x is { kind: MistakeKind; m: NonNullable<ReturnType<typeof mistakeValue>> } => x.m !== null && Number.isFinite(x.m.value))
        .map(({ kind, m }) => ({ kind, ...m }));
      p = {
        seed,
        network,
        params,
        form: c.form,
        tolerance: c.tolerance,
        eq,
        rl: params[network.load],
        iLoad: realLoadCurrent(network, params),
        scope: closedForm(network, params).scope,
        mistakes,
        spread: roundingSpread(network, params, eq),
      };
    } catch (e) {
      reasons.set((e as Error).message, (reasons.get((e as Error).message) ?? 0) + 1);
      continue;
    }
    const errors = verifyThevenin(c, p);
    if (!errors.length) return p;
    reasons.set(errors[0], (reasons.get(errors[0]) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Thevenin problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
