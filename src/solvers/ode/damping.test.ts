import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/outer-door-01.json';
import { metricsClosed, metricsRk4, parseDampingConfig, stepClosed, zetaOf } from './damping';
import { door, generateDamping, handSolve, verifyDamping } from './damping.generate';
import { buildDampingReport, classifyDamping, resolveDampingOutcome } from './damping.outcomes';

const CFG = parseDampingConfig(structuredClone(card.stages[0].config));

describe('sönüm: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) m = 60 kg, T₀ = 2 s → ω_n = π = 3,1416 rad/s, k = 60π² = 592,18 N/m, kritik c = 2·60·π = 376,99 N·s/m', () => {
    const h = handSolve(60, 2, [0.92, 1.08]);
    expect(h.wn).toBeCloseTo(Math.PI, 12);
    expect(h.k).toBeCloseTo(592.176, 3);
    expect(h.cCrit).toBeCloseTo(376.991, 3);
    // Pencere 0,92–1,08 → 346,8–407,2 N·s/m: E12'de yalnız 390 (ζ = 1,0345); 330 → 0,875, 470 → 1,247
    expect(h.cLo).toBeCloseTo(346.832, 3);
    expect(h.cHi).toBeCloseTo(407.150, 3);
    expect(zetaOf({ m: 60, k: h.k, c: 390 })).toBeCloseTo(1.03451, 5);
    expect(zetaOf({ m: 60, k: h.k, c: 330 })).toBeCloseTo(0.87535, 5);
  });

  it('2) ζ = 0,5 → aşma e^(−ζπ/√(1−ζ²)) = %16,30 (kapalı form ve RK4 aynı)', () => {
    const d = { m: 1, k: 1, c: 1 }; // ω_n = 1, ζ = 0,5
    expect(zetaOf(d)).toBeCloseTo(0.5, 12);
    expect(metricsClosed(d).overshoot).toBeCloseTo(0.16303, 4);
    expect(metricsRk4(d).overshoot).toBeCloseTo(0.16303, 4);
  });

  it('3) kritik sönüm: x(t) = 1 − e^(−ω_n t)(1 + ω_n t); t = 1/ω_n\'de 1 − 2/e = 0,26424; aşma yok', () => {
    const d = { m: 1, k: 4, c: 4 }; // ω_n = 2, ζ = 1
    expect(stepClosed(d, 0.5)).toBeCloseTo(1 - 2 / Math.E, 10);
    expect(metricsClosed(d).overshoot).toBe(0);
    // %2 oturma: (1 + ω t)e^(−ω t) = 0,02 → ω t ≈ 5,8335 → t ≈ 2,9167 s
    expect(metricsClosed(d).settling).toBeCloseTo(2.9167, 2);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: pencereye düşen tek amortisör, kapalı form = RK4, gösterilen T₀ ile elle aralık cevabı içerir', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateDamping(CFG, seed);
      expect(verifyDamping(CFG, p), `tohum ${seed}`).toEqual([]);
      expect(p.bin.filter((b) => classifyDamping(p, b.c) === 'success').map((b) => b.c)).toEqual([p.answer]);
    }
  }, 120_000);

  it('fizik ve rapor: az sönüm çarpar, fazla sönüm geç kalır; grafikte iki eğri ve ±%2 bandı', () => {
    const p = generateDamping(CFG, 2);
    const sorted = [...p.bin].sort((a, b) => a.c - b.c);
    expect(classifyDamping(p, sorted[0].c)).toBe('valve_slam');
    expect(classifyDamping(p, sorted[sorted.length - 1].c)).toBe('valve_late');
    const wrong = p.bin.find((b) => b.mistake)!;
    const r = buildDampingReport('door-damper', p, wrong.id, resolveDampingOutcome(p, wrong.id));
    expect(r.plot!.series).toHaveLength(2);
    expect(r.plot!.band).toEqual([0.98, 1.02]);
    expect(r.steps[0]).toContain('ω_n = 2π / T₀');
    expect(zetaOf(door(p, p.answer))).toBeGreaterThanOrEqual(p.zeta[0]);
  });
});
