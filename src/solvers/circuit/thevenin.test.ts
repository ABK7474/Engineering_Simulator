import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/power-bus-01.json';
import { parseQuantity } from '../../puzzles/numeric-entry/parse';
import { SHOWN_REL_ERROR, shown } from './design-core';
import { closedForm, mistakeValue, parseTheveninConfig, realLoadCurrent, solveEquivalent, type TheveninNetwork } from './thevenin';
import { generateThevenin, verifyThevenin, type TheveninProblem } from './thevenin.generate';
import { classifyThevenin, expected, resolveTheveninOutcome } from './thevenin.outcomes';
import { buildTheveninReport } from './thevenin.report';

const CFG = parseTheveninConfig(structuredClone(card.stages[0].config));
const net = (id: string) => CFG.networks.find((n) => n.id === id) as TheveninNetwork;

// ---------------------------------------------------------------- elle kontrol edilecek örnekler
describe('Thevenin: elle kontrol edilebilir örnekler (beklenenler sabit sayı)', () => {
  it('1) kaynak + akım kaynağı: V₁ = 12 V, R₁ = R₂ = 100 Ω, R₃ = 100 Ω, I₁ = 20 mA → R_th = 150 Ω, V_th = 7 V', () => {
    // R_th = R₃ + R₁∥R₂ = 100 + 50 = 150 · V_th = (12/100 + 0,02)·50 = 0,14·50 = 7
    const p = { V1: 12, R1: 100, R2: 100, R3: 100, Is: 0.02, RL: 150 };
    const eq = solveEquivalent(net('source-plus-current'), p);
    expect(eq.rth).toBeCloseTo(150, 9);
    expect(eq.vth).toBeCloseTo(7, 9);
    expect(eq.isc).toBeCloseTo(7 / 150, 9); // Norton: 46,7 mA
    expect(realLoadCurrent(net('source-plus-current'), p)).toBeCloseTo(7 / 300, 9); // 23,3 mA, R_L = 150 Ω
    // Klasik hatalar: akım kaynağı kısa → R_th = R₃ = 100; gerilim kaynağı açık → R₃ + R₂ = 200; yük takılıyken V = 3,5 V
    expect(mistakeValue(net('source-plus-current'), p, 'shortI')!.value).toBeCloseTo(100, 9);
    expect(mistakeValue(net('source-plus-current'), p, 'openV')!.value).toBeCloseTo(200, 9);
    expect(mistakeValue(net('source-plus-current'), p, 'withLoad')!.value).toBeCloseTo(3.5, 9);
  });

  it('2) köprü: V₁ = 12 V, R₁ = 100, R₂ = 200, R₃ = 200, R₄ = 100 Ω → V_th = 8 − 4 = 4 V, R_th = 66,7 + 66,7 = 133,3 Ω', () => {
    const p = { V1: 12, R1: 100, R2: 200, R3: 200, R4: 100, RL: 470 };
    const eq = solveEquivalent(net('bridge'), p);
    expect(eq.vth).toBeCloseTo(4, 9);
    expect(eq.rth).toBeCloseTo(400 / 3, 9);
    expect(eq.isc).toBeCloseTo(0.03, 9); // 4 / 133,3 = 30 mA
  });

  it('3) iki kaynak: V₁ = 12 V, V₂ = 6 V, R₁ = R₂ = R₃ = 100 Ω → R_th = 33,3 Ω, V_th = 6 V', () => {
    // R_th = 100 ∥ 100 ∥ 100 · V_th = (12/100 + 6/100)·33,3 = 0,18·33,3 = 6
    const p = { V1: 12, V2: 6, R1: 100, R2: 100, R3: 100, RL: 100 };
    const eq = solveEquivalent(net('two-sources'), p);
    expect(eq.rth).toBeCloseTo(100 / 3, 9);
    expect(eq.vth).toBeCloseTo(6, 9);
    expect(mistakeValue(net('two-sources'), p, 'openV')!.value).toBeCloseTo(100, 9); // iki kaynak açık → yalnız R₃
    expect(mistakeValue(net('two-sources'), p, 'shortI')).toBeNull(); // akım kaynağı yok
  });

  it('kapalı form ifadeleri MNA ile aynı (iki bağımsız yol)', () => {
    for (const [id, p] of [
      ['source-plus-current', { V1: 24, R1: 330, R2: 470, R3: 68, Is: 0.05, RL: 220 }],
      ['bridge', { V1: 36, R1: 1000, R2: 2200, R3: 470, R4: 680, RL: 1000 }],
      ['two-sources', { V1: 24, V2: 15, R1: 220, R2: 560, R3: 820, RL: 330 }],
    ] as const) {
      const eq = solveEquivalent(net(id), p);
      const cf = closedForm(net(id), p);
      expect(cf.vth).toBeCloseTo(eq.vth, 9);
      expect(cf.rth).toBeCloseTo(eq.rth, 9);
    }
  });
});

