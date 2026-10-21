import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/airlock-valve-01.json';
import { placements } from './design-core';
import { outputClosed, outputMna, parseOpampConfig, SLOTS } from './opamp';
import { generateOpamp, handSolution, verifyOpamp, type OpampProblem } from './opamp.generate';
import { classifyOpamp, resolveOpampOutcome } from './opamp.outcomes';
import { buildOpampReport } from './opamp.report';

const CFG = parseOpampConfig(structuredClone(card.stages[0].config));

// ---------------------------------------------------------------- elle kontrol edilecek örnekler
describe('op-amp: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) evirmeyen: Rf = 22 kΩ, Rg = 4,7 kΩ → G = 1 + 22/4,7 = 5,681; 0,5 V → 2,840 V, 0,8 V → 4,545 V', () => {
    const r = { Rf: 22_000, Rg: 4_700 };
    expect(outputMna('gain', 0.5, 0, r)).toBeCloseTo(0.5 * (1 + 22 / 4.7), 9);
    expect(outputMna('gain', 0.5, 0, r)).toBeCloseTo(2.8404, 4);
    expect(outputMna('gain', 0.8, 0, r)).toBeCloseTo(4.5447, 4);
    // Elle: G = (4,54 − 2,84) / (0,8 − 0,5) = 5,667 → Rf/Rg = 4,667 (gerçek 4,681; %0,3)
    expect(handSolution('gain', 0.5, 0.8, 2.84, 4.54, 0).ratioFg).toBeCloseTo(4.6667, 4);
  });

  it('2) referanslı ofset: Vs 0,25…0,8 V, V_ref = 2,5 V, Rf = 47k, Rg = 10k, Rr = 100k → 0,3675 V … 3,761 V', () => {
    // G = 1 + 4,7 + 0,47 = 6,17; ofset = −2,5·0,47 = −1,175 → 0,25·6,17 − 1,175 = 0,3675; 0,8·6,17 − 1,175 = 3,761
    const r = { Rf: 47_000, Rg: 10_000, Rr: 100_000 };
    expect(outputMna('offset', 0.25, 2.5, r)).toBeCloseTo(0.3675, 9);
    expect(outputMna('offset', 0.8, 2.5, r)).toBeCloseTo(3.761, 9);
    const s = handSolution('offset', 0.25, 0.8, 0.3675, 3.761, 2.5);
    expect(s.G).toBeCloseTo(6.17, 9);
    expect(s.b).toBeCloseTo(-1.175, 9);
    expect(s.ratioFr).toBeCloseTo(0.47, 9);
    expect(s.ratioFg).toBeCloseTo(4.7, 9);
  });

  it('3) doyma: Rf = 100k, Rg = 10k (G = 11), 0,5 V → ideal 5,5 V > 5 V ray → kırpılır', () => {
    const p: OpampProblem = {
      seed: 0, variant: 'gain', vcc: 5, vlo: 0.2, vhi: 0.5, vref: 0, ylo: 1, yhi: 4, tolerance: 0.04,
      answer: { Rf: 15_000, Rg: 1_000 }, bin: [{ id: 'a', r: 100_000, label: '100 kΩ' }, { id: 'b', r: 10_000, label: '10 kΩ' }], scope: {},
    };
    expect(outputMna('gain', 0.5, 0, { Rf: 100_000, Rg: 10_000 })).toBeCloseTo(5.5, 12);
    expect(classifyOpamp(p, { Rf: 100_000, Rg: 10_000 })).toBe('opamp_saturated');
    expect(resolveOpampOutcome(p, { Rf: 'a', Rg: 'b' }).headline).toContain('doydu');
  });

  it('MNA ile kapalı form iki varyantta aynı', () => {
    for (const [v, r] of [['gain', { Rf: 33_000, Rg: 6_800 }], ['offset', { Rf: 68_000, Rg: 15_000, Rr: 220_000 }]] as const)
      for (const vs of [0.2, 0.7, 1.3]) expect(outputMna(v, vs, 1.25, r)).toBeCloseTo(outputClosed(v, vs, 1.25, r), 9);
  });
});

// ---------------------------------------------------------------- tek anlamlılık
describe('üretici ve doğrulayıcı', () => {
  it('1000 tohumda: kutudaki tüm yerleşimlerden yalnız cevap toleransta, cevap raylarda değil, elle çözüm oranları tutuyor', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateOpamp(CFG, seed);
      expect(verifyOpamp(CFG, p), `tohum ${seed}`).toEqual([]);
      seen.add(p.variant);
      const slots = SLOTS[p.variant];
      const ok = placements(slots, p.bin.map((b) => b.id)).filter((pl) => classifyOpamp(p, Object.fromEntries(slots.map((s) => [s, p.bin.find((b) => b.id === pl[s])!.r]))) === 'success');
      expect(ok, `tohum ${seed}`).toHaveLength(1);
    }
    expect(seen).toEqual(new Set(['gain', 'offset']));
  }, 60_000);

  it('rapor: kazanç, ofset ve oranlar adım adım; hatalı kart açıklanır', () => {
    const p = generateOpamp({ ...CFG, variants: ['offset'] }, 6);
    const wrong = p.bin.find((b) => b.mistake && !Object.values(p.answer).includes(b.r));
    const pl = Object.fromEntries(SLOTS.offset.map((s) => [s, p.bin.find((b) => b.r === p.answer[s])!.id]));
    if (wrong) pl.Rg = wrong.id;
    const r = buildOpampReport('pressure-sensor', p, pl, resolveOpampOutcome(p, pl));
    expect(r.steps[0]).toContain('Kazanç');
    expect(r.steps.join(' ')).toContain('Rf/Rr = −b / V_ref');
  });
});
