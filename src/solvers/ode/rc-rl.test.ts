import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/airlock-valve-01.json';
import { e12Values } from '../circuit/e-series';
import { firstCrossing } from './ode';
import { crossingClosed, crossingRk4, parseRcRlConfig, type Params } from './rc-rl';
import { generateRcRl, verifyRcRl } from './rc-rl.generate';
import { classifyRcRl, resolveRcRlOutcome } from './rc-rl.outcomes';
import { buildRcRlReport } from './rc-rl.report';

const CFG = parseRcRlConfig(structuredClone(card.stages[1].config));
const RC: Params = { kind: 'rc', vs: 12, c: 22e-6, v0: 2.4, vth: 9.6 };
const RL: Params = { kind: 'rl', vs: 12, l: 0.22, i0: 0, ith: 0.08 };

// ---------------------------------------------------------------- elle kontrol edilecek örnekler
describe('RC/RL: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) RC: Vs = 12 V, V₀ = 2,4 V, eşik 9,6 V, C = 22 µF, R = 1,5 kΩ → τ = 33 ms, t = 33 ms · ln 4 = 45,75 ms', () => {
    // ln((12 − 2,4)/(12 − 9,6)) = ln(9,6/2,4) = ln 4 = 1,3863
    expect(crossingClosed(RC, 1500)).toBeCloseTo(0.033 * Math.log(4), 12);
    expect(crossingClosed(RC, 1500)).toBeCloseTo(0.045748, 6);
    expect(crossingRk4(RC, 1500)! / crossingClosed(RC, 1500)! - 1).toBeLessThan(1e-6);
  });

  it('2) ön yük unutulursa: ln(12/2,4) = ln 5 → t = 33 ms · 1,6094 = 53,11 ms (yanlış)', () => {
    expect(crossingClosed({ ...RC, v0: 0 }, 1500)).toBeCloseTo(0.033 * Math.log(5), 12);
    expect(crossingClosed({ ...RC, v0: 0 }, 1500)).toBeCloseTo(0.0531115, 6);
  });

  it('3) RL: Vs = 12 V, L = 220 mH, R = 68 Ω, çekme 80 mA → I∞ = 176,5 mA, τ = 3,235 ms, t = τ · ln(1,8293) = 1,954 ms', () => {
    // I∞ = 12/68 = 0,17647 · ln(0,17647/(0,17647 − 0,08)) = 0,60392
    expect(crossingClosed(RL, 68)).toBeCloseTo((0.22 / 68) * Math.log(12 / 68 / (12 / 68 - 0.08)), 12);
    expect(crossingClosed(RL, 68)).toBeCloseTo(0.0019539, 6);
    expect(Math.abs(crossingRk4(RL, 68)! / crossingClosed(RL, 68)! - 1)).toBeLessThan(1e-6);
  });

  it('4) RL: R = 220 Ω → I∞ = 54,5 mA < 80 mA, valf hiç ateşlemez (iki yöntem de)', () => {
    expect(crossingClosed(RL, 220)).toBeNull();
    expect(crossingRk4(RL, 220)).toBeNull();
  });

  it('RK4 eşik geçişi: dy/dt = 1 − y, y(0) = 0, eşik 0,5 → t = ln 2', () => {
    expect(firstCrossing((_t, y) => 1 - y, 0, 0.5, 1e-3, 10)).toBeCloseTo(Math.LN2, 6); // ara değer hatası ~6e-8
  });
});

// ---------------------------------------------------------------- pencere kuralı ve tek anlamlılık
describe('üretici: pencere bitişik E12 değerinin anını içermez, tek aday pencerede', () => {
  it('1000 tohumda: doğrulayıcı temiz; kapalı form ve RK4 uyuşur; cevabın komşu E12 değerleri pencere dışında', () => {
    const seen = new Set<string>();
    const all = e12Values();
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateRcRl(CFG, seed);
      expect(verifyRcRl(CFG, p), `tohum ${seed}`).toEqual([]);
      seen.add(p.kind);
      const k = all.indexOf(p.answer);
      for (const nb of [all[k - 1], all[k + 1]]) {
        const t = crossingClosed(p.params, nb);
        expect(t === null || t < p.tmin || t > p.tmax, `tohum ${seed}, komşu ${nb}`).toBe(true);
      }
      expect(p.bin.filter((b) => classifyRcRl(p, b.r) === 'success').map((b) => b.r)).toEqual([p.answer]);
    }
    expect(seen).toEqual(new Set(['rc', 'rl']));
  }, 120_000);

  it('koşul sağlanamazsa 200 denemeden sonra açıklamalı hata', () => {
    expect(() => generateRcRl({ ...CFG, kinds: ['rl'], answer: { ...CFG.answer, rl: [1000, 1200] } }, 1)).toThrow(/200 denemede doğrulanabilir problem yok.*En sık red nedenleri/);
  });

  it('sonuçlar ve rapor: erken → çarpar, geç → kaçak; raporda iki RK4 eğrisi, eşik ve pencere', () => {
    const p = generateRcRl({ ...CFG, kinds: ['rc'] }, 8);
    const small = p.bin.filter((b) => b.r < p.answer).sort((a, b) => b.r - a.r)[0];
    const big = p.bin.filter((b) => b.r > p.answer).sort((a, b) => a.r - b.r)[0];
    if (small) expect(classifyRcRl(p, small.r)).toBe('valve_slam'); // RC: küçük R → küçük τ → erken
    if (big) expect(classifyRcRl(p, big.r)).toBe('valve_late');
    const pick = (small ?? big)!;
    const r = buildRcRlReport('valve-timer', p, pick.id, resolveRcRlOutcome(p, pick.id));
    expect(r.plot!.series).toHaveLength(2);
    expect(r.plot!.window).toEqual([p.tmin, p.tmax]);
    expect(r.steps.join(' ')).toContain('RK4');
  });
});
