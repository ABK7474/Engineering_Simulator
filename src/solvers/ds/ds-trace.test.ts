import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/computer-core-01.json';
import { createRng } from '../../core/rng';
import { corruptRow } from './corrupt';
import { generateDsTrace, type DsTraceProblem } from './ds-trace.generate';
import { outcomePool, resolveTraceOutcome, type TraceAnswer } from './ds-trace.outcomes';
import { buildDsTraceReport, traceColumns } from './ds-trace.report';
import { repairPoints, verifyDsTrace } from './ds-trace.verify';
import { parseDsTraceConfig, type Stmt, type TraceTemplate } from './ir';
import { printInstrumented, printProgram, TemplateRejected } from './print';
import { referenceRun } from './reference';
import { SimError, simulate, step } from './simulate';

const tpl = (structures: TraceTemplate['structures'], body: Stmt[], params: Record<string, number[]> = {}): TraceTemplate => ({
  id: 'test',
  story: '',
  structures,
  params,
  body,
});
const last = (t: TraceTemplate, params: Record<string, number> = {}) => simulate(t, params).rows.at(-1)!.after;

// ---------------------------------------------------------------- elle kontrol edilecek 5 örnek
describe('simülatör: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) yığın: i = 1..5 için Push(i*3), sonra iki Pop → s = [9, 6, 3] (tepe → dip), x = 12', () => {
    // Push: 3, 6, 9, 12, 15 → tepe 15. Pop 15, Pop 12.
    const t = tpl([{ name: 's', kind: 'stack' }], [
      { for: 'i', from: '1', to: '5', body: [{ call: 'Push', on: 's', arg: 'i*3' }] },
      { call: 'Pop', on: 's', into: 'x' },
      { call: 'Pop', on: 's', into: 'x' },
    ]);
    const tr = simulate(t, {});
    expect(tr.rows).toHaveLength(7);
    expect(tr.rows[4].after.structs.s).toEqual([15, 12, 9, 6, 3]);
    expect(tr.rows[5].after.vars.x).toBe(15);
    expect(last(t)).toEqual({ structs: { s: [9, 6, 3] }, vars: { i: null, x: 12 } });
  });

  it('2) kuyruk döndürme: [4, 9, 15, 21], i = 1..3 için x = Dequeue, Enqueue(x + i) → q = [21, 5, 11, 18]', () => {
    // i=1: 4 → 5 · i=2: 9 → 11 · i=3: 15 → 18
    const t = tpl([{ name: 'q', kind: 'queue', init: ['4', '9', '15', '21'] }], [
      { for: 'i', from: '1', to: '3', body: [{ call: 'Dequeue', on: 'q', into: 'x' }, { call: 'Enqueue', on: 'q', arg: 'x+i' }] },
    ]);
    const tr = simulate(t, {});
    expect(tr.rows).toHaveLength(6);
    expect(tr.rows.map((r) => r.after.vars.x)).toEqual([4, 4, 9, 9, 15, 15]);
    expect(last(t)).toEqual({ structs: { q: [21, 5, 11, 18] }, vars: { i: 3, x: 15 } });
  });

  it('3) iki yığınla kuyruk: giriş 3, 6, 9, 12 → çıkış [3, 6, 9, 12]; Pop → y = 3, çıkış [6, 9, 12]', () => {
    const t = tpl([{ name: 'giris', kind: 'stack' }, { name: 'cikis', kind: 'stack' }], [
      { for: 'i', from: '1', to: '4', body: [{ call: 'Push', on: 'giris', arg: 'i*3' }] },
      { while: { count: 'giris', op: '>', value: '0' }, body: [{ call: 'Pop', on: 'giris', into: 'x' }, { call: 'Push', on: 'cikis', arg: 'x' }] },
      { call: 'Pop', on: 'cikis', into: 'y' },
    ]);
    const tr = simulate(t, {});
    expect(tr.rows).toHaveLength(13);
    expect(tr.rows[11].after.structs).toEqual({ giris: [], cikis: [3, 6, 9, 12] });
    expect(last(t)).toEqual({ structs: { giris: [], cikis: [6, 9, 12] }, vars: { i: null, x: null, y: 3 } });
  });

  it('4) bağlı liste, tekrar eden değer: [5, 8, 5, 12] → AddAfter(Find(5), 20), Remove(5), AddAfter(Find(5), 7), Remove(9) → [20, 8, 5, 7, 12]', () => {
    // Find(5) ilk 5'i bulur: [5, 20, 8, 5, 12] · Remove(5) ilk 5'i siler: [20, 8, 5, 12]
    // Find(5) artık kalan 5: [20, 8, 5, 7, 12] · Remove(9) bulamaz, false döner, liste değişmez
    const t = tpl([{ name: 'list', kind: 'list', init: ['5', '8', '5', '12'] }], [
      { call: 'AddAfter', on: 'list', after: '5', arg: '20' },
      { call: 'Remove', on: 'list', arg: '5' },
      { call: 'AddAfter', on: 'list', after: '5', arg: '7' },
      { call: 'Remove', on: 'list', arg: '9' },
    ]);
    const rows = simulate(t, {}).rows.map((r) => r.after.structs.list);
    expect(rows).toEqual([
      [5, 20, 8, 5, 12],
      [20, 8, 5, 12],
      [20, 8, 5, 7, 12],
      [20, 8, 5, 7, 12],
    ]);
  });

  it('5) if/else dallı aktarım: kuyruk [3, 4, 7, 10]; çiftse Push(x), tekse Push(x*2) → s = [10, 14, 4, 6]', () => {
    // 3 → 6 · 4 → 4 · 7 → 14 · 10 → 10 (tepe en son itilen)
    const t = tpl([{ name: 'q', kind: 'queue', init: ['3', '4', '7', '10'] }, { name: 's', kind: 'stack' }], [
      {
        while: { count: 'q', op: '>', value: '0' },
        body: [
          { call: 'Dequeue', on: 'q', into: 'x' },
          { if: { var: 'x', mod: 2, eq: 0 }, then: [{ call: 'Push', on: 's', arg: 'x' }], else: [{ call: 'Push', on: 's', arg: 'x*2' }] },
        ],
      },
    ]);
    const tr = simulate(t, {});
    expect(tr.rows).toHaveLength(8);
    expect(last(t).structs).toEqual({ q: [], s: [10, 14, 4, 6] });
  });
});

