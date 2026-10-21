// Op-amp sinyal şartlandırma (ters problem): basınç sensörünün çıkışı [V_lo, V_hi], ADC girişine
// [Y_lo, Y_hi] olarak eşlenmeli. Tek besleme (0 … Vcc); ideal op-amp, ray dışı çıkış kırpılır.
// Varyantlar:
//   gain:   evirmeyen yükselteç, (−) girişte Rf (çıkıştan) ve Rg (toprağa): Vout = Vs·(1 + Rf/Rg)
//   offset: ayrıca Rr (−) girişten Vref'e: Vout = Vs·(1 + Rf/Rg + Rf/Rr) − Vref·Rf/Rr
// Fizik MNA'da (ideal op-amp damgası) hesaplanır; kapalı form çapraz kontroldür.

import { solveDC, type Element } from './mna';

export type OpampVariant = 'gain' | 'offset';
export const SLOTS: Record<OpampVariant, string[]> = { gain: ['Rf', 'Rg'], offset: ['Rf', 'Rg', 'Rr'] };

export interface OpampConfig {
  variants: OpampVariant[];
  /** Tek besleme: çıkış 0 … vcc arasında kalabilir. */
  vcc: number;
  sensorLo: number[];
  sensorHi: number[];
  vref: number[];
  /** Cevap yuvalarının E12 aralıkları. */
  answer: Record<'Rf' | 'Rg' | 'Rr', [number, number]>;
  /** Kabul: her uç noktada |V_out − hedef| ≤ tolerance · (Y_hi − Y_lo). */
  tolerance: number;
  binSize: number;
  /** Gerçekçilik: hedef aralığı en az bu kadar geniş, uçlar raydan bu kadar içeride. */
  minSpan: number;
  railMargin: number;
}

export function parseOpampConfig(raw: unknown): OpampConfig {
  const c = raw as OpampConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('opamp yapılandırması nesne olmalı');
  need(Array.isArray(c.variants) && c.variants.length > 0 && c.variants.every((v) => v in SLOTS), 'variants gain/offset listesi olmalı');
  need(c.vcc > 0, 'vcc pozitif olmalı');
  for (const k of ['sensorLo', 'sensorHi', 'vref'] as const) need(Array.isArray(c[k]) && c[k].length > 0 && c[k].every((x) => x > 0), `${k} pozitif sayı listesi olmalı`);
  for (const k of ['Rf', 'Rg', 'Rr'] as const) need(Array.isArray(c.answer?.[k]) && c.answer[k][0] > 0 && c.answer[k][0] < c.answer[k][1], `answer.${k} [min, max] olmalı`);
  need(c.tolerance > 0 && c.tolerance <= 0.1, 'tolerance 0–0,1 olmalı');
  need(Number.isInteger(c.binSize) && c.binSize >= 4 && c.binSize <= 9, 'binSize 4–9 olmalı');
  need(c.minSpan > 0 && c.railMargin >= 0, 'minSpan ve railMargin geçersiz');
  if (errors.length) throw new Error(`opamp yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export type Resistors = Partial<Record<'Rf' | 'Rg' | 'Rr', number>>;

export function netlist(variant: OpampVariant, vs: number, vref: number, r: Resistors): Element[] {
  const els: Element[] = [
    { id: 'Vs', kind: 'V', a: 'p', b: '0', volts: vs },
    { id: 'Rg', kind: 'R', a: 'n', b: '0', ohms: r.Rg! },
    { id: 'Rf', kind: 'R', a: 'out', b: 'n', ohms: r.Rf! },
    { id: 'U1', kind: 'OA', a: 'p', b: 'n', out: 'out' },
  ];
  if (variant === 'offset') els.push({ id: 'Vref', kind: 'V', a: 'r', b: '0', volts: vref }, { id: 'Rr', kind: 'R', a: 'n', b: 'r', ohms: r.Rr! });
  return els;
}

/** İdeal (kırpılmamış) çıkış, MNA. */
export function outputMna(variant: OpampVariant, vs: number, vref: number, r: Resistors): number {
  return solveDC(netlist(variant, vs, vref, r)).voltage.out;
}

/** Kapalı form (çapraz kontrol ve hızlı tarama). */
export function outputClosed(variant: OpampVariant, vs: number, vref: number, r: Resistors): number {
  const k = variant === 'offset' ? r.Rf! / r.Rr! : 0;
  return vs * (1 + r.Rf! / r.Rg! + k) - vref * k;
}

/** Tek besleme rayına kırpma. */
export const clip = (y: number, vcc: number) => Math.min(vcc, Math.max(0, y));
