import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/bilge-pumps-01.json';
import { Frac } from './fraction';
import { atLeast, bayesExact, parseProbConfig, poissonCdfGamma, poissonCdfSeries } from './probability';
import { buildProbReport, classifyProb, generateProb, resolveProbOutcome } from './probability.generate';

const BAYES = parseProbConfig(structuredClone(card.stages[0].config));
const REDUND = parseProbConfig(structuredClone(card.stages[1].config));

describe('olasılık: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) Bayes, önsel %1, iki sensör %90/%5, ikisi alarm: 0,0081 / (0,0081 + 0,99·0,0025) = 36/47', () => {
    const p = bayesExact({ prior: 1, sens1: 90, fa1: 5, sens2: 90, fa2: 5, obs: 'both' });
    expect(p.cmp(new Frac(36n, 47n))).toBe(0);
    expect(p.toNumber()).toBeCloseTo(0.765957, 6);
  });

  it('2) Bayes, önsel %2, S1 %95/%5 alarm, S2 %90/%10 sessiz: 0,0019 / (0,0019 + 0,0441) = 19/460', () => {
    const p = bayesExact({ prior: 2, sens1: 95, fa1: 5, sens2: 90, fa2: 10, obs: 'firstOnly' });
    expect(p.cmp(new Frac(19n, 460n))).toBe(0);
  });

  it('3) binom: q = %80, en az 2: n = 3 → 0,384 + 0,512 = 112/125; n = 4 → 1 − 0,0016 − 0,0256 = 0,9728', () => {
    expect(atLeast(3, 2, 80).cmp(new Frac(112n, 125n))).toBe(0);
    expect(atLeast(4, 2, 80).toNumber()).toBeCloseTo(0.9728, 12);
  });

  it('4) Poisson λ = 2: P(N ≤ 3) = e⁻²·(1 + 2 + 2 + 4/3) = 0,857123; gama integrali aynı', () => {
    expect(poissonCdfSeries(3, 2)).toBeCloseTo(0.857123, 6);
    expect(poissonCdfGamma(3, 2)).toBeCloseTo(0.857123, 6);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda Bayes: Monte Carlo uyuşur, klasik hatalar kabul edilmez', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateProb(BAYES, seed);
      if (p.variant !== 'bayes') throw new Error('bayes bekleniyordu');
      expect(classifyProb(p, p.answer)).toBe('success');
      for (const m of p.mistakes) expect(classifyProb(p, m.value), `tohum ${seed}: ${m.text}`).not.toBe('success');
    }
  }, 240_000);

  it('1000 tohumda binom/Poisson: tek doğru sayı; az olan yetmez, fazla olan israf', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateProb(REDUND, seed);
      if (p.variant === 'bayes') throw new Error('bayes beklenmiyordu');
      seen.add(p.variant);
      expect(p.bin.filter((b) => classifyProb(p, b.n) === 'success').map((b) => b.n)).toEqual([p.answer]);
      for (const t of p.table) expect(t.p >= p.reliability / 100, `tohum ${seed}, n ${t.n}`).toBe(t.n >= p.answer);
      for (const b of p.bin) if (b.n !== p.answer) expect(classifyProb(p, b.n)).toBe(b.n < p.answer ? 'redundancy_lost' : 'power_waste');
    }
    expect([...seen].sort()).toEqual(['binomial', 'poisson']);
  }, 240_000);

  it('Bayes sonuç yönü: abartı boşa tahliye, küçümseme kaçak', () => {
    const p = generateProb(BAYES, 4);
    expect(classifyProb(p, p.answer + 0.2)).toBe('false_alarm');
    expect(classifyProb(p, Math.max(0, p.answer - 0.2))).toBe('leak_ignored');
  });

  it('rapor: Bayes adımları ve tablo', () => {
    const b = generateProb(BAYES, 9);
    const rb = buildProbReport('leak-diagnosis', b, b.answer, resolveProbOutcome(b, b.answer));
    expect(rb.success).toBe(true);
    expect(rb.steps.join(' ')).toContain('Bayes');
    const r = generateProb(REDUND, 9);
    if (r.variant === 'bayes') throw new Error('x');
    const x = r.answer - 1;
    const rr = buildProbReport('pump-redundancy', r, x, resolveProbOutcome(r, x));
    expect(rr.success).toBe(false);
    expect(rr.table!.rows.length).toBe(r.table.length);
  });
});
