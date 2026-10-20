// Üretici: şablon + parametre seç, doğru izlemeyi simülatörle hesapla, tek satırı boz, doğrula.
// En fazla 200 denemede doğrulanmış problem bulamazsa açıklamalı hata verir.

import { createRng, pick, shuffle } from '../../core/rng';
import { corruptRow, type Corruption } from './corrupt';
import { verifyDsTrace } from './ds-trace.verify';
import type { DsTraceConfig, Kind, TraceTemplate } from './ir';
import type { VarColumn } from './print';
import { TemplateRejected } from './print';
import { SimError, simulatorOracle, type TraceOracle, type TraceRow, type TraceState } from './simulate';

export interface DsTraceProblem {
  template: TraceTemplate;
  params: Record<string, number>;
  /** Oyuncunun gördüğü C# programı, satır satır. */
  code: string[];
  structs: { name: string; kind: Kind }[];
  kinds: Record<string, Kind>;
  /** Değişken sütunları (sayaçlar dahil), bildirim sırasıyla. */
  columns: VarColumn[];
  hideCounters: boolean;
  initial: TraceState;
  /** Doğru izleme. */
  rows: TraceRow[];
  /** Tabloda gösterilen durumlar (rows ile aynı dizin); yalnız `bad` satırı bozuk. */
  shown: TraceState[];
  bad: number;
  corruption: Corruption;
}

export const MAX_ATTEMPTS = 200;

export function generateDsTrace(config: DsTraceConfig, seed: number, oracle: TraceOracle = simulatorOracle): DsTraceProblem {
  const rng = createRng(seed);
  const pool = config.templates.filter((t) => t.structures.every((s) => config.structures.includes(s.kind)));
  if (pool.length === 0) throw new Error(`Bu yapı türleriyle (${config.structures.join(', ')}) şablon yok`);
  const reasons = new Set<string>();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const template = pick(rng, pool);
    const params = Object.fromEntries(Object.entries(template.params).map(([k, v]) => [k, pick(rng, v)]));
    let trace;
    try {
      trace = oracle.run(template, params);
    } catch (e) {
      if (e instanceof SimError || e instanceof TemplateRejected) {
        reasons.add(`${template.id}: ${e.message}`);
        continue;
      }
      throw e;
    }
    const { program, kinds, initial, rows } = trace;
    if (rows.length < config.ops[0] || rows.length > config.ops[1]) {
      reasons.add(`${template.id}: ${rows.length} adım, aralık ${config.ops.join('–')}`);
      continue;
    }
    if (program.lines.length < config.lines[0] || program.lines.length > config.lines[1]) {
      reasons.add(`${template.id}: ${program.lines.length} satır, aralık ${config.lines.join('–')}`);
      continue;
    }
    for (const kind of shuffle(rng, config.corruptions)) {
      for (const bad of shuffle(rng, rows.map((_, j) => j))) {
        const prev = bad === 0 ? initial : rows[bad - 1].after;
        const corruption = corruptRow(kind, rows[bad], prev, kinds, params, rng);
        if (!corruption) continue;
        const shown = rows.map((r) => r.after);
        shown[bad] = corruption.state;
        const problem: DsTraceProblem = {
          template,
          params,
          code: program.lines,
          structs: template.structures.map((s) => ({ name: s.name, kind: s.kind })),
          kinds,
          columns: program.vars,
          hideCounters: config.hideCounters,
          initial,
          rows,
          shown,
          bad,
          corruption,
        };
        const v = verifyDsTrace(problem, config.lines, config.ops);
        if (v.ok) return problem;
        reasons.add(`${template.id}/${kind}: ${v.errors[0]}`);
      }
    }
  }
  throw new Error(`${MAX_ATTEMPTS} denemede doğrulanmış trace üretilemedi:\n- ${[...reasons].slice(0, 4).join('\n- ')}`);
}
