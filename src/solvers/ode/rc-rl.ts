// Birinci mertebe geçici hâl (ters problem): valf sürücüsü, kondansatör gerilimi (RC) ya da bobin akımı (RL)
// eşiği geçtiği anda ateşler. Ateşleme anı [t_min, t_max] penceresine düşmeli; oyuncu seri R'yi seçer.
// Ön koşul: kondansatör önceki darbeden V₀ ile dolu, bobinde I₀ akımı var.
//   RC: v(t) = Vs + (V₀ − Vs)·e^(−t/RC)  →  t = RC·ln((Vs − V₀)/(Vs − V_eş))
//   RL: i(t) = I∞ + (I₀ − I∞)·e^(−tR/L), I∞ = Vs/R  →  t = (L/R)·ln((I∞ − I₀)/(I∞ − I_eş)); I_eş ≥ I∞ ise hiç
// Kapalı form ve RK4 (ode.ts) birbirinden bağımsız iki yoldur; uyuşmazlarsa problem reddedilir.

import { firstCrossing, rk4Series, type Deriv } from './ode';

export type CircuitKind = 'rc' | 'rl';

export interface RcRlConfig {
  kinds: CircuitKind[];
  vs: number[];
  rc: { C_uF: number[]; v0: number[]; vth: number[] };
  rl: { L_mH: number[]; i0_mA: number[]; ith_mA: number[] };
  /** Cevap direncinin E12 aralığı. */
  answer: Record<CircuitKind, [number, number]>;
  /** Pencerenin yarı genişliği (oran): [t*(1 − w), t*(1 + w)]. */
  window: number;
  binSize: number;
}

export function parseRcRlConfig(raw: unknown): RcRlConfig {
  const c = raw as RcRlConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('rc-rl yapılandırması nesne olmalı');
  need(Array.isArray(c.kinds) && c.kinds.length > 0 && c.kinds.every((k) => k === 'rc' || k === 'rl'), 'kinds rc/rl listesi olmalı');
  const pos = (a: unknown) => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'number' && x >= 0);
  need(pos(c.vs), 'vs listesi olmalı');
  need(pos(c.rc?.C_uF) && pos(c.rc?.v0) && pos(c.rc?.vth), 'rc: C_uF, v0, vth listeleri olmalı');
  need(pos(c.rl?.L_mH) && pos(c.rl?.i0_mA) && pos(c.rl?.ith_mA), 'rl: L_mH, i0_mA, ith_mA listeleri olmalı');
  for (const k of ['rc', 'rl'] as const) need(Array.isArray(c.answer?.[k]) && c.answer[k][0] > 0 && c.answer[k][0] < c.answer[k][1], `answer.${k} [min, max] olmalı`);
  need(c.window > 0 && c.window <= 0.08, 'window 0–0,08 olmalı (bitişik E12 en az ~%18 uzakta)');
  need(Number.isInteger(c.binSize) && c.binSize >= 3 && c.binSize <= 7, 'binSize 3–7 olmalı');
  if (errors.length) throw new Error(`rc-rl yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

/** Devre parametreleri (SI birimleriyle). RC: C [F], v0/vth [V]. RL: L [H], i0/ith [A]. */
export type Params = { kind: 'rc'; vs: number; c: number; v0: number; vth: number } | { kind: 'rl'; vs: number; l: number; i0: number; ith: number };

/** Kapalı form ateşleme anı; eşiğe hiç ulaşılmazsa null. */
export function crossingClosed(p: Params, r: number): number | null {
  if (p.kind === 'rc') {
    if (!(p.vth < p.vs)) return null;
    if (p.v0 >= p.vth) return 0;
    return r * p.c * Math.log((p.vs - p.v0) / (p.vs - p.vth));
  }
  const inf = p.vs / r;
  if (!(p.ith < inf)) return null;
  if (p.i0 >= p.ith) return 0;
  return (p.l / r) * Math.log((inf - p.i0) / (inf - p.ith));
}

export const tau = (p: Params, r: number) => (p.kind === 'rc' ? r * p.c : p.l / r);

/** Diferansiyel denklem: RC dv/dt = (Vs − v)/(RC); RL di/dt = (Vs − R·i)/L. */
export function deriv(p: Params, r: number): Deriv {
  return p.kind === 'rc' ? (_t, v) => (p.vs - v) / (r * p.c) : (_t, i) => (p.vs - r * i) / p.l;
}

export const initial = (p: Params) => (p.kind === 'rc' ? p.v0 : p.i0);
export const threshold = (p: Params) => (p.kind === 'rc' ? p.vth : p.ith);

/** RK4 ile ateşleme anı (h = τ/2000, en fazla 30τ). */
export function crossingRk4(p: Params, r: number): number | null {
  const t = tau(p, r);
  return firstCrossing(deriv(p, r), initial(p), threshold(p), t / 2000, 30 * t);
}

/** Grafik için RK4 eğrisi. */
export function curve(p: Params, r: number, tEnd: number, steps = 240): [number, number][] {
  return rk4Series(deriv(p, r), initial(p), tEnd, steps);
}
