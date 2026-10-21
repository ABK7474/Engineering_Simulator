import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/ai-core-index-01.json';
import { createRng } from '../../core/rng';
import { buildAlgoReport, compareCells, generateAlgoTrace, outcomePool, parseAlgoTraceConfig, repairPoints, resolveAlgoOutcome, verifyAlgoTrace } from './algo-trace';
import { VARIANTS, type AlgoInput, type Cells } from './variants';

const run = (i: AlgoInput) => {
  const v = VARIANTS[i.variant];
  const rows: Cells[] = [];
  let prev = v.initial(i);
  for (let j = 0; j < v.count(i); j++) rows.push((prev = v.step(i, prev, j)));
  return rows;
};
// 0–1, 0–2, 1–3, 2–3, 3–4
const ADJ = [[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]];

describe('algoritma izleme: elle kontrol edilebilir örnekler (beklenenler sabit)', () => {
  it('1) BFS, başlangıç 0: çıkış sırası 0, 1, 2, 3, 4; kuyruk [1,2] → [2,3] → [3] → [4] → []', () => {
    const rows = run({ variant: 'bfs', n: 5, adj: ADJ, start: 0 });
    expect(rows.map((r) => r.u)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.map((r) => r.queue)).toEqual([[1, 2], [2, 3], [3], [4], []]);
    expect(rows[1].visited).toEqual([0, 1, 2, 3]);
  });

  it('2) DFS, başlangıç 0: giriş sırası 0, 1, 3, 2, 4; 2 bitince 3\'e dönülür, yol [4, 3, 1, 0]', () => {
    const rows = run({ variant: 'dfs', n: 5, adj: ADJ, start: 0 });
    expect(rows.map((r) => r.u)).toEqual([0, 1, 3, 2, 4]);
    expect(rows[3].path).toEqual([2, 3, 1, 0]);
    expect(rows[4].path).toEqual([4, 3, 1, 0]);
  });

  it('3) ekleme sıralaması [5, 2, 4, 6, 1, 3]: kaydırmalar 1, 1, 0, 4, 3; sonuç sıralı', () => {
    const rows = run({ variant: 'insertion', array: [5, 2, 4, 6, 1, 3] });
    expect(rows.map((r) => r.shifts)).toEqual([1, 1, 0, 4, 3]);
    expect(rows[3].a).toEqual([1, 2, 4, 5, 6, 3]);
    expect(rows[4].a).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('4) seçme sıralaması [64, 25, 12, 22, 11]: min indisleri 4, 2, 3, 3', () => {
    const rows = run({ variant: 'selection', array: [64, 25, 12, 22, 11] });
    expect(rows.map((r) => r.min)).toEqual([4, 2, 3, 3]);
    expect(rows[0].a).toEqual([11, 25, 12, 22, 64]);
    expect(rows[1].a).toEqual([11, 12, 25, 22, 64]);
  });

  it('5) BST 50, 30, 70, 20, 40, 60, 80: 40\'ın yolu [50, 30]; preorder 50 30 20 40 70 60 80; postorder 20 40 30 60 80 70 50', () => {
    const keys = [50, 30, 70, 20, 40, 60, 80];
    const pre = run({ variant: 'bst', keys, traversal: 'pre' });
    expect(pre[4].path).toEqual([50, 30]);
    expect(pre[0].path).toEqual([]);
    expect(pre[7].output).toEqual([50, 30, 20, 40, 70, 60, 80]);
    expect(run({ variant: 'bst', keys, traversal: 'post' })[7].output).toEqual([20, 40, 30, 60, 80, 70, 50]);
  });

  it('6) bağımsız uygulamalar aynı izlemeyi verir', () => {
    const inputs: AlgoInput[] = [
      { variant: 'bfs', n: 5, adj: ADJ, start: 3 },
      { variant: 'dfs', n: 5, adj: ADJ, start: 4 },
      { variant: 'insertion', array: [5, 2, 4, 6, 1, 3] },
      { variant: 'selection', array: [64, 25, 12, 22, 11] },
      { variant: 'bst', keys: [50, 30, 70, 20, 40, 60, 80], traversal: 'post' },
    ];
    for (const i of inputs) expect(VARIANTS[i.variant].reference(i), i.variant).toEqual(run(i));
  });

  it('7) BFS kuyruk-yığın karışması: [2, 3] kuyruğunda 3 çıkarılır', () => {
    const i: AlgoInput = { variant: 'bfs', n: 5, adj: ADJ, start: 0 };
    const rows = run(i);
    const bad = VARIANTS.bfs.corrupt(i, 'lifo', rows[0], 1, createRng(1));
    expect(bad).toEqual({ u: 2, queue: [1, 3], visited: [0, 1, 2, 3] });
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  const cfgs = card.stages.map((s) => parseAlgoTraceConfig(structuredClone(s.config)));

  it('her aşamada 1000 tohum: bağımsız uygulamayla uyuşur, tek onarım noktası', () => {
    for (const cfg of cfgs)
      for (let seed = 1; seed <= 1000; seed++) {
        const p = generateAlgoTrace(cfg, seed);
        expect(verifyAlgoTrace(p), `tohum ${seed}`).toEqual([]);
        expect(repairPoints(p)).toEqual([p.bad]);
      }
  }, 120_000);

  it('sonuç havuzu: doğru satır + doğru değer başarı; komşu satır yeniden başlatma; sıra hatası donma', () => {
    const p = generateAlgoTrace(cfgs[1], 21);
    expect(outcomePool(p, { row: p.bad, cells: p.rows[p.bad] })).toEqual([{ value: 'success', weight: 1 }]);
    const near = p.bad > 0 ? p.bad - 1 : p.bad + 1;
    expect(outcomePool(p, { row: near, cells: p.rows[near] })[0]).toEqual({ value: 'core_reboot', weight: 1 });
    const list = p.columns.find((c) => c.kind === 'list' && (p.rows[p.bad][c.id] as number[]).length >= 2)!;
    const rev = { ...p.rows[p.bad], [list.id]: [...(p.rows[p.bad][list.id] as number[])].reverse() };
    expect(compareCells(p, { row: p.bad, cells: rev }).wrongOrder.length).toBe(1);
    expect(resolveAlgoOutcome(p, { row: p.bad, cells: rev }, createRng(1)).kind).toBe('core_freeze');
  });

  it('rapor: bozma açıklaması, doğru izleme tablosu', () => {
    const p = generateAlgoTrace(cfgs[0], 5);
    const a = { row: p.bad, cells: p.shown[p.bad] };
    const r = buildAlgoReport('core-index', p, a, resolveAlgoOutcome(p, a, createRng(2)));
    expect(r.success).toBe(false);
    expect(r.steps[0]).toContain(p.corruption.explanation);
    expect(r.table!.rows.length).toBe(p.rows.length + 1);
  });
});
