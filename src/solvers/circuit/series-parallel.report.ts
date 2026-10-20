// Seri-paralel olay raporu: ölçümler MNA'dan, çözüm adımları içerik şablonundan (oyuncunun
// gördüğü sayılarla), seçilen ve doğru yerleşim, tuzak seçildiyse olası hata.

import { formatOhm } from '../../core/format';
import type { Outcome, StageResult } from '../../core/types';
import {
  derivedScope,
  fillTemplate,
  formatUnit,
  readProbe,
  slotIds,
  type SeriesParallelConfig,
} from './series-parallel';
import type { SpProblem } from './series-parallel.generate';
import type { Placement, SpEvaluation } from './series-parallel.outcomes';

const slotLabel = (c: SeriesParallelConfig, s: string) => c.elements.find((e) => e.id === s)!.label;

export function buildSeriesParallelReport(
  stageId: string,
  c: SeriesParallelConfig,
  p: SpProblem,
  placement: Placement,
  ev: SpEvaluation,
  outcome: Outcome,
): StageResult {
  const slots = slotIds(c);
  const describeSet = (v: Record<string, number>) => slots.map((s) => `${slotLabel(c, s)} = ${formatOhm(v[s])}`).join(', ');
  const scope = { ...derivedScope(c, p.visible), ...p.answer };

  const steps = c.steps.map((st) => fillTemplate(st, scope));
  const wrongCards = slots
    .filter((s) => ev.values[s] !== p.answer[s])
    .map((s) => p.bin.find((b) => b.id === placement[s])!)
    .filter((b) => b.mistake);
  for (const b of wrongCards) steps.push(`Olası hata (${b.label}): ${b.mistake}`);
  const swapped = slots.every((s) => ev.values[s] !== p.answer[s]) && slots.every((s) => Object.values(p.answer).includes(ev.values[s]));
  if (swapped) steps.push('Olası hata: doğru iki değer seçilmiş ama yuvalar karışmış. Seri direnç tüm akımı taşır; paralel direnç motorla aynı gerilimi görür.');

  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: describeSet(ev.values),
    correctLabel: describeSet(p.answer),
    outcome,
    facts: [
      ...c.targets.map((t) => ({ label: `Hedef: ${t.label}`, value: `${formatUnit(p.targets[t.id], t.unit)} ± %${Math.round(t.tolerance * 100)}` })),
      ...c.reportProbes.map((r) => ({ label: r.label, value: formatUnit(Math.abs(readProbe(ev.solution, r.probe)), r.unit) })),
    ],
    steps,
  };
}