// ---------------------------------------------------------------- giriş ve tolerans
describe('birimli giriş ve tolerans', () => {
  it('"2,2k", "2200", "2.2 kΩ", "2,2 kohm" aynı değer; yanlış birim ve anlamsız yazım reddedilir', () => {
    for (const t of ['2,2k', '2200', '2.2 kΩ', '2,2 kohm', ' 2.2k ', '2200Ω']) expect(parseQuantity(t, 'Ω')).toBeCloseTo(2200, 9);
    expect(parseQuantity('12,5', 'V')).toBe(12.5);
    expect(parseQuantity('12.5 V', 'V')).toBe(12.5);
    for (const t of ['250m', '250mA', '0,25 A', '0.25']) expect(parseQuantity(t, 'A')).toBeCloseTo(0.25, 12);
    expect(parseQuantity('1,2M', 'Ω')).toBeCloseTo(1.2e6, 6);
    expect(parseQuantity('2,2 V', 'Ω')).toBeNull();
    expect(parseQuantity('iki', 'V')).toBeNull();
    expect(parseQuantity('2k2', 'Ω')).toBeNull();
  });

  const problem = generateThevenin(CFG, 5);
  it('doğru değer, 3 basamağa yuvarlanmış hâli ve yazım biçimi fark etmeksizin kabul', () => {
    const e = expected(problem);
    expect(classifyThevenin(problem, e)).toBe('success');
    expect(classifyThevenin(problem, { a: shown(e.a), b: shown(e.b) })).toBe('success');
    const typed = { a: parseQuantity(String(shown(e.a)).replace('.', ','), 'V')!, b: parseQuantity(`${shown(e.b / 1000)}k`, 'Ω')! };
    expect(classifyThevenin(problem, typed)).toBe('success');
  });

  it('tolerans yuvarlama yayılımını kapsar: herhangi bir değer ±%0,5 oynasa da (3 basamak) cevap kabul edilir', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = generateThevenin(CFG, seed);
      expect(p.spread).toBeLessThanOrEqual(p.tolerance);
      for (const k of Object.keys(p.network.params).filter((x) => x !== p.network.load))
        for (const s of [-1, 1]) {
          const eq = solveEquivalent(p.network, { ...p.params, [k]: p.params[k] * (1 + s * SHOWN_REL_ERROR) });
          const ans = p.form === 'thevenin' ? { a: shown(eq.vth), b: shown(eq.rth) } : { a: shown(eq.isc), b: shown(eq.rth) };
          expect(classifyThevenin(p, ans), `tohum ${seed}, ${k}`).toBe('success');
        }
    }
  });
});

// ---------------------------------------------------------------- üretim, tek anlamlılık, sonuçlar
describe('üretici, doğrulayıcı ve sonuçlar', () => {
  it('1000 tohumda: iki yol uyuşur, klasik hatalar ≥ 3×tolerans uzakta ve kabul edilmez', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateThevenin(CFG, seed);
      expect(verifyThevenin(CFG, p), `tohum ${seed}`).toEqual([]);
      seen.add(p.network.id);
      for (const m of p.mistakes) {
        const ans = m.quantity === 'Vth' ? { a: m.value, b: p.eq.rth } : { a: p.eq.vth, b: m.value };
        expect(classifyThevenin(p, ans), `tohum ${seed}, ${m.kind}`).not.toBe('success');
      }
    }
    expect(seen.size).toBe(CFG.networks.length);
  }, 60_000);

  it('Norton biçimi: I_N ve R_N istenir; V_th girilirse kabul edilmez', () => {
    const p = generateThevenin({ ...CFG, form: 'norton' }, 9);
    expect(classifyThevenin(p, { a: p.eq.isc, b: p.eq.rth })).toBe('success');
    expect(classifyThevenin(p, { a: p.eq.vth, b: p.eq.rth })).not.toBe('success');
  });

  it('fizik: az akım motoru durdurur/zayıflatır, fazla akım ısıtır/yakar; birbirini götüren hata boşta gerilimde yakalanır', () => {
    const p: TheveninProblem = { ...generateThevenin(CFG, 2) };
    const { vth, rth } = p.eq;
    expect(classifyThevenin(p, { a: vth * 0.3, b: rth })).toBe('motor_stall');
    expect(classifyThevenin(p, { a: vth * 0.9, b: rth })).toBe('motor_slow');
    expect(classifyThevenin(p, { a: vth * 1.2, b: rth })).toBe('motor_overheat');
    expect(classifyThevenin(p, { a: vth * 2, b: rth })).toBe('motor_burnt');
    // Aynı yük akımını veren ama V_th'si %20 yüksek eşdeğer: R' = 1,2·V_th / I − R_L
    const i = p.iLoad;
    expect(classifyThevenin(p, { a: vth * 1.2, b: (vth * 1.2) / i - p.rl })).toBe('fuse_blown');
  });

  it('rapor: adım adım hesap ve klasik hata açıklaması', () => {
    const p = generateThevenin(CFG, 4);
    const m = p.mistakes.find((x) => x.quantity === 'Rth')!;
    const ans = { a: p.eq.vth, b: m.value };
    const r = buildTheveninReport('bus-equivalent', p, ans, resolveTheveninOutcome(p, ans));
    expect(r.success).toBe(false);
    expect(r.steps.join(' ')).toContain('Olası hata');
    expect(r.steps.length).toBeGreaterThanOrEqual(p.network.steps.length + 2);
  });
});