// ---------------------------------------------------------------- C# davranışı ve kapsam
describe('C# davranışı ve kapsam denetimi', () => {
  it('yığın kurucusu: new Stack<int>(new[] { 1, 2, 3 }) → tepe 3', () => {
    const t = tpl([{ name: 's', kind: 'stack', init: ['1', '2', '3'] }], [{ call: 'Peek', on: 's', into: 'x' }]);
    expect(simulate(t, {}).initial.structs.s).toEqual([3, 2, 1]);
    expect(last(t).vars.x).toBe(3);
    expect(referenceRun(t, {})[0].vars.x).toBe(3);
  });

  it('LinkedList: Find ve Remove ilk eşleşmeyi bulur; simülatör ve bağımsız yürütücü aynı', () => {
    const t = tpl([{ name: 'list', kind: 'list', init: ['7', '1', '7', '1'] }], [
      { call: 'AddAfter', on: 'list', after: '1', arg: '9' },
      { call: 'Remove', on: 'list', arg: '7' },
      { call: 'Remove', on: 'list', arg: '1' },
    ]);
    const sim = simulate(t, {}).rows.map((r) => r.after.structs.list);
    const ref = referenceRun(t, {}).map((r) => r.structs.list);
    expect(sim).toEqual([
      [7, 1, 9, 7, 1],
      [1, 9, 7, 1],
      [9, 7, 1],
    ]);
    expect(ref).toEqual(sim);
  });

  it('Find bulamazsa null: AddAfter(null, …) şablonu reddeder (iki yürütücüde de)', () => {
    const t = tpl([{ name: 'list', kind: 'list', init: ['1', '2'] }], [{ call: 'AddAfter', on: 'list', after: '99', arg: '5' }]);
    expect(() => simulate(t, {})).toThrow(SimError);
    expect(() => simulate(t, {})).toThrow(/Find\(99\) null.*ArgumentNullException/);
    expect(() => referenceRun(t, {})).toThrow(/Find null/);
  });

  it('boş yapıdan Pop ve sonsuz döngü reddedilir', () => {
    expect(() => simulate(tpl([{ name: 's', kind: 'stack' }], [{ call: 'Pop', on: 's', into: 'x' }]), {})).toThrow(/InvalidOperationException/);
    const loop = tpl([{ name: 'q', kind: 'queue', init: ['1'] }], [
      { while: { count: 'q', op: '>', value: '0' }, body: [{ call: 'Dequeue', on: 'q', into: 'x' }, { call: 'Enqueue', on: 'q', arg: 'x' }] },
    ]);
    expect(() => simulate(loop, {})).toThrow(/adımı aştı/);
  });

  it('kapsam: döngü içinde bildirilen değişken döngüden sonra kullanılırsa şablon reddedilir', () => {
    const t = tpl([{ name: 's', kind: 'stack', init: ['1', '2'] }], [
      { while: { count: 's', op: '>', value: '1' }, body: [{ call: 'Pop', on: 's', into: 'x' }] },
      { call: 'Push', on: 's', arg: 'x+1' },
    ]);
    expect(() => printProgram(t, {})).toThrow(TemplateRejected);
    expect(() => printProgram(t, {})).toThrow(/'x' bu noktada kapsam dışında/);
  });

  it('kapsam: for sayacı döngüden sonra kullanılamaz; dışarıda bildirilen değişken içeride atanıp sonra kullanılabilir', () => {
    const counter = tpl([{ name: 's', kind: 'stack' }], [
      { for: 'i', from: '1', to: '2', body: [{ call: 'Push', on: 's', arg: 'i' }] },
      { call: 'Push', on: 's', arg: 'i' },
    ]);
    expect(() => printProgram(counter, {})).toThrow(/'i' bu noktada kapsam dışında/);
    const ok = tpl([{ name: 's', kind: 'stack', init: ['4', '5'] }], [
      { let: 'x', value: '0' },
      { while: { count: 's', op: '>', value: '0' }, body: [{ call: 'Pop', on: 's', into: 'x' }] },
      { call: 'Push', on: 's', arg: 'x*2' },
    ]);
    const lines = printProgram(ok, {}).lines.map((l) => l.trim());
    expect(lines).toContain('int x = 0;');
    expect(lines).toContain('x = s.Pop();');
    expect(last(ok).structs.s).toEqual([8]);
  });

  it('yazıcının satır numarası izlemedeki satırla aynı; enstrümanlı sürüm aynı satırları yazdırır', () => {
    const t = parseDsTraceConfig(structuredClone(card.stages[1].config)).templates[0];
    const params = { N: 5, K: 3, M: 1 };
    const tr = simulate(t, params);
    for (const r of tr.rows) expect(tr.program.lines[r.line - 1].trim()).toBe(`${r.text};`);
    const cs = printInstrumented(t, params, 'P1');
    expect(cs).toContain('static class P1');
    const dumped = [...cs.matchAll(/D\.Row\((\d+),/g)].map((m) => Number(m[1]));
    expect(new Set(dumped)).toEqual(new Set(tr.rows.map((r) => r.line)));
  });
});

// ---------------------------------------------------------------- bozma
describe('bozma türleri: klasik öğrenci hataları', () => {
  const t = tpl([{ name: 's', kind: 'stack' }, { name: 'q', kind: 'queue', init: ['1', '2'] }], [
    { for: 'i', from: '1', to: '4', body: [{ call: 'Push', on: 's', arg: 'i*3' }] },
    { call: 'Pop', on: 's', into: 'x' },
    { call: 'Dequeue', on: 'q', into: 'y' },
  ]);
  const tr = simulate(t, {});
  const kinds = tr.kinds;
  const prevOf = (j: number) => (j === 0 ? tr.initial : tr.rows[j - 1].after);

  it('yığın↔kuyruk: Pop dipten, Dequeue sondan alınmış', () => {
    expect(step(prevOf(4), tr.rows[4], kinds, {}, { otherEnd: true }).structs.s).toEqual([12, 9, 6]); // 3 dipten gitti
    expect(step(prevOf(4), tr.rows[4], kinds, {}, { otherEnd: true }).vars.x).toBe(3);
    expect(step(prevOf(5), tr.rows[5], kinds, {}, { otherEnd: true }).vars.y).toBe(2);
    expect(corruptRow('order_confusion', tr.rows[4], prevOf(4), kinds, {}, createRng(1))?.state.vars.x).toBe(3);
  });

  it('etkiyi atlama: Pop, Peek gibi — değer okunmuş ama eleman yerinde', () => {
    const c = corruptRow('skip_effect', tr.rows[4], prevOf(4), kinds, {}, createRng(1))!;
    expect(c.state.structs.s).toEqual([12, 9, 6, 3]);
    expect(c.state.vars.x).toBe(12);
  });

  it('bir kayma: i = 3 iken Push(i*3) yerine i−1 ya da i+1 ile', () => {
    const c = corruptRow('off_by_one', tr.rows[2], prevOf(2), kinds, {}, createRng(1))!;
    expect([[6, 6, 3], [12, 6, 3]]).toContainEqual(c.state.structs.s);
  });

  it('yanlış uç: AddFirst yerine AddLast; uygulanamayan yerde null', () => {
    const lt = tpl([{ name: 'list', kind: 'list', init: ['1', '2'] }], [{ call: 'AddFirst', on: 'list', arg: '9' }]);
    const ltr = simulate(lt, {});
    expect(corruptRow('wrong_end', ltr.rows[0], ltr.initial, ltr.kinds, {}, createRng(1))?.state.structs.list).toEqual([1, 2, 9]);
    expect(corruptRow('wrong_end', tr.rows[4], prevOf(4), kinds, {}, createRng(1))).toBeNull();
  });
});

// ---------------------------------------------------------------- üretim ve tek anlamlılık
const CFG = parseDsTraceConfig(structuredClone(card.stages[1].config));

describe('üretici ve doğrulayıcı', () => {
  it('1000 tohumun hepsinde tek bozuk satır, tek onarım noktası, doğru değer tek; bağımsız yürütücü uyuşur', () => {
    const seen = { templates: new Set<string>(), kinds: new Set<string>() };
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateDsTrace(CFG, seed);
      const v = verifyDsTrace(p, CFG.lines, CFG.ops);
      expect(v.errors, `tohum ${seed}`).toEqual([]);
      const diff = p.rows.filter((r, j) => JSON.stringify(r.after) !== JSON.stringify(p.shown[j])).length;
      expect(diff, `tohum ${seed}`).toBe(1);
      expect(repairPoints(p), `tohum ${seed}`).toEqual([p.bad]);
      const prev = p.bad === 0 ? p.initial : p.shown[p.bad - 1];
      expect(step(prev, p.rows[p.bad], p.kinds, p.params)).toEqual(p.rows[p.bad].after);
      expect(p.code.length).toBeGreaterThanOrEqual(15);
      expect(p.code.length).toBeLessThanOrEqual(25);
      seen.templates.add(p.template.id);
      seen.kinds.add(p.corruption.kind);
    }
    expect(seen.templates.size).toBe(CFG.templates.length);
    expect(seen.kinds.size).toBe(4);
  }, 60_000);

  it('aynı tohum → aynı problem', () => {
    expect(JSON.stringify(generateDsTrace(CFG, 42))).toBe(JSON.stringify(generateDsTrace(CFG, 42)));
  });

  it('ikinci bir olası hata yeri olan tablo reddedilir', () => {
    const p = generateDsTrace(CFG, 3);
    const other = (p.bad + 3) % p.rows.length;
    const shown = [...p.shown];
    shown[other] = { ...shown[other], structs: Object.fromEntries(Object.entries(shown[other].structs).map(([k, v]) => [k, [...v, 999]])) };
    expect(verifyDsTrace({ ...p, shown }, CFG.lines, CFG.ops).ok).toBe(false);
  });

  it('yapı türü kısıtı: yalnız yığın+kuyruk istenirse bağlı liste şablonu gelmez', () => {
    const cfg = { ...CFG, structures: ['stack', 'queue'] as ('stack' | 'queue')[] };
    for (let seed = 1; seed <= 50; seed++) expect(generateDsTrace(cfg, seed).structs.every((s) => s.kind !== 'list')).toBe(true);
  });

  it('sayaç gizleme: hideCounters açıkken tabloda i sütunu yok', () => {
    const p = generateDsTrace({ ...CFG, hideCounters: true }, 5);
    expect(traceColumns(p).vars.some((v) => p.columns.find((c) => c.name === v)?.counter)).toBe(false);
    const q = generateDsTrace(CFG, 5);
    if (q.columns.some((c) => c.counter)) expect(traceColumns(q).vars).toContain(q.columns.find((c) => c.counter)!.name);
  });

  it('yapılandırma hataları açıklamalı', () => {
    expect(() => parseDsTraceConfig({ ...structuredClone(card.stages[1].config), ops: [9, 2] })).toThrow(/ops \[min, max\]/);
    const bad = structuredClone(card.stages[1].config) as { templates: { body: unknown[] }[] };
    bad.templates[0].body.push({ call: 'Dequeue', on: 's' });
    expect(() => parseDsTraceConfig(bad)).toThrow(/stack için 'Dequeue' yok/);
  });
});

