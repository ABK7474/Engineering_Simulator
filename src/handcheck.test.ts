// HANDCHECK.md'deki el hesapları ile çözücülerin karşılaştırması. Sayılar testlerdeki sabitlerden bağımsız
// seçildi ve elle hesaplandı; burada yalnız kodun aynı sonucu verdiği denetlenir.

import { describe, expect, it } from 'vitest';
import gen from '../content/faults/generator-sync-01.json';
import { VARIANTS, type AlgoInput, type Cells } from './solvers/algo/variants';
import { handSolve } from './solvers/circuit/diode.generate';
import { diodeCurrent, solveBisection, solveNewton, VT } from './solvers/circuit/diode';
import { cutoff, cutoffBounds, gainComplex, resistorFor, toDb } from './solvers/circuit/filter';
import { closedForm, response, type SuperNetwork } from './solvers/circuit/superposition';
import { CS_GENERATED } from './solvers/cs/content';
import { finalValue, initialSlope, measuredBySimulation } from './solvers/math/laplace';
import { sumBySampling, sumPhasor } from './solvers/math/phasor';
import { eigen } from './solvers/math/stability';
import { metricsClosed, metricsRk4, zetaOf } from './solvers/ode/damping';
import { lampAt, lampAtRk4, tau } from './solvers/ode/light-decay';
import { Frac } from './solvers/prob/fraction';
import { atLeast, bayesExact, poissonCdfGamma, poissonCdfSeries } from './solvers/prob/probability';

const run = (i: AlgoInput) => {
  const v = VARIANTS[i.variant];
  const rows: Cells[] = [];
  let prev = v.initial(i);
  for (let j = 0; j < v.count(i); j++) rows.push((prev = v.step(i, prev, j)));
  return rows;
};

