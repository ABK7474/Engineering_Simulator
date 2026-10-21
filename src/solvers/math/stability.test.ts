import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/outer-door-01.json';
import { decayRateBySimulation, eigen, parseStabilityConfig } from './stability';
import { generateStability, meetsSpec, verifyStability } from './stability.generate';
import { buildStabilityReport, classifyStability, resolveStabilityOutcome } from './stability.outcomes';

const CFG = parseStabilityConfig(structuredClone(card.stages[1].config));
const P = { a: 0.5, b: 1, c: 3 };

describe('kararlılık: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) a = 0,5, b = 1, c = 3, k = 2: λ² + 2,5λ + 0,5 = 0 → λ = −0,2192 ve −2,2808 (reel, ζ = 1)', () => {
    const e = eigen(P, 2);
    expect(e.roots[0][0]).toBeCloseTo(-0.21922, 4);
    expect(e.roots[1][0]).toBeCloseTo(-2.28078, 4);
    expect(e.zeta).toBe(1);
  });

  it('2) k = 4: det = 2,5, Δ = 6,25 − 10 < 0 → λ = −1,25 ± 0,9682j, ζ = 1,25/√2,5 = 0,7906', () => {
    const e = eigen(P, 4);
    expect(e.roots[0][0]).toBeCloseTo(-1.25, 12);
    expect(e.roots[0][1]).toBeCloseTo(0.968246, 5);
    expect(e.zeta).toBeCloseTo(0.790569, 5);
  });

  it('3) k = 1: det = −0,5 < 0 → λ = 0,1861 (kararsız) ve −2,6861; kritik sınır k = (a + c)²/(4b) = 3,0625', () => {
    const e = eigen(P, 1);
    expect(e.maxRe).toBeCloseTo(0.186141, 5);
    expect(eigen(P, 3.0625).zeta).toBe(1);
    expect(eigen(P, 3.07).zeta).toBeLessThan(1);
  });

  it('4) bağımsız yol: benzetimden ölçülen sönüm hızı özdeğerle uyuşur (kararlı, salınımlı, kararsız)', () => {
    for (const k of [2, 4, 1]) expect(decayRateBySimulation(P, k)).toBeCloseTo(eigen(P, k).maxRe, 1);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: şartları sağlayan tek kazanç; küçükler yavaş/kararsız, büyükler salınımlı; benzetim uyuşur', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateStability(CFG, seed);
      expect(verifyStability(p), `tohum ${seed}`).toEqual([]);
      expect(p.bin.filter((b) => classifyStability(p, b.k) === 'success').map((b) => b.k)).toEqual([p.answer]);
      for (const b of p.bin) {
        if (b.k < p.answer) expect(meetsSpec(p, b.k).fast, `tohum ${seed}`).toBe(false);
        if (b.k > p.answer) expect(meetsSpec(p, b.k).damped, `tohum ${seed}`).toBe(false);
      }
    }
  }, 180_000);

  it('rapor: kökler, sınırlar ve benzetim grafiği', () => {
    const p = generateStability(CFG, 7);
    const wrong = p.bin.find((b) => b.k > p.answer)!;
    const r = buildStabilityReport('pressure-controller', p, wrong.id, resolveStabilityOutcome(p, wrong.id));
    expect(r.success).toBe(false);
    expect(r.steps.join(' ')).toContain('(a + c)²/(4b)');
    expect(r.plot!.series).toHaveLength(2);
  });
});
