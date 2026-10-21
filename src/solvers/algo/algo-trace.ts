// Algoritma izleme (algo-trace): BFS/DFS, sıralama ve ikili arama ağacı kayıtlarında TEK satır bozuktur; oyuncu o
// satırı bulup doğru durumu yazar. ds-trace ile aynı tek anlamlılık ölçütü: "satır r'yi bir öncekinden yeniden
// hesapla" onarımı tabloyu yalnız r = bozuk satır için tutarlı yapar. Doğru izleme bağımsız ikinci uygulamayla
// (variants.ts → reference) satır satır uyuşmalı.

import { createRng, pick, shuffle, weightedPick, type Rng } from '../../core/rng';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { ALGO_VARIANTS, codeOf, sameCells, StepError, VARIANTS, type AlgoInput, type AlgoSizes, type AlgoVariant, type Cell, type Cells, type Column } from './variants';

export interface AlgoTraceConfig extends AlgoSizes {
  variants: AlgoVariant[];
}

export function parseAlgoTraceConfig(raw: unknown): AlgoTraceConfig {
  const c = raw as AlgoTraceConfig;
  const errors: string[] = [];
  const need = (ok: unknown, m: string) => void (ok || errors.push(m));
  if (!c || typeof c !== 'object') throw new Error('algo-trace yapılandırması nesne olmalı');
  need(Array.isArray(c.variants) && c.variants.length > 0 && c.variants.every((v) => ALGO_VARIANTS.includes(v)), `variants: ${ALGO_VARIANTS.join('/')} listesi olmalı`);
  const r = (x: unknown, what: string, lo: number, hi: number) =>
    need(Array.isArray(x) && x.length === 2 && x.every(Number.isInteger) && lo <= x[0] && x[0] <= x[1] && x[1] <= hi, `${what} [min, max] olmalı (${lo}–${hi})`);
  r(c.nodes, 'nodes', 4, 10);
  r(c.extraEdges, 'extraEdges', 0, 6);
  r(c.length, 'length', 4, 10);
  r(c.keys, 'keys', 4, 12);
  if (errors.length) throw new Error(`algo-trace yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c;
}

export interface AlgoTraceProblem {
  seed: number;
  input: AlgoInput;
  story: string;
  code: string[];
  columns: Column[];
  initial: Cells;
  ops: string[];
  rows: Cells[];
  shown: Cells[];
  bad: number;
  corruption: { kind: string; explanation: string };
}

export interface AlgoTraceAnswer {
  row: number;
  cells: Cells;
}

export const MAX_ATTEMPTS = 200;

const impl = (p: { input: AlgoInput }) => VARIANTS[p.input.variant];

function safeStep(p: AlgoTraceProblem, prev: Cells, j: number): Cells | null {
  try {
    return impl(p).step(p.input, prev, j);
  } catch (e) {
    if (e instanceof StepError) return null;
    throw e;
  }
}

export function consistent(p: AlgoTraceProblem, shown: readonly Cells[]): boolean {
  let prev = p.initial;
  for (let j = 0; j < shown.length; j++) {
    const next = safeStep(p, prev, j);
    if (!next || !sameCells(next, shown[j])) return false;
    prev = shown[j];
  }
  return true;
}

export function repairPoints(p: AlgoTraceProblem): number[] {
  const out: number[] = [];
  for (let r = 0; r < p.shown.length; r++) {
    const fixed = safeStep(p, r === 0 ? p.initial : p.shown[r - 1], r);
    if (!fixed) continue;
    const cand = [...p.shown];
    cand[r] = fixed;
    if (consistent(p, cand)) out.push(r);
  }
  return out;
}

export function verifyAlgoTrace(p: AlgoTraceProblem): string[] {
  const errors: string[] = [];
  const ref = impl(p).reference(p.input);
  if (ref.length !== p.rows.length) errors.push(`bağımsız uygulama ${ref.length} adım buldu, adım fonksiyonu ${p.rows.length}`);
  else ref.forEach((r, j) => sameCells(r, p.rows[j]) || errors.push(`adım ${j + 1}: bağımsız uygulamayla uyuşmuyor`));
  if (!consistent(p, p.rows)) errors.push('doğru izleme kendi içinde tutarsız');
  const diff = p.rows.map((r, j) => (sameCells(r, p.shown[j]) ? -1 : j)).filter((j) => j >= 0);
  if (diff.length !== 1 || diff[0] !== p.bad) errors.push(`gösterilen tabloda ${diff.length} satır farklı (1 olmalı)`);
  const fixes = repairPoints(p);
  if (fixes.length !== 1 || fixes[0] !== p.bad) errors.push(`onarım noktaları [${fixes.map((f) => f + 1).join(', ')}] (yalnız ${p.bad + 1} olmalı)`);
  const prev = p.bad === 0 ? p.initial : p.shown[p.bad - 1];
  if (p.corruption.kind !== 'noSwap' && sameCells(p.shown[p.bad], { ...prev })) errors.push('bozuk satır bir öncekiyle aynı');
  return errors;
}

export function generateAlgoTrace(c: AlgoTraceConfig, seed: number): AlgoTraceProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const variant = pick(rng, c.variants);
    const v = VARIANTS[variant];
    const input = v.make(rng, c);
    const initial = v.initial(input);
    const rows: Cells[] = [];
    let prev = initial;
    for (let j = 0; j < v.count(input); j++) rows.push((prev = v.step(input, prev, j)));
    const base = { seed, input, story: v.story, code: codeOf(input), columns: v.columns, initial, ops: rows.map((_, j) => v.op(input, j)), rows };
    // Bozuk satır ilk satır olmasın (başlangıçtan hemen sonra çok kolay); kayıt ortasından seç
    for (const kind of shuffle(rng, Object.keys(v.corruptions))) {
      for (const bad of shuffle(rng, rows.map((_, j) => j).filter((j) => j > 0))) {
        const cells = v.corrupt(input, kind, bad === 0 ? initial : rows[bad - 1], bad, rng);
        if (!cells || sameCells(cells, rows[bad])) continue;
        const shown = [...rows];
        shown[bad] = cells;
        const p: AlgoTraceProblem = { ...base, shown, bad, corruption: { kind, explanation: v.corruptions[kind] } };
        const errors = verifyAlgoTrace(p);
        if (!errors.length) return p;
        reasons.set(`${variant}/${kind}: ${errors[0]}`, (reasons.get(`${variant}/${kind}: ${errors[0]}`) ?? 0) + 1);
      }
    }
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Algoritma izlemesi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir kayıt yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}

// ---------------------------------------------------------------- sonuç

export type AlgoOutcomeKind = Extract<OutcomeKind, 'success' | 'core_reboot' | 'core_crash' | 'sensor_misread' | 'core_freeze'>;

export const fmtCell = (c: Cell) => (c === null ? '—' : Array.isArray(c) ? `[${c.join(', ')}]` : String(c));
/** Satırda düzenlenebilir sütunlar: o satırda değeri olanlar. */
export const editableColumns = (p: AlgoTraceProblem, row: number) => p.columns.filter((c) => p.rows[row][c.id] !== null);

export function compareCells(p: AlgoTraceProblem, a: AlgoTraceAnswer) {
  const wrongValues: string[] = [];
  const wrongOrder: string[] = [];
  for (const col of editableColumns(p, a.row)) {
    const want = p.rows[a.row][col.id];
    const got = a.cells[col.id] ?? null;
    if (JSON.stringify(want) === JSON.stringify(got)) continue;
    const sorted = (x: Cell) => JSON.stringify(Array.isArray(x) ? [...x].sort((m, n) => m - n) : x);
    if (Array.isArray(want) && Array.isArray(got) && sorted(want) === sorted(got)) wrongOrder.push(`${col.label} sırası ${fmtCell(want)} olmalı (${col.order}), girdiğin ${fmtCell(got)}`);
    else wrongValues.push(`${col.label} ${fmtCell(want)} olmalı (girdiğin: ${fmtCell(got)})`);
  }
  return { wrongValues, wrongOrder, equal: !wrongValues.length && !wrongOrder.length };
}

export function outcomePool(p: AlgoTraceProblem, a: AlgoTraceAnswer): { value: AlgoOutcomeKind; weight: number }[] {
  if (a.row !== p.bad) {
    const crash = Math.min(1, (Math.abs(a.row - p.bad) - 1) / 3);
    return [
      { value: 'core_reboot', weight: 1 - crash },
      { value: 'core_crash', weight: crash },
    ];
  }
  const c = compareCells(p, a);
  if (c.equal) return [{ value: 'success', weight: 1 }];
  return [{ value: c.wrongValues.length ? 'sensor_misread' : 'core_freeze', weight: 1 }];
}

export function resolveAlgoOutcome(p: AlgoTraceProblem, a: AlgoTraceAnswer, rng: Rng): Outcome {
  if (!Number.isInteger(a.row) || a.row < 0 || a.row >= p.rows.length) throw new Error(`Geçersiz satır: ${a.row}`);
  const kind = weightedPick(rng, outcomePool(p, a));
  const c = compareCells(p, a);
  const at = (j: number) => `adım ${j + 1} (${p.ops[j]})`;
  const base = { kind, severity: kind === 'success' ? 0 : a.row !== p.bad ? Math.abs(a.row - p.bad) / 2 : 1, resistorOverheat: false };
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Kayıt düzeltildi, çekirdek dizini yeniden kurdu', explanation: `Bozuk olan ${at(p.bad)} idi ve doğru durumu girdin.` };
    case 'core_reboot':
      return { ...base, headline: 'Sağlam kayıt değiştirildi, çekirdek yeniden başladı', explanation: `${at(a.row)} sağlamdı; bozuk olan ${at(p.bad)} idi. Çekirdek tutarsızlığı fark edip yeniden başladı.` };
    case 'core_crash':
      return { ...base, headline: 'Bellek bozuldu, AI çekirdeği çöktü', explanation: `${at(a.row)} sağlamdı; üstüne yazılan durum dizini bozdu. Bozuk olan ${at(p.bad)} idi.` };
    case 'sensor_misread':
      return { ...base, headline: 'Kayıt yanlış düzeltildi, dizin kaydı', explanation: `Doğru adımı (${at(p.bad)}) buldun ama girdiğin durum yanlış: ${[...c.wrongValues, ...c.wrongOrder].join('; ')}.` };
    case 'core_freeze':
      return { ...base, headline: 'Sıra ters, çekirdek dondu', explanation: `Doğru adımı (${at(p.bad)}) buldun, elemanlar doğru ama sıra yanlış: ${c.wrongOrder.join('; ')}.` };
  }
}

const describe = (p: AlgoTraceProblem, cells: Cells) =>
  p.columns
    .filter((c) => cells[c.id] !== null && cells[c.id] !== undefined)
    .map((c) => `${c.label} = ${fmtCell(cells[c.id])}`)
    .join(', ');

export const columnHead = (c: Column) => (c.order ? `${c.label} (${c.order})` : c.label);

export function buildAlgoReport(stageId: string, p: AlgoTraceProblem, a: AlgoTraceAnswer, outcome: Outcome): StageResult {
  const entered = { ...p.shown[a.row], ...a.cells };
  const prev = p.bad === 0 ? p.initial : p.rows[p.bad - 1];
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `Adım ${a.row + 1}: ${describe(p, entered)}`,
    correctLabel: `Adım ${p.bad + 1}: ${describe(p, p.rows[p.bad])}`,
    outcome,
    facts: [
      { label: 'Bozuk adım', value: `Adım ${p.bad + 1} · ${p.ops[p.bad]}` },
      { label: 'Tabloda yazan', value: describe(p, p.shown[p.bad]) },
      { label: 'Bir önceki durum', value: describe(p, prev) || 'başlangıç' },
    ],
    steps: [
      `Bozuk kayıt: ${p.corruption.explanation}`,
      'Yöntem: her satırı bir öncekinden kodu izleyerek yeniden hesapla. İlk uyuşmayan satır şüphelidir; onu düzeltince sonraki satırların hepsi tutarlı olmalı. Bozuk satırdan sonraki satır da uyuşmuyor görünür, ama onu düzeltmek tabloyu onarmaz.',
      ...p.rows.map((r, j) => `Adım ${j + 1} · ${p.ops[j]} → ${describe(p, r)}`),
      'Kontrol: aynı izleme farklı bir yöntemle (bağımsız ikinci uygulama) yeniden hesaplandı; satırlar birebir aynı.',
    ],
    table: {
      caption: 'Doğru izleme',
      head: ['Adım', 'İşlem', ...p.columns.map(columnHead)],
      rows: [['0', 'başlangıç', ...p.columns.map((c) => fmtCell(p.initial[c.id]))], ...p.rows.map((r, j) => [String(j + 1), p.ops[j], ...p.columns.map((c) => fmtCell(r[c.id]))])],
      bad: p.bad + 1,
      chosen: a.row + 1,
    },
  };
}
