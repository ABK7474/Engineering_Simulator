import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/power-bus-01.json';
import { evalDerived } from './design-core';
import { ANSWER_ZONE, DECOY_MAX_RATIO, inDecoyZone, loadPower, loadVoltage, parseMaxPowerConfig, powerRatio, SUCCESS_RATIO } from './max-power';
import { generateMaxPower, verifyMaxPower, type MaxPowerProblem } from './max-power.generate';
import { classifyMaxPower, resolveMaxPowerOutcome } from './max-power.outcomes';
import { buildMaxPowerReport } from './max-power.report';

const CFG = parseMaxPowerConfig(structuredClone(card.stages[1].config));

// ---------------------------------------------------------------- elle kontrol edilecek örnek
describe('max-power: elle kontrol edilebilir örnek (beklenenler sabit sayı)', () => {
  it('kara kutu V_th = 12 V, R_th = 50 Ω: R₁ = 10 Ω → V₁ = 2 V, R₂ = 200 Ω → V₂ = 9,6 V', () => {
    // V = V_th·R / (R_th + R): 12·10/60 = 2 · 12·200/250 = 9,6
    expect(loadVoltage(12, 50, 10)).toBeCloseTo(2, 12);
    expect(loadVoltage(12, 50, 200)).toBeCloseTo(9.6, 12);
  });

  it('iki testten: I₁ = 0,2 A, I₂ = 0,048 A → R_th = 7,6 / 0,152 = 50 Ω, V_th = 2 + 0,2·50 = 12 V, P_max = 144 / 200 = 0,72 W', () => {
    const s = evalDerived(CFG.derived, { R1: 10, V1: 2, R2: 200, V2: 9.6 });
    expect(s.I1).toBeCloseTo(0.2, 12);
    expect(s.I2).toBeCloseTo(0.048, 12);
    expect(s.Rth_calc).toBeCloseTo(50, 9);
    expect(s.Vth_calc).toBeCloseTo(12, 9);
    expect(s.Pmax_calc).toBeCloseTo(0.72, 9);
  });

  it('güç oranı 4x/(1+x)²: R = 47 Ω (x = 0,94) %99,9; R = 100 Ω (x = 2) %88,9; R = 22 Ω (x = 0,44) %84,9', () => {
    expect(powerRatio(47 / 50)).toBeCloseTo(0.99904, 5);
    expect(powerRatio(2)).toBeCloseTo(8 / 9, 12);
    expect(powerRatio(0.44)).toBeCloseTo(0.84877, 5);
    expect(loadPower(12, 50, 47).p / 0.72).toBeCloseTo(powerRatio(0.94), 12);
    // Bölge sınırları: x = 0,58 ve 1,72'de ≤ %93; x = 0,75 ve 1,33'te ≈ %98
    expect(powerRatio(0.58)).toBeLessThanOrEqual(DECOY_MAX_RATIO);
    expect(powerRatio(1.72)).toBeLessThanOrEqual(DECOY_MAX_RATIO);
    expect(powerRatio(0.75)).toBeGreaterThan(SUCCESS_RATIO);
    expect(powerRatio(1.33)).toBeGreaterThan(SUCCESS_RATIO);
  });

  it('sonuçlar: 47 Ω başarı, 150 Ω verici zayıf, 5,6 Ω sigorta (akım 216 mA > 0,8·240 mA = 192 mA)', () => {
    const p: MaxPowerProblem = {
      seed: 0, vth: 12, rth: 50, visible: {}, scope: {}, logText: '', answer: 47, pmax: 0.72, fuseCurrent: 0.192,
      bin: [{ id: 'a', r: 47, label: '47 Ω' }, { id: 'b', r: 150, label: '150 Ω' }, { id: 'c', r: 5.6, label: '5,6 Ω' }],
    };
    expect(classifyMaxPower(p, 47)).toBe('success');
    expect(classifyMaxPower(p, 150)).toBe('signal_weak');
    expect(classifyMaxPower(p, 5.6)).toBe('fuse_blown');
    expect(resolveMaxPowerOutcome(p, 'c').explanation).toContain('216 mA');
  });
});

// ---------------------------------------------------------------- seyrek kutu ve tek anlamlılık
describe('üretici: seyrek kutu, tek doğru aday, tuzaklar dış bölgede', () => {
  it('1000 tohumda: değerler arası ≥ 1,8 kat, cevap x ∈ [0,75; 1,33], diğerleri x < 0,58 ya da x > 1,72 ve ≤ %93', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateMaxPower(CFG, seed);
      expect(verifyMaxPower(CFG, p), `tohum ${seed}`).toEqual([]);
      const rs = p.bin.map((b) => b.r).sort((a, b) => a - b);
      for (let k = 1; k < rs.length; k++) expect(rs[k] / rs[k - 1]).toBeGreaterThanOrEqual(1.8);
      const ax = p.answer / p.rth;
      expect(ax).toBeGreaterThanOrEqual(ANSWER_ZONE[0]);
      expect(ax).toBeLessThanOrEqual(ANSWER_ZONE[1]);
      const ok = p.bin.filter((b) => classifyMaxPower(p, b.r) === 'success');
      expect(ok.map((b) => b.r)).toEqual([p.answer]);
      for (const b of p.bin.filter((b) => b.r !== p.answer)) {
        expect(inDecoyZone(b.r / p.rth)).toBe(true);
        expect(loadPower(p.vth, p.rth, b.r).p / p.pmax).toBeLessThanOrEqual(DECOY_MAX_RATIO);
      }
      expect(p.bin.filter((b) => b.decoy).length).toBeGreaterThanOrEqual(2);
      expect(p.bin.some((b) => b.r === p.visible.R1 && b.decoy)).toBe(true);
    }
  }, 60_000);

  it('koşul sağlanamazsa 200 denemeden sonra açıklamalı hata', () => {
    expect(() => generateMaxPower({ ...CFG, binSize: 7, rth: [22, 23], testR: [22, 27] }, 1)).toThrow(/200 denemede doğrulanabilir problem yok.*En sık red nedenleri/);
  });

  it('rapor: kutudaki her yükün güç oranı tablosu, doğru satır işaretli', () => {
    const p = generateMaxPower(CFG, 3);
    const wrong = p.bin.find((b) => b.r !== p.answer)!;
    const r = buildMaxPowerReport('bus-transmitter', CFG, p, wrong.id, resolveMaxPowerOutcome(p, wrong.id));
    expect(r.table!.rows).toHaveLength(CFG.binSize);
    expect(r.table!.rows[r.table!.good!][0]).toBe(p.bin.find((b) => b.r === p.answer)!.label);
    expect(r.steps.join(' ')).toContain('R_th = (V₂ − V₁) / (I₁ − I₂)');
  });
});
