// Doğrulayıcı: üretilen trace havuza girmeden önce buradan geçmek zorunda.
// Tek anlamlılık ölçütü: "satır r'yi bir öncekinden yeniden hesapla" onarımı tabloyu yalnız r = bozuk satır
// için tutarlı yapar. Bozuk satırdan sonraki satır da yerel olarak tutarsız görünür, ama onu düzeltmek tabloyu
// onarmaz; böylece aynı tabloda ikinci bir olası hata yeri olamaz.

import { sameState } from './corrupt';
import type { DsTraceProblem } from './ds-trace.generate';
import { referenceRun } from './reference';
import { SimError, step, type TraceState } from './simulate';

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

/** Gösterilen tabloda her satır bir öncekinden hesaplananla aynı mı? */
export function consistent(p: DsTraceProblem, shown: readonly TraceState[]): boolean {
  let prev = p.initial;
  for (let j = 0; j < p.rows.length; j++) {
    try {
      if (!sameState(step(prev, p.rows[j], p.kinds, p.params), shown[j])) return false;
    } catch (e) {
      if (e instanceof SimError) return false;
      throw e;
    }
    prev = shown[j];
  }
  return true;
}

/** Tek satırı bir öncekinden yeniden hesaplayarak tabloyu onaran satır dizinleri. */
export function repairPoints(p: DsTraceProblem): number[] {
  const out: number[] = [];
  for (let r = 0; r < p.rows.length; r++) {
    const prev = r === 0 ? p.initial : p.shown[r - 1];
    let fixed: TraceState;
    try {
      fixed = step(prev, p.rows[r], p.kinds, p.params);
    } catch (e) {
      if (e instanceof SimError) continue;
      throw e;
    }
    const cand = [...p.shown];
    cand[r] = fixed;
    if (consistent(p, cand)) out.push(r);
  }
  return out;
}

export function verifyDsTrace(p: DsTraceProblem, lines: [number, number], ops: [number, number]): VerifyResult {
  const errors: string[] = [];
  if (p.code.length < lines[0] || p.code.length > lines[1]) errors.push(`program ${p.code.length} satır (${lines[0]}–${lines[1]} olmalı)`);
  if (p.rows.length < ops[0] || p.rows.length > ops[1]) errors.push(`izleme ${p.rows.length} adım (${ops[0]}–${ops[1]} olmalı)`);

  // Bağımsız yürütücüyle çapraz kontrol
  try {
    const ref = referenceRun(p.template, p.params);
    if (ref.length !== p.rows.length) errors.push(`bağımsız yürütücü ${ref.length} adım buldu, simülatör ${p.rows.length}`);
    else
      ref.forEach((r, j) => {
        const row = p.rows[j];
        const vis = Object.fromEntries(Object.entries(row.after.vars).filter((e): e is [string, number] => e[1] !== null));
        if (r.line !== row.line || JSON.stringify(r.structs) !== JSON.stringify(row.after.structs) || JSON.stringify(sortKeys(r.vars)) !== JSON.stringify(sortKeys(vis)))
          errors.push(`adım ${j + 1}: bağımsız yürütücüyle uyuşmuyor`);
      });
  } catch (e) {
    errors.push(`bağımsız yürütücü hata verdi: ${(e as Error).message}`);
  }

  // Doğru izleme kendi içinde tutarlı
  if (!consistent(p, p.rows.map((r) => r.after))) errors.push('doğru izleme kendi içinde tutarsız');

  // Yalnız bozuk satır farklı
  const diff = p.rows.map((r, j) => (sameState(r.after, p.shown[j]) ? -1 : j)).filter((j) => j >= 0);
  if (diff.length !== 1 || diff[0] !== p.bad) errors.push(`gösterilen tabloda ${diff.length} satır farklı (1 olmalı: ${p.bad + 1})`);

  // Tek onarım noktası ve tek doğru değer
  const fixes = repairPoints(p);
  if (fixes.length !== 1 || fixes[0] !== p.bad) errors.push(`onarım noktaları [${fixes.map((f) => f + 1).join(', ')}] (yalnız ${p.bad + 1} olmalı)`);
  const prev = p.bad === 0 ? p.initial : p.shown[p.bad - 1];
  if (!sameState(step(prev, p.rows[p.bad], p.kinds, p.params), p.rows[p.bad].after)) errors.push('onarılan değer doğru izlemeyle aynı değil');

  // "Hiçbir şey olmamış" satırı ipucu vermesin (etkiyi atlama hatası hariç)
  if (p.corruption.kind !== 'skip_effect' && sameState(p.shown[p.bad], prev)) errors.push('bozuk satır bir öncekiyle aynı');
  return { ok: errors.length === 0, errors };
}

const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
