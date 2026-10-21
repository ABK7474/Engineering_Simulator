import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/sonar-frontend-01.json';
import { angleDiff, parsePhasorConfig, sumBySampling, sumPhasor } from './phasor';
import { accepted, buildPhasorReport, generatePhasor, resolvePhasorOutcome, verifyPhasor } from './phasor.generate';

const CFG = parsePhasorConfig(structuredClone(card.stages.find((s) => s.id === 'sonar-beam')!.config));

describe('fazör: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) 30∠0° + 40∠90° = 30 + 40j = 50∠53,13°', () => {
    const s = sumPhasor({ a: 30, phi: 0 }, { a: 40, phi: 90 });
    expect(s.a).toBeCloseTo(50, 10);
    expect(s.phi).toBeCloseTo(53.1301, 3);
  });

  it('2) 50∠0° + 50∠120° = 25 + 43,30j = 50∠60°', () => {
    const s = sumPhasor({ a: 50, phi: 0 }, { a: 50, phi: 120 });
    expect(s.a).toBeCloseTo(50, 10);
    expect(s.phi).toBeCloseTo(60, 10);
  });

  it('3) 60∠−90° + 80∠180° = −80 − 60j = 100∠−143,13°', () => {
    const s = sumPhasor({ a: 60, phi: -90 }, { a: 80, phi: 180 });
    expect(s.a).toBeCloseTo(100, 10);
    expect(s.phi).toBeCloseTo(-143.1301, 3);
  });

  it('4) bağımsız yol: örneklemeyle bulunan tepe ve faz aynı', () => {
    const s = sumBySampling({ a: 60, phi: -90 }, { a: 80, phi: 180 });
    expect(s.a).toBeCloseTo(100, 4);
    expect(angleDiff(s.phi, -143.1301)).toBeLessThan(0.01);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: doğrulanır, klasik hatalar kabul edilmez', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generatePhasor(CFG, seed);
      expect(verifyPhasor(p), `tohum ${seed}`).toEqual([]);
      expect(accepted(p, p.sum)).toBe(true);
      for (const m of p.mistakes) expect(accepted(p, m), `tohum ${seed}: ${m.text}`).toBe(false);
    }
  }, 240_000);

  it('rapor: karmaşık toplam adımları; yanlış cevapta sensör hatası', () => {
    const p = generatePhasor(CFG, 5);
    const x = { a: p.mistakes[0].a, phi: p.mistakes[0].phi };
    const o = resolvePhasorOutcome(p, x);
    expect(o.kind).toBe('sensor_misread');
    const r = buildPhasorReport('sonar-beam', p, x, o);
    expect(r.steps.join(' ')).toContain('atan2');
    expect(r.steps.join(' ')).toContain('Olası hata');
  });
});
