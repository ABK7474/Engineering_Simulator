// Acil aydınlatma sönümü (birinci mertebe deşarj). Ana aydınlatma sigortası çekilince süperkapasitör C, seri
// direnç R (yuva) ve lamba R_L üzerinden boşalır:
//   τ = (R + R_L)·C,   V_L(t) = V₀ · R_L/(R + R_L) · e^(−t/τ)
// Şartlar: oyuncu siper alana kadar (t_walk) lamba görünür kalmalı: V_L(t_walk) ≥ V_see; yaratık geldiğinde
// (t_arr) lamba tespit eşiğinin altında olmalı: V_L(t_arr) ≤ V_det. R hem genliği (bölücü) hem τ'yu değiştirir;
// büyük R ilk parlaklığı düşürür ama sönümü yavaşlatır. Bağımsız yol: dV/dt = −V/τ'nun RK4 benzetimi.

import { e12Values } from '../circuit/e-series';
import { rk4Step } from './ode';

export interface LightDecayConfig {
  V0: number[];
  /** Süperkapasitör (F). */
  C_F: number[];
  /** Lamba direnci (Ω). */
  RL: number[];
  /** Siper alma süresi ve yaratığın varış süresi (s). */
  tWalk: number[];
  tArr: number[];
  /** Cevap R'nin E12 aralığı (Ω). */
  answer: [number, number];
  /** Cevabın şartlardan güvenlik payı (oran); eşikler buna göre yerleşir. */
  margin: number;
  binSize: number;
}

export function parseLightDecayConfig(raw: unknown): LightDecayConfig {
  const c = raw as LightDecayConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('light-decay yapılandırması nesne olmalı');
  for (const k of ['V0', 'C_F', 'RL', 'tWalk', 'tArr'] as const) need(Array.isArray(c[k]) && c[k].length > 0 && c[k].every((x) => x > 0), `${k} pozitif liste olmalı`);
  need(Array.isArray(c.answer) && c.answer.length === 2 && c.answer[0] > 0 && c.answer[0] < c.answer[1] && e12Values(...c.answer).length >= 4, 'answer [min, max] Ω olmalı (en az 4 E12 değeri)');
  need(c.margin > 0 && c.margin <= 0.15, 'margin 0–0,15 olmalı');
  need(Number.isInteger(c.binSize) && c.binSize >= 4 && c.binSize <= 10, 'binSize 4–10 olmalı');
  need(Math.max(...(c.tWalk ?? [0])) < Math.min(...(c.tArr ?? [0])), 'her tWalk her tArr\'dan küçük olmalı');
  if (errors.length) throw new Error(`light-decay yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export interface DecayParams {
  v0: number;
  c: number;
  rl: number;
}

export const tau = (p: DecayParams, r: number) => (r + p.rl) * p.c;
export const lampAt = (p: DecayParams, r: number, t: number) => ((p.v0 * p.rl) / (r + p.rl)) * Math.exp(-t / tau(p, r));

/** RK4: kondansatör gerilimi dV/dt = −V/τ, lamba bölücüden; `t`'deki lamba gerilimi. */
export function lampAtRk4(p: DecayParams, r: number, t: number, steps = 2000): number {
  const T = tau(p, r);
  const h = t / steps;
  let v = p.v0;
  for (let k = 0; k < steps; k++) v = rk4Step((_t, y) => -y / T, k * h, v, h);
  return (v * p.rl) / (r + p.rl);
}
