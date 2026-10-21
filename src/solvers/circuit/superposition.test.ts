import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/generator-sync-01.json';
import { closedForm, contribution, decompose, parseSuperConfig, response, type SuperNetwork } from './superposition';
import { generateSuper, verifySuper } from './superposition.generate';
import { buildSuperReport, classifySuper, resolveSuperOutcome } from './superposition.outcomes';

const CFG = parseSuperConfig(structuredClone(card.stages[0].config));
const net = (id: string) => CFG.networks.find((n) => n.id === id) as SuperNetwork;

describe('süperpozisyon: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) iki gerilim kaynağı: V₁ = 12 V, V₂ = 6 V, R₁ = R₂ = R₃ = 100 Ω → I₃ = 60 mA = 40 mA (V₁) + 20 mA (V₂)', () => {
    // G = 0,03 S · I₃′ = 12 / (100·0,03·100) = 0,04 A · I₃″ = 6 / 300 = 0,02 A
    const p = { V1: 12, V2: 6, R1: 100, R2: 100, R3: 100 };
    expect(response(net('two-generators'), p)).toBeCloseTo(0.06, 12);
    expect(contribution(net('two-generators'), p, 'V1')).toBeCloseTo(0.04, 12);
    expect(contribution(net('two-generators'), p, 'V2')).toBeCloseTo(0.02, 12);
    // Ters: ölçülen 60 mA'den V₂ = (0,06 − 0,04) / (1/300) = 6 V
    expect(closedForm(net('two-generators'), { V1: 12, R1: 100, R2: 100, R3: 100, M: 0.06 }).value).toBeCloseTo(6, 9);
  });

  it('2) akü + akım kaynağı: V₁ = 12 V, R₁ = R₂ = 100 Ω, I₁ = 20 mA → V_a = 6 V + 1 V = 7 V; ters: I₁ = (7 − 6) / 50 = 20 mA', () => {
    const p = { V1: 12, R1: 100, R2: 100, Is: 0.02 };
    expect(response(net('battery-and-charger'), p)).toBeCloseTo(7, 12);
    expect(contribution(net('battery-and-charger'), p, 'V1')).toBeCloseTo(6, 12);
    expect(contribution(net('battery-and-charger'), p, 'Is')).toBeCloseTo(1, 12);
    expect(closedForm(net('battery-and-charger'), { V1: 12, R1: 100, R2: 100, M: 7 }).value).toBeCloseTo(0.02, 12);
  });

  it('3) klasik hatalar örnek 1 için: bilinen katkı unutulursa V₂ = 0,06 · 300 = 18 V; işaret ters alınırsa (0,06 + 0,04) · 300 = 30 V', () => {
    const p = { V1: 12, V2: 6, R1: 100, R2: 100, R3: 100 };
    const { known, perUnit } = decompose(net('two-generators'), p);
    expect(known).toBeCloseTo(0.04, 12);
    expect(perUnit).toBeCloseTo(1 / 300, 12);
    expect(0.06 / perUnit).toBeCloseTo(18, 9);
    expect((0.06 + known) / perUnit).toBeCloseTo(30, 9);
  });

  it('4) yanlış sıfırlama: akım kaynağı kısa sayılırsa a düğümü toprağa iner, V₁ katkısı 0 V olur (doğrusu 6 V)', () => {
    expect(contribution(net('battery-and-charger'), { V1: 12, R1: 100, R2: 100, Is: 0.02 }, 'V1', 'shortI')).toBeCloseTo(0, 12);
  });
});

describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: doğrusallık, kapalı form = MNA, yuvarlama yayılımı tolerans içinde, klasik hatalar kabul edilmez', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateSuper(CFG, seed);
      expect(verifySuper(p), `tohum ${seed}`).toEqual([]);
      seen.add(p.network.id);
      expect(classifySuper(p, p.answer).kind).toBe('success');
      expect(classifySuper(p, closedForm(p.network, p.visible).value).kind, `tohum ${seed} elle çözüm`).toBe('success');
      for (const m of p.mistakes) expect(classifySuper(p, m.value).kind, `tohum ${seed} ${m.kind}`).not.toBe('success');
    }
    expect(seen.size).toBe(CFG.networks.length);
  }, 60_000);

  it('fizik: az değer pompayı zayıflatır, çok fazlası yakar; rapor adımları ve hata açıklaması', () => {
    const p = generateSuper(CFG, 3);
    const low = classifySuper(p, p.answer * 0.8);
    expect(['motor_slow', 'motor_stall']).toContain(low.kind);
    const m = p.mistakes[0];
    const r = buildSuperReport('generator-setpoint', p, m.value, resolveSuperOutcome(p, m.value));
    expect(r.success).toBe(false);
    expect(r.steps.join(' ')).toContain('Olası hata');
    expect(r.steps.length).toBeGreaterThanOrEqual(p.network.steps.length + 1);
  });
});
