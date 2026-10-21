// Süperpozisyon üretici + doğrulayıcı. Bilinmeyen kaynak değeri parametre listesinden seçilir; ölçüm MNA ile
// hesaplanıp 3 basamağa yuvarlanır. Kurallar: doğrusallık (tek kaynaklı katkıların toplamı = toplam yanıt),
// kapalı form = MNA, yuvarlama yayılımı toleransın içinde, klasik hatalar ≥ 3×tolerans uzakta.

import type { Scope } from '../../core/expr';
import { createRng, pick } from '../../core/rng';
import { pickParam, shown, SHOWN_REL_ERROR } from './design-core';
import { closedForm, decompose, response, type SuperConfig, type SuperNetwork } from './superposition';

export const MAX_ATTEMPTS = 200;
export const MISTAKE_MARGIN = 3;

export type SuperMistake = 'forgotKnown' | 'signFlip' | 'shortI' | 'openV';
export const SUPER_MISTAKE_TEXT: Record<SuperMistake, string> = {
  forgotKnown: 'Bilinen kaynağın katkısı çıkarılmamış: ölçülen yanıtın tamamı bilinmeyen kaynağa yazılmış.',
  signFlip: 'Bilinen kaynağın katkısı ters işaretle hesaba katılmış (eklenmiş).',
  shortI: 'Katkı hesaplanırken akım kaynağı kısa devre sayılmış; sıfırlanan akım kaynağı AÇIK devredir.',
  openV: 'Katkı hesaplanırken gerilim kaynağı açık devre sayılmış; sıfırlanan gerilim kaynağı KISA devredir.',
};

export interface SuperProblem {
  seed: number;
  network: SuperNetwork;
  params: Scope;
  tolerance: number;
  /** Gösterilen ölçüm (3 basamak). */
  measured: number;
  /** Oyuncunun gördüğü sayılar (bilinmeyen hariç) + M. */
  visible: Scope;
  /** Gösterilen sayılarla kapalı form (rapor adımları). */
  scope: Scope;
  answer: number;
  known: number;
  perUnit: number;
  mistakes: { kind: SuperMistake; value: number }[];
  spread: number;
}

const rel = (a: number, b: number) => Math.abs(a / b - 1);

export function verifySuper(p: SuperProblem): string[] {
  const errors: string[] = [];
  const exact = response(p.network, p.params);
  if (!Number.isFinite(exact) || Math.abs(exact) < 1e-6) return ['yanıt sıfıra çok yakın'];
  // Doğrusallık: toplam = bilinen katkı + birim katkı × bilinmeyen
  if (rel(p.known + p.perUnit * p.answer, exact) > 1e-9) errors.push('süperpozisyon toplamı MNA yanıtıyla uyuşmuyor');
  // Kapalı form: kesin ölçümle tam, gösterilen ölçümle tolerans içinde
  const cfExact = closedForm(p.network, { ...p.visible, M: exact }).value;
  if (rel(cfExact, p.answer) > 1e-9) errors.push('kapalı form MNA ile uyuşmuyor (şablon hatası)');
  if (rel(closedForm(p.network, p.visible).value, p.answer) > p.tolerance / 2) errors.push('gösterilen ölçümle elle çözüm toleransı aşıyor');
  if (p.spread > p.tolerance) errors.push(`yuvarlama yayılımı %${(p.spread * 100).toFixed(2)} toleransı aşıyor (iptal eden katkılar)`);
  for (const m of p.mistakes) if (rel(m.value, p.answer) < MISTAKE_MARGIN * p.tolerance) errors.push(`'${m.kind}' hatası doğru cevaba çok yakın`);
  return errors;
}

export function generateSuper(c: SuperConfig, seed: number): SuperProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const network = pick(rng, c.networks);
    const params: Scope = {};
    for (const [name, def] of Object.entries(network.params)) params[name] = pickParam(rng, def);
    let p: SuperProblem;
    try {
      const exact = response(network, params);
      const measured = shown(exact);
      const visible: Scope = { M: measured };
      for (const k2 of Object.keys(network.params)) if (k2 !== network.unknown) visible[k2] = params[k2];
      const { known, perUnit } = decompose(network, params);
      const mistakes: SuperProblem['mistakes'] = [
        { kind: 'forgotKnown', value: measured / perUnit },
        { kind: 'signFlip', value: (measured + known) / perUnit },
      ];
      for (const mode of ['shortI', 'openV'] as const) {
        try {
          const d = decompose(network, params, mode);
          if (Number.isFinite(d.perUnit) && Math.abs(d.perUnit) > 1e-12 && (d.known !== known || d.perUnit !== perUnit)) mistakes.push({ kind: mode, value: (measured - d.known) / d.perUnit });
        } catch {
          // Yanlış sıfırlama devreyi çözülemez bıraktı (düğüm boşta): bu hata bu ağda yapılamaz
        }
      }
      p = {
        seed,
        network,
        params,
        tolerance: c.tolerance,
        measured,
        visible,
        scope: closedForm(network, visible).scope,
        answer: params[network.unknown],
        known,
        perUnit,
        mistakes,
        spread: Math.abs(measured / (measured - known)) * SHOWN_REL_ERROR + SHOWN_REL_ERROR,
      };
    } catch (e) {
      reasons.set((e as Error).message, (reasons.get((e as Error).message) ?? 0) + 1);
      continue;
    }
    const errors = verifySuper(p);
    if (!errors.length) return p;
    reasons.set(errors[0], (reasons.get(errors[0]) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Süperpozisyon problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
