import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/blackout-01.json';
import { lampAt, lampAtRk4, parseLightDecayConfig, tau } from './light-decay';
import { buildLightDecayReport, classifyLightDecay, darkAt, generateLightDecay, resolveLightDecayOutcome, seesAt, verifyLightDecay } from './light-decay.generate';

const CFG = parseLightDecayConfig(structuredClone(card.stages[1].config));
const P = { v0: 24, c: 0.22, rl: 22 };

describe('acil aydınlatma: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) V₀ = 24 V, C = 0,22 F, R_L = 22 Ω, R = 33 Ω: τ = 55·0,22 = 12,1 s; V_L(0) = 24·22/55 = 9,6 V', () => {
    expect(tau(P, 33)).toBeCloseTo(12.1, 12);
    expect(lampAt(P, 33, 0)).toBeCloseTo(9.6, 12);
  });

  it('2) aynı devre: V_L(15 s) = 9,6·e^(−15/12,1) = 2,7790 V; V_L(36 s) = 0,48995 V', () => {
    expect(lampAt(P, 33, 15)).toBeCloseTo(2.779007, 5);
    expect(lampAt(P, 33, 36)).toBeCloseTo(0.489954, 5);
  });

  it('3) R = 47 Ω (τ = 15,18 s): başta daha sönük (7,652 V) ama 15 s\'de daha parlak (2,8487 V), 36 s\'de 0,71423 V', () => {
    expect(lampAt(P, 47, 0)).toBeCloseTo(7.652174, 5);
    expect(lampAt(P, 47, 15)).toBeCloseTo(2.848657, 5);
    expect(lampAt(P, 47, 36)).toBeCloseTo(0.714229, 5);
  });

  it('4) bağımsız yol: RK4 kapalı formla uyuşur', () => {
    for (const r of [4.7, 33, 100]) for (const t of [12, 45]) expect(lampAtRk4(P, r, t) / lampAt(P, r, t)).toBeCloseTo(1, 7);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: tek uygun aday; diğerleri bir şartı açık farkla bozar', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateLightDecay(CFG, seed);
      expect(verifyLightDecay(CFG, p), `tohum ${seed}`).toEqual([]);
      expect(p.bin.filter((b) => classifyLightDecay(p, b.r) === 'success').map((b) => b.r)).toEqual([p.answer]);
      expect(p.tWalk).toBeGreaterThan(tau(p.params, p.answer));
    }
  }, 120_000);

  it('sonuç yönü: büyük R varışta parlak (fark edilir), küçük R siperden önce söner', () => {
    const p = generateLightDecay(CFG, 4);
    const big = p.bin.filter((b) => b.r > p.answer);
    const small = p.bin.filter((b) => b.r < p.answer);
    for (const b of big) if (darkAt(p, b.r) > p.vDet) expect(classifyLightDecay(p, b.r)).toBe('creature_alerted');
    for (const b of small) if (seesAt(p, b.r) < p.vSee && darkAt(p, b.r) <= p.vDet) expect(classifyLightDecay(p, b.r)).toBe('dark_stumble');
  });

  it('rapor: iki şart, aday tablosu ve iki eğri', () => {
    const p = generateLightDecay(CFG, 9);
    const wrong = p.bin.find((b) => b.r !== p.answer)!;
    const r = buildLightDecayReport('emergency-light', p, wrong.id, resolveLightDecayOutcome(p, wrong.id));
    expect(r.success).toBe(false);
    expect(r.steps.join(' ')).toContain('τ = (R + R_L)·C');
    expect(r.table!.rows).toHaveLength(p.bin.length);
    expect(r.plot!.series).toHaveLength(2);
  });
});
