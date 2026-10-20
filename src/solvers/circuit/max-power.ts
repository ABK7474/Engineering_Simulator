// Maksimum güç aktarımı (ters problem): sonar vericisi bir kara kutudan beslenir. Kayıtta iki yük testi
// var (R₁ → V₁, R₂ → V₂). Oyuncu iki denklemden Vth ve Rth'yi çıkarır, kutudan yükü seçer.
// Güç oranı P/Pmax = 4x/(1+x)², x = R_yük/R_th. Kutu seyrektir: değerler arası en az SPACING kat;
// doğru aday x ∈ [0,75; 1,33] (P ≥ %98), diğerleri x < 0,58 ya da x > 1,72 (P ≤ %93).

import { namesIn } from '../../core/expr';
import { solveDC } from './mna';

export interface MaxPowerConfig {
  /** Kara kutunun Thevenin gerilimi seçenekleri (V). */
  vth: number[];
  /** Kara kutunun iç direnci aralığı (Ω, log-düzgün seçilir; E12 olmak zorunda değil). */
  rth: [number, number];
  /** Yük testlerinde kullanılan dirençler (E12 aralığı). */
  testR: [number, number];
  binSize: number;
  /** Kutudaki iki değer arasındaki en küçük oran. */
  spacing: number;
  /** Kaynak akımı kısa devre akımının bu oranını aşarsa sigorta atar. */
  fuseRatio: number;
  /** Oyuncunun gördüğü sayılardan (R1, V1, R2, V2) türetilen değerler, sırayla. */
  derived: Record<string, string>;
  /** Çözüm: derived içindeki ad (R_th). */
  solution: string;
  mistakes: { expr: string; text: string }[];
  steps: string[];
  log: string;
}

/** Bölgeler (x = R/R_th): doğru aday ve tuzaklar. */
export const ANSWER_ZONE: [number, number] = [0.75, 1.33];
export const DECOY_BELOW = 0.58;
export const DECOY_ABOVE = 1.72;
/** Başarı eşiği: güç oranı (x ∈ [0,75; 1,33] ↔ ≥ %97,96). */
export const SUCCESS_RATIO = 0.975;
export const DECOY_MAX_RATIO = 0.93;

export const powerRatio = (x: number) => (4 * x) / (1 + x) ** 2;
export const inDecoyZone = (x: number) => x < DECOY_BELOW || x > DECOY_ABOVE;

export function parseMaxPowerConfig(raw: unknown): MaxPowerConfig {
  const c = raw as MaxPowerConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('max-power yapılandırması nesne olmalı');
  need(Array.isArray(c.vth) && c.vth.length > 0 && c.vth.every((v) => v > 0), 'vth pozitif sayı listesi olmalı');
  for (const k of ['rth', 'testR'] as const) need(Array.isArray(c[k]) && c[k][0] > 0 && c[k][0] < c[k][1], `${k} [min, max] olmalı`);
  need(Number.isInteger(c.binSize) && c.binSize >= 3 && c.binSize <= 7, 'binSize 3–7 olmalı');
  need(c.spacing >= 1.8, 'spacing en az 1,8 olmalı');
  need(c.fuseRatio > 0.5 && c.fuseRatio < 1, 'fuseRatio 0,5–1 olmalı');
  const known = new Set(['R1', 'V1', 'R2', 'V2']);
  for (const [k, ex] of Object.entries(c.derived ?? {})) {
    for (const n of namesIn(ex)) need(known.has(n), `türetilen '${k}' içinde bilinmeyen '${n}'`);
    known.add(k);
  }
  need(known.has(c.solution), 'solution derived içindeki bir ad olmalı');
  for (const m of c.mistakes ?? []) for (const n of namesIn(m.expr)) need(known.has(n), `tuzak içinde bilinmeyen '${n}'`);
  const stepNames = new Set([...known, 'R']);
  for (const st of [...(c.steps ?? []), c.log ?? '']) for (const [, n] of st.matchAll(/\{(\w+):[^}]+\}/g)) need(stepNames.has(n), `metinde bilinmeyen '{${n}}'`);
  if (errors.length) throw new Error(`max-power yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

/** Kara kutu R yükünü beslerken yük gerilimi (MNA: Vth kaynağı + Rth + yük). */
export function loadVoltage(vth: number, rth: number, r: number): number {
  const s = solveDC([
    { id: 'Vth', kind: 'V', a: 'e', b: '0', volts: vth },
    { id: 'Rth', kind: 'R', a: 'e', b: 'o', ohms: rth },
    { id: 'RL', kind: 'R', a: 'o', b: '0', ohms: r },
  ]);
  return s.voltage.o;
}

/** Yükte harcanan güç (MNA) ve kaynak akımı. */
export function loadPower(vth: number, rth: number, r: number): { p: number; i: number } {
  const v = loadVoltage(vth, rth, r);
  return { p: (v * v) / r, i: v / r };
}