// ---------------------------------------------------------------- sonuçlar ve rapor
describe('hata sonuçları ve olay raporu', () => {
  const p = generateDsTrace(CFG, 11);
  const correct = (q: DsTraceProblem, row = q.bad): TraceAnswer => ({
    row,
    structs: structuredClone(q.rows[q.bad].after.structs),
    vars: Object.fromEntries(q.columns.filter((c) => !c.counter).map((c) => [c.name, q.rows[q.bad].after.vars[c.name]])),
  });

  it('doğru satır + doğru durum → başarı', () => {
    expect(resolveTraceOutcome(p, correct(p), createRng(1)).kind).toBe('success');
  });

  it('komşu yanlış satır → çekirdek yeniden başlar; uzak satır → çöker (bellek hatası)', () => {
    const near = p.bad > 0 ? p.bad - 1 : p.bad + 1;
    expect(outcomePool(p, correct(p, near))).toEqual([
      { value: 'core_reboot', weight: 1 },
      { value: 'core_crash', weight: 0 },
    ]);
    const far = p.bad >= 4 ? p.bad - 4 : p.bad + 4;
    expect(resolveTraceOutcome(p, correct(p, far), createRng(1)).kind).toBe('core_crash');
  });

  it('doğru satır, eksik eleman → sensör yanlış okur; elemanlar doğru sıra ters → zamanlayıcı donar', () => {
    const a = correct(p);
    const name = p.structs.find((s) => a.structs[s.name].length > 0)!.name;
    a.structs[name] = a.structs[name].slice(1);
    expect(resolveTraceOutcome(p, a, createRng(1)).kind).toBe('sensor_misread');
    // Sırası ters çevrilebilen (iki farklı eleman içeren) bir problem bul
    let seed = 1;
    let q = generateDsTrace(CFG, seed);
    const reversible = (x: DsTraceProblem) => x.structs.find((s) => new Set(x.rows[x.bad].after.structs[s.name]).size > 1);
    while (!reversible(q)) q = generateDsTrace(CFG, ++seed);
    const b = correct(q);
    const s = reversible(q)!.name;
    b.structs[s] = [...b.structs[s]].reverse();
    expect(resolveTraceOutcome(q, b, createRng(1)).kind).toBe('core_freeze');
  });

  it('rapor: doğru izleme tablosu (başlangıç + her adım), bozuk ve seçilen satır işaretli, bozma açıklaması', () => {
    const a = correct(p);
    const r = buildDsTraceReport('core-scheduler', p, a, resolveTraceOutcome(p, a, createRng(1)));
    expect(r.table!.rows).toHaveLength(p.rows.length + 1);
    expect(r.table!.bad).toBe(p.bad + 1);
    expect(r.steps[0]).toContain(p.corruption.explanation);
    expect(r.steps).toHaveLength(p.rows.length + 1);
  });
});