describe('el hesabı ↔ çözücü', () => {
  it('1 süperpozisyon: V₁ = 12 V, R = 100/200/100 Ω, V₂ = 6 V → I₃ = 0,06 A; tersinden V₂ = 6 V', () => {
    const n = (gen.stages[0].config as unknown as { networks: SuperNetwork[] }).networks.find((x) => x.id === 'two-generators')!;
    const p = { V1: 12, R1: 100, R2: 200, R3: 100 };
    expect(response(n, { ...p, V2: 6 })).toBeCloseTo(0.06, 12);
    expect(closedForm(n, { ...p, M: 0.06 }).value).toBeCloseTo(6, 10);
  });

  it('2 diyot: (20 mA, 3,10 V), (5 mA, 2,95 V), Vs = 5 V, I* = 15 mA → n·V_T = 0,108202 V, V_D = 3,068872 V, R = 128,742 Ω', () => {
    const h = handSolve([{ i: 0.02, v: 3.1 }, { i: 0.005, v: 2.95 }], 5, 0.015);
    expect(h.slope).toBeCloseTo(0.108202, 6);
    expect(h.vd).toBeCloseTo(3.068872, 6);
    expect(h.r).toBeCloseTo(128.742, 3);
    // İleri yön: bu R ile devre 15 mA'de çalışır (iki bağımsız çözücü)
    const d = { label: 'el', n: h.slope / VT, is: 0.02 / Math.expm1(3.1 / h.slope) };
    expect(diodeCurrent(d, 2.95)).toBeCloseTo(0.005, 6);
    expect(solveNewton(d, 5, h.r).i).toBeCloseTo(0.015, 6);
    expect(solveBisection(d, 5, h.r)).toBeCloseTo(0.015, 6);
  });

  it('3 filtre: RC, C = 47 nF, 1 kHz ≤ 1 dB, 20 kHz ≥ 20 dB → 1965,23 ≤ f_c ≤ 2010,08 Hz, 1684,65 ≤ R ≤ 1723,10 Ω; R = 1,7 kΩ: −0,976 dB / −20,078 dB', () => {
    const [lo, hi] = cutoffBounds(1000, -1, 20000, -20);
    expect(lo).toBeCloseTo(1965.227, 2);
    expect(hi).toBeCloseTo(2010.076, 2);
    const parts = { kind: 'rc' as const, part: 47e-9 };
    expect(resistorFor(parts, lo)).toBeCloseTo(1723.097, 2);
    expect(resistorFor(parts, hi)).toBeCloseTo(1684.651, 2);
    expect(cutoff(parts, 1700)).toBeCloseTo(1991.927, 2);
    expect(toDb(gainComplex(parts, 1700, 1000))).toBeCloseTo(-0.97615, 4);
    expect(toDb(gainComplex(parts, 1700, 20000))).toBeCloseTo(-20.078, 3);
  });

  it('4 sönüm: m = 60 kg, T₀ = 1,2 s → k = 1644,93 N/m, c_kritik = 628,32; c = 500 → ζ = 0,79577, aşma %1,611', () => {
    const wn = (2 * Math.PI) / 1.2;
    const door = { m: 60, k: 60 * wn * wn, c: 500 };
    expect(door.k).toBeCloseTo(1644.934, 3);
    expect(zetaOf(door)).toBeCloseTo(0.795775, 6);
    expect(metricsClosed(door).overshoot).toBeCloseTo(0.016112, 4);
    expect(metricsRk4(door).overshoot).toBeCloseTo(0.016112, 4);
  });

  it('5 kararlılık: a = 0,5, b = 1, c = 3, k = 5 → λ = −1,25 ± 1,391941j, ζ = 0,668153; k = 1,5 → λ = 0 (sınırda)', () => {
    const e = eigen({ a: 0.5, b: 1, c: 3 }, 5);
    expect(e.roots[0][0]).toBeCloseTo(-1.25, 12);
    expect(Math.abs(e.roots[0][1])).toBeCloseTo(1.391941, 6);
    expect(e.zeta).toBeCloseTo(0.668153, 6);
    expect(eigen({ a: 0.5, b: 1, c: 3 }, 1.5).maxRe).toBeCloseTo(0, 12);
  });

  it('6 Laplace: G = 2(s+1)/((s+0,5)(s+4)), U = 3 → y(∞) = 3, y′(0⁺) = 6', () => {
    const g = { K: 2, z: 1, p1: 0.5, p2: 4 };
    expect(finalValue(g, 3)).toBeCloseTo(3, 12);
    expect(initialSlope(g, 3)).toBeCloseTo(6, 12);
    const m = measuredBySimulation(g, 3);
    expect(m.final).toBeCloseTo(3, 4);
    expect(m.slope).toBeCloseTo(6, 2);
  });

  it('7 fazör: 20∠−60° + 40∠45° = 38,2843 + 10,9638j = 39,8232∠15,981°', () => {
    const s = sumPhasor({ a: 20, phi: -60 }, { a: 40, phi: 45 });
    expect(s.a).toBeCloseTo(39.82323, 4);
    expect(s.phi).toBeCloseTo(15.98053, 4);
    const b = sumBySampling({ a: 20, phi: -60 }, { a: 40, phi: 45 });
    expect(b.a).toBeCloseTo(39.82323, 3);
    expect(Math.abs(b.phi - 15.98053)).toBeLessThan(0.01);
  });

  it('8 Bayes: önsel %4, S1 %90/%10 alarm, S2 %80/%20 sessiz → 0,0072/0,084 = 3/35', () => {
    expect(bayesExact({ prior: 4, sens1: 90, fa1: 10, sens2: 80, fa2: 20, obs: 'firstOnly' }).cmp(new Frac(3n, 35n))).toBe(0);
  });

  it('9 binom: q = %90, en az 3: n = 4 → 0,9477; n = 5 → 0,99144; %99 için en az 5 pompa', () => {
    expect(atLeast(4, 3, 90).cmp(new Frac(9477n, 10000n))).toBe(0);
    expect(atLeast(5, 3, 90).cmp(new Frac(99144n, 100000n))).toBe(0);
  });

  it('10 Poisson: λ = 1,5 → P(N ≤ 2) = 0,808847, P(N ≤ 3) = 0,934358, P(N ≤ 4) = 0,981424; %95 için 4 yedek', () => {
    expect(poissonCdfSeries(2, 1.5)).toBeCloseTo(0.808847, 6);
    expect(poissonCdfSeries(3, 1.5)).toBeCloseTo(0.934358, 6);
    expect(poissonCdfSeries(4, 1.5)).toBeCloseTo(0.981424, 6);
    expect(poissonCdfGamma(4, 1.5)).toBeCloseTo(0.981424, 6);
  });

  it('11 algo-trace: BFS/DFS (0–1, 0–3, 1–2, 2–3, 3–4), seçme, ekleme, BST', () => {
    const adj = [[1, 3], [0, 2], [1, 3], [0, 2, 4], [3]];
    const bfs = run({ variant: 'bfs', n: 5, adj, start: 0 });
    expect(bfs.map((r) => r.u)).toEqual([0, 1, 3, 2, 4]);
    expect(bfs.map((r) => r.queue)).toEqual([[1, 3], [3, 2], [2, 4], [4], []]);
    expect(run({ variant: 'dfs', n: 5, adj, start: 0 }).at(-1)!.path).toEqual([4, 3, 2, 1, 0]);
    const sel = run({ variant: 'selection', array: [29, 10, 14, 37, 13] });
    expect(sel.map((r) => r.min)).toEqual([1, 4, 2, 4]);
    expect(sel[1].a).toEqual([10, 13, 14, 37, 29]);
    const ins = run({ variant: 'insertion', array: [31, 41, 59, 26, 53] });
    expect(ins.map((r) => r.shifts)).toEqual([0, 0, 3, 1]);
    const keys = [40, 20, 60, 10, 30, 50, 70, 25];
    const pre = run({ variant: 'bst', keys, traversal: 'pre' });
    expect(pre[7].path).toEqual([40, 20, 30]);
    expect(pre[8].output).toEqual([40, 20, 10, 30, 25, 60, 50, 70]);
    expect(run({ variant: 'bst', keys, traversal: 'post' })[8].output).toEqual([10, 25, 30, 20, 50, 70, 60, 40]);
  });

  it('12 cs-output: elle yürütülen programlar kayıtlı derleyici çıktısıyla aynı', () => {
    const out = (template: string, params: Record<string, unknown>) =>
      CS_GENERATED.instances.find((i) => i.template === template && JSON.stringify(i.params) === JSON.stringify(params))!.output;
    expect(out('struct-copy', { A: 40, B: 5, C: 8 })).toEqual(['40', '48', '88']);
    expect(out('try-finally', { L: 20, A: 7, B: 40 })).toEqual(['try 7', 'finally 7', 'catch 40', 'finally 40', '13']);
    expect(out('linq-deferred', { A: 18, B: 25, C: 47, D: 58, L: 20, M: 30 })).toEqual(['2', '105', '0']);
    expect(out('short-circuit', { P: false, Q: false, W: 10 })).toEqual(['kontrol 1', 'kontrol 2', 'kontrol 3', '60']);
  });

  it('13 acil ışık: 12 V, 0,47 F, R_L = 15 Ω, R = 10 Ω → τ = 11,75 s, V_L(15) = 2,008695 V, V_L(45) = 0,156342 V', () => {
    const p = { v0: 12, c: 0.47, rl: 15 };
    expect(tau(p, 10)).toBeCloseTo(11.75, 12);
    expect(lampAt(p, 10, 15)).toBeCloseTo(2.008695, 6);
    expect(lampAt(p, 10, 45)).toBeCloseTo(0.156342, 6);
    expect(lampAtRk4(p, 10, 45)).toBeCloseTo(0.156342, 6);
  });
});
