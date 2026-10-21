import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/sonar-frontend-01.json';
import { cutoff, cutoffBounds, gainClosed, gainComplex, parseFilterConfig, resistorFor, toDb } from './filter';
import { generateFilter, meets, verifyFilter } from './filter.generate';
import { buildFilterReport, classifyFilter, resolveFilterOutcome } from './filter.outcomes';

const CFG = parseFilterConfig(structuredClone(card.stages[0].config));
const RC = { kind: 'rc' as const, part: 100e-9 };
const RL = { kind: 'rl' as const, part: 10e-3 };

describe('filtre: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) RC: R = 1 kΩ, C = 100 nF → f_c = 1591,55 Hz; kesimde −3,01 dB; 10 kHz\'de |H| = 0,15718 (−16,07 dB)', () => {
    expect(cutoff(RC, 1000)).toBeCloseTo(1591.5494, 3);
    expect(toDb(gainClosed(cutoff(RC, 1000), cutoff(RC, 1000)))).toBeCloseTo(-3.0103, 4);
    expect(gainClosed(cutoff(RC, 1000), 10_000)).toBeCloseTo(0.1571767, 6);
    expect(toDb(gainClosed(cutoff(RC, 1000), 10_000))).toBeCloseTo(-16.0722, 3);
    // Bağımsız yol: karmaşık empedans bölücüsü aynı sonucu verir
    expect(gainComplex(RC, 1000, 10_000)).toBeCloseTo(0.1571767, 6);
  });

  it('2) RL: L = 10 mH, R = 100 Ω → f_c = R/(2πL) = 1591,55 Hz (RC ile aynı); karmaşık yol aynı', () => {
    expect(cutoff(RL, 100)).toBeCloseTo(1591.5494, 3);
    expect(gainComplex(RL, 100, 10_000)).toBeCloseTo(gainClosed(cutoff(RL, 100), 10_000), 12);
  });

  it('3) ters: 500 Hz ≥ −0,5 dB ve 10 kHz ≤ −15 dB → 1431,4 Hz ≤ f_c ≤ 1807,1 Hz → C = 100 nF ile 880,7 Ω ≤ R ≤ 1111,9 Ω (yalnız 1 kΩ)', () => {
    const [lo, hi] = cutoffBounds(500, -0.5, 10_000, -15);
    expect(lo).toBeCloseTo(1431.388, 2);
    expect(hi).toBeCloseTo(1807.081, 2);
    expect(resistorFor(RC, hi)).toBeCloseTo(880.729, 2);
    expect(resistorFor(RC, lo)).toBeCloseTo(1111.893, 2);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: iki şartı birlikte sağlayan tek aday, bitişik E12 sağlamıyor, iki yol uyuşuyor', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateFilter(CFG, seed);
      expect(verifyFilter(CFG, p), `tohum ${seed}`).toEqual([]);
      kinds.add(p.parts.kind);
      expect(p.bin.filter((b) => classifyFilter(p, b.r) === 'success').map((b) => b.r)).toEqual([p.answer]);
    }
    expect(kinds).toEqual(new Set(['rc', 'rl']));
  }, 60_000);

  it('fizik ve rapor: düşük kesim sinyali boğar, yüksek kesim gürültüyü geçirir; tablo ve adımlar', () => {
    const p = generateFilter({ ...CFG, kinds: ['rc'] }, 4);
    const sorted = [...p.bin].sort((a, b) => a.r - b.r);
    // RC: büyük R → düşük kesim → sinyal zayıf; küçük R → yüksek kesim → gürültü geçer
    expect(classifyFilter(p, sorted[sorted.length - 1].r)).toBe('signal_weak');
    expect(classifyFilter(p, sorted[0].r)).toBe('sensor_misread');
    expect(meets(p, p.answer)).toMatchObject({ signal: true, noise: true });
    const wrong = p.bin.find((b) => b.mistake)!;
    const r = buildFilterReport('sonar-filter', p, wrong.id, resolveFilterOutcome(p, wrong.id));
    expect(r.table!.rows).toHaveLength(p.bin.length);
    expect(r.steps.join(' ')).toContain('Olası hata');
  });
});
