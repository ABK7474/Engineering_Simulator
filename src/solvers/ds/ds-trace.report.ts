// Olay raporu şablonu: doğru izlemeyi adım adım gösterir, bozuk satırın nasıl bozulduğunu açıklar.

import type { Outcome, StageResult } from '../../core/types';
import type { DsTraceProblem } from './ds-trace.generate';
import { editableVars, fmtList, ORDER_LABEL, type TraceAnswer } from './ds-trace.outcomes';
import type { CorruptionKind } from './ir';
import type { TraceState } from './simulate';

export const CORRUPTION_LABEL: Record<CorruptionKind, string> = {
  order_confusion: 'Yığın/kuyruk sırası karışması',
  skip_effect: 'İşlemin etkisini atlama',
  off_by_one: 'Bir kayma (off-by-one)',
  wrong_end: 'Listenin yanlış ucu',
};

/** Tablo sütunları: yapılar (yön etiketiyle) ve görünür değişkenler. */
export function traceColumns(p: DsTraceProblem) {
  const vars = p.columns.filter((c) => !(c.counter && p.hideCounters)).map((c) => c.name);
  return { head: [...p.structs.map((s) => `${s.name} (${ORDER_LABEL[s.kind]})`), ...vars], vars };
}

export function stateCells(p: DsTraceProblem, s: TraceState): string[] {
  const { vars } = traceColumns(p);
  return [...p.structs.map((d) => fmtList(s.structs[d.name])), ...vars.map((v) => (s.vars[v] === null || s.vars[v] === undefined ? '—' : String(s.vars[v])))];
}

const describeState = (p: DsTraceProblem, s: TraceState) =>
  [...p.structs.map((d) => `${d.name} = ${fmtList(s.structs[d.name])}`), ...editableVars(p).filter((v) => s.vars[v] !== null).map((v) => `${v} = ${s.vars[v]}`)].join(', ');

export function buildDsTraceReport(stageId: string, p: DsTraceProblem, a: TraceAnswer, outcome: Outcome): StageResult {
  const bad = p.rows[p.bad];
  const chosen = p.rows[a.row];
  const entered: TraceState = { structs: a.structs, vars: { ...p.shown[a.row].vars, ...a.vars } };
  const steps = [
    `Bozuk kayıt — ${p.corruption.explanation}`,
    ...p.rows.map((r, j) => {
      const counters = Object.entries(r.counters).map(([k, v]) => `${k} = ${v}`).join(', ');
      return `Adım ${j + 1} · satır ${r.line}${counters ? ` (${counters})` : ''}: ${r.text} → ${describeState(p, r.after)}`;
    }),
  ];
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `Adım ${a.row + 1}: ${describeState(p, entered)}`,
    correctLabel: `Adım ${p.bad + 1}: ${describeState(p, bad.after)}`,
    outcome,
    facts: [
      { label: 'Bozuk adım', value: `Adım ${p.bad + 1} · satır ${bad.line}` },
      { label: 'Bozma türü', value: CORRUPTION_LABEL[p.corruption.kind] },
      { label: 'Tabloda yazan', value: describeState(p, p.shown[p.bad]) },
      { label: 'Seçtiğin adım', value: `Adım ${a.row + 1} · satır ${chosen.line}` },
    ],
    steps,
    table: {
      caption: 'Doğru izleme (simülatör)',
      head: ['Adım', 'Satır', 'İşlem', ...traceColumns(p).head],
      rows: [['0', '—', 'başlangıç', ...stateCells(p, p.initial)], ...p.rows.map((r, j) => [String(j + 1), String(r.line), r.text, ...stateCells(p, r.after)])],
      bad: p.bad + 1,
      chosen: a.row + 1,
    },
  };
}
