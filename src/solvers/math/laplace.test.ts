import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/outer-door-01.json';
import { finalValue, initialSlope, measuredBySimulation, parseLaplaceConfig } from './laplace';
import { buildLaplaceReport, classifyLaplace, generateLaplace, MISTAKE_MARGIN, resolveLaplaceOutcome, verifyLaplace } from './laplace.generate';

const CFG = parseLaplaceConfig(structuredClone(card.stages.find((s) => s.id === 'fill-pump')!.config));

describe('Laplace: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) G = 0,8(s + 2)/((s + 0,5)(s + 2,5)), U = 3: y(∞) = 3·0,8·2/1,25 = 3,84; y′(0⁺) = 3·0,8 = 2,4', () => {
    const g = { K: 0.8, z: 2, p1: 0.5, p2: 2.5 };
    expect(finalValue(g, 3)).toBeCloseTo(3.84, 12);
    expect(initialSlope(g, 3)).toBeCloseTo(2.4, 12);
  });

  it('2) G = 1,2(s + 0,3)/((s + 0,4)(s + 1,5)), U = 5: y(∞) = 5·1,2·0,3/0,6 = 3; y′(0⁺) = 6', () => {
    const g = { K: 1.2, z: 0.3, p1: 0.4, p2: 1.5 };
    expect(finalValue(g, 5)).toBeCloseTo(3, 12);
    expect(initialSlope(g, 5)).toBeCloseTo(6, 12);
  });

  it('3) bağımsız yol: RK4 benzetimi iki teoremi de verir', () => {
    const g = { K: 0.8, z: 2, p1: 0.5, p2: 2.5 };
    const m = measuredBySimulation(g, 3);
    expect(m.final).toBeCloseTo(3.84, 4);
    expect(m.slope).toBeCloseTo(2.4, 3);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: teoremler benzetimle uyuşur, hatalar doğru cevaptan ayrışır', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateLaplace(CFG, seed);
      expect(verifyLaplace(p), `tohum ${seed}`).toEqual([]);
      expect(classifyLaplace(p, { final: p.final, slope: p.slope })).toBe('success');
      for (const m of p.mistakes) {
        const a = m.quantity === 'final' ? { final: m.value, slope: p.slope } : { final: p.final, slope: m.value };
        expect(classifyLaplace(p, a), `tohum ${seed}: ${m.text}`).not.toBe('success');
        expect(Math.abs(m.value / (m.quantity === 'final' ? p.final : p.slope) - 1)).toBeGreaterThanOrEqual(MISTAKE_MARGIN * p.tolerance);
      }
    }
  }, 120_000);

  it('sonuç: son değer fazlaysa çarpma, azsa geç; eğim yanlışsa sensör hatası', () => {
    const p = generateLaplace(CFG, 3);
    expect(classifyLaplace(p, { final: p.final * 1.3, slope: p.slope })).toBe('valve_slam');
    expect(classifyLaplace(p, { final: p.final * 0.7, slope: p.slope })).toBe('valve_late');
    expect(classifyLaplace(p, { final: p.final, slope: p.slope * 2 })).toBe('sensor_misread');
    expect(classifyLaplace(p, { final: p.final * 1.03, slope: p.slope * 0.97 })).toBe('success');
  });

  it('rapor: iki teorem adımı ve benzetim grafiği; olası hata tanınır', () => {
    const p = generateLaplace(CFG, 11);
    const a = { final: p.mistakes[0].value, slope: p.slope };
    const r = buildLaplaceReport('fill-pump', p, a, resolveLaplaceOutcome(p, a));
    expect(r.success).toBe(false);
    expect(r.steps.join(' ')).toContain('Son değer teoremi');
    expect(r.steps.join(' ')).toContain('Olası hata');
    expect(r.plot!.series[0].points.length).toBeGreaterThan(100);
  });
});
