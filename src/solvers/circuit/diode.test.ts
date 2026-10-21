import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/generator-sync-01.json';
import { diodeCurrent, diodeVoltage, parseDiodeConfig, solveBisection, solveNewton, VT } from './diode';
import { generateDiode, handSolve, operatingCurrent, verifyDiode } from './diode.generate';
import { buildDiodeReport, classifyDiode, resolveDiodeOutcome } from './diode.outcomes';

const CFG = parseDiodeConfig(structuredClone(card.stages[1].config));
const A = { label: 'IR LED A', n: 1.6, is: 1e-12 };

describe('diyot: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) Shockley, n = 1,6, Iₛ = 1 pA: 20 mA → 0,98109 V, 2 mA → 0,88585 V; eğim n·V_T = 41,363 mV (ln 10 başına 95,24 mV)', () => {
    expect(diodeVoltage(A, 0.02)).toBeCloseTo(0.9810937, 6);
    expect(diodeVoltage(A, 0.002)).toBeCloseTo(0.8858514, 6);
    expect((diodeVoltage(A, 0.02) - diodeVoltage(A, 0.002)) / Math.LN10).toBeCloseTo(1.6 * VT, 9);
    expect(diodeCurrent(A, diodeVoltage(A, 0.01))).toBeCloseTo(0.01, 12); // ters fonksiyon tutarlı
  });

  it('2) devre: Vs = 5 V, R = 100 Ω → I = 39,903 mA, V_D = 1,00966 V (Newton ve ikiye bölme aynı)', () => {
    const nw = solveNewton(A, 5, 100);
    expect(nw.i).toBeCloseTo(0.0399034, 6);
    expect(nw.v).toBeCloseTo(1.0096644, 6);
    expect(solveBisection(A, 5, 100)).toBeCloseTo(nw.i, 10);
  });

  it('3) elle çözüm (gösterilen 3 basamakla): 0,981 V / 0,886 V → eğim 41,26 mV, I* = 39,9 mA → V_D = 1,0095 V, R = 100,01 Ω', () => {
    const h = handSolve([{ i: 0.02, v: 0.981 }, { i: 0.002, v: 0.886 }], 5, 0.0399);
    expect(h.slope).toBeCloseTo(0.041258, 5);
    expect(h.vd).toBeCloseTo(1.009495, 5);
    expect(h.r).toBeCloseTo(100.0127, 3);
    // Klasik hatalar: sabit 0,7 V → 107,8 Ω; düşüm unutulursa 5 / 0,0399 = 125,3 Ω
    expect((5 - 0.7) / 0.0399).toBeCloseTo(107.769, 2);
    expect(5 / 0.0399).toBeCloseTo(125.313, 2);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: kutuda pencereye düşen tek değer, bitişik E12 dışarıda, Newton = ikiye bölme, elle çözüm cevaba varır', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateDiode(CFG, seed);
      expect(verifyDiode(CFG, p), `tohum ${seed}`).toEqual([]);
      expect(p.bin.filter((b) => classifyDiode(p, b.r) === 'success').map((b) => b.r)).toEqual([p.answer]);
    }
  }, 60_000);

  it('fizik ve rapor: küçük direnç LED\'i zorlar, büyük direnç söndürür; rapor eğim ve V_D adımlarını içerir', () => {
    const p = generateDiode(CFG, 5);
    const sorted = [...p.bin].sort((a, b) => a.r - b.r);
    expect(['led_stressed', 'led_burnt']).toContain(classifyDiode(p, sorted[0].r));
    expect(['dim', 'no_light']).toContain(classifyDiode(p, sorted[sorted.length - 1].r));
    const wrong = p.bin.find((b) => b.mistake)!;
    const r = buildDiodeReport('rotation-sensor', p, wrong.id, resolveDiodeOutcome(p, wrong.id));
    expect(r.steps[0]).toContain('n·V_T');
    expect(r.steps.join(' ')).toContain('Olası hata');
    expect(operatingCurrent(p, p.answer)).toBeGreaterThan(0);
  });
});
