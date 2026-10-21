import { describe, expect, it } from 'vitest';
import fault from '../../../content/faults/door-power-01.json';
import { createRng } from '../../core/rng';
import { e12Values } from './e-series';
import {
  classify,
  derivedScope,
  measure,
  parseSeriesParallelConfig,
  readingFor,
  slotIds,
  solveWith,
  type Reading,
} from './series-parallel';
import { generateSeriesParallel, MAX_ATTEMPTS, type SpProblem } from './series-parallel.generate';
import { evaluatePlacement, outcomePool } from './series-parallel.outcomes';
import { buildSeriesParallelReport } from './series-parallel.report';
import { placements, verifySeriesParallel } from './series-parallel.verify';

const raw = fault.stages[1].config;
const C = parseSeriesParallelConfig(raw);
const placementFor = (p: SpProblem, values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).map(([s, r]) => [s, p.bin.find((b) => b.r === r)!.id]));

describe('içerik yapılandırması', () => {
  it('kapı arızasının 2. aşaması geçerli; iki yuva var', () => {
    expect(slotIds(C)).toEqual(['R1', 'R2']);
  });

  it('içerikteki hataları açıklamalı reddeder', () => {
    const bad = (patch: object) => () => parseSeriesParallelConfig({ ...raw, ...patch });
    expect(bad({ derived: { ...raw.derived, Va: 'Im*Rx' } })).toThrow(/bilinmeyen 'Rx'/);
    expect(bad({ steps: ['{Yok:V}'] })).toThrow(/bilinmeyen '\{Yok\}'/);
    expect(bad({ answer: { R1: [1, 10] } })).toThrow(/R2/);
    expect(bad({ roles: { load: 'Im', supply: 'Q' } })).toThrow(/roller/);
    expect(bad({ binSize: 3 })).toThrow(/kutu/);
    // Gizli parametre doğrudan çözüm zincirinde kullanılamaz (oyuncu onu görmez)
    expect(bad({ derived: { ...raw.derived, Va: 'Im*Rm' } })).toThrow(/bilinmeyen 'Rm'/);
  });
});

describe('elle çözülmüş örnek (sabit sayılar)', () => {
  // 24 V, motor 24 Ω, eski R₁ 24 Ω, R₂ sökülü → V_ölç = 24·24/48 = 12 V.
  // Cevap R₁ = 12 Ω, R₂ = 24 Ω → motor ∥ R₂ = 12 Ω, I_s = 24/24 = 1 A, V_a = 12 V, I_m = 0,5 A.
  const params = { Vs: 24, Rm: 24, Rold: 24 };

  it('ölçüm senaryosu: V_ölç = 12 V', () => {
    expect(measure(C, params)).toBeCloseTo(12, 9);
  });

  it('hedefler: I_m = 0,5 A, I_s = 1 A', () => {
    const r = readingFor(C, solveWith(C, params, { R1: 12, R2: 24 }), { Im: 0.5, Is: 1 });
    expect(r.load).toBeCloseTo(0.5, 9);
    expect(r.supply).toBeCloseTo(1, 9);
    // Hedefler tutuyor ama P(R₁) = 1²·12 = 12 W > 5 W anma gücü: direnç yanar.
    expect(r.slotPowerMax).toBeCloseTo(12, 9);
    expect(classify(r)).toBe('resistor_overheat');
  });

  it('yazılı çözüm zinciri: Rm = 24 Ω, V_a = 12 V, R₁ = 12 Ω, I₂ = 0,5 A, R₂ = 24 Ω', () => {
    const s = derivedScope(C, { Vs: 24, Rold: 24, Vmeas: 12, Im: 0.5, Is: 1 });
    expect(s.Rm_calc).toBeCloseTo(24, 9);
    expect(s.Va).toBeCloseTo(12, 9);
    expect(s.R1_calc).toBeCloseTo(12, 9);
    expect(s.I2).toBeCloseTo(0.5, 9);
    expect(s.R2_calc).toBeCloseTo(24, 9);
  });
});

describe('classify (fiziksel bölge)', () => {
  const base: Reading = { load: 0.5, supply: 1, loadTarget: 0.5, supplyTarget: 1, loadTol: 0.04, supplyTol: 0.04, slotPowerMax: 1, rating: 5 };
  it.each([
    [{}, 'ok'],
    [{ supply: 1.05 }, 'fuse'],
    [{ load: 0.2 }, 'stall'],
    [{ load: 0.45 }, 'slow'],
    [{ load: 0.6 }, 'over_mild'],
    [{ load: 0.8 }, 'over_severe'],
    [{ supply: 0.9 }, 'regulator_low'],
    [{ slotPowerMax: 6 }, 'resistor_overheat'],
  ] as const)('%o → %s', (patch, zone) => {
    expect(classify({ ...base, ...patch })).toBe(zone);
  });

  it('aşırı akımda yanma olasılığı akımla artar', () => {
    const pBurnt = (load: number) =>
      outcomePool('over_mild', { ...base, load }).find((e) => e.value === 'motor_burnt')!.weight;
    expect(pBurnt(0.55)).toBeLessThan(pBurnt(0.65));
    expect(pBurnt(0.65)).toBeLessThan(pBurnt(0.74));
  });
});

describe('üretici + doğrulayıcı', () => {
  it('1000 tohumun hepsinde doğrulanmış problem; cevap E12, tek çözüm, yer değiştirme yanlış', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateSeriesParallel(C, seed);
      expect(verifySeriesParallel(C, p)).toEqual({ ok: true, errors: [] });
      for (const s of slotIds(C)) expect(e12Values()).toContain(p.answer[s]);
      const swapped = { R1: p.answer.R2, R2: p.answer.R1 };
      const r = readingFor(C, solveWith(C, p.params, swapped), p.targets);
      expect(classify(r)).not.toBe('ok');
      for (const b of p.bin) if (b.mistake) expect(Object.values(p.answer)).not.toContain(b.r);
      // Doğru ikili fiziksel olarak da başarılı: her yuva direnci anma gücünün altında, sonuç 'success'.
      const right = solveWith(C, p.params, p.answer);
      for (const sl of slotIds(C)) expect(Math.abs(right.power[sl])).toBeLessThan(C.limits.slotRating_W);
      expect(evaluatePlacement(C, p, placementFor(p, p.answer), createRng(seed)).outcome.kind).toBe('success');
      // Gizli parametre oyuncuya gösterilmez
      expect(p.visible).not.toHaveProperty('Rm');
    }
  }, 60_000);

  it('üretim deterministik', () => {
    expect(generateSeriesParallel(C, 42)).toEqual(generateSeriesParallel(C, 42));
  });

  it('deneme sınırında açık hata verir (sonsuz döngü yok)', () => {
    const impossible = parseSeriesParallelConfig({ ...raw, plausible: { ...raw.plausible, load: [100, 200] } });
    expect(MAX_ATTEMPTS).toBe(200);
    expect(() => generateSeriesParallel(impossible, 1)).toThrow(/200 denemede doğrulanabilir problem bulunamadı/);
  });

  it('bozuk problemleri reddeder', () => {
    const p = generateSeriesParallel(C, 5);
    // Yanlış cevap işaretli
    const other = p.bin.find((b) => !Object.values(p.answer).includes(b.r))!;
    expect(verifySeriesParallel(C, { ...p, answer: { ...p.answer, R2: other.r } }).ok).toBe(false);
    // Gösterilen hedef değiştirilmiş
    expect(verifySeriesParallel(C, { ...p, targets: { ...p.targets, Im: p.targets.Im * 1.3 } }).ok).toBe(false);
    // Kutuda aynı değer iki kez
    expect(verifySeriesParallel(C, { ...p, bin: [...p.bin.slice(0, -1), { ...p.bin[0], id: 'x' }] }).ok).toBe(false);
  });

  it('placements: 6 kart, 2 yuva → 30 sıralı yerleşim', () => {
    expect(placements(['R1', 'R2'], ['a', 'b', 'c', 'd', 'e', 'f'])).toHaveLength(30);
  });
});

describe('sonuç ve rapor', () => {
  const p = generateSeriesParallel(C, 11);

  it('doğru yerleşim başarı; yer değiştirmiş yerleşim başarı değil', () => {
    expect(evaluatePlacement(C, p, placementFor(p, p.answer), createRng(1)).outcome.kind).toBe('success');
    const swapped = placementFor(p, { R1: p.answer.R2, R2: p.answer.R1 });
    expect(evaluatePlacement(C, p, swapped, createRng(1)).outcome.kind).not.toBe('success');
  });

  it('her yanlış yerleşim fiziksel bir hata sonucu üretir', () => {
    for (const pl of placements(slotIds(C), p.bin.map((b) => b.id))) {
      const ev = evaluatePlacement(C, p, pl, createRng(3));
      const isAnswer = slotIds(C).every((s) => ev.values[s] === p.answer[s]);
      expect(ev.outcome.kind === 'success').toBe(isAnswer);
      expect(ev.outcome.headline.length).toBeGreaterThan(0);
    }
  });

  it('rapor: hedefler, MNA ölçümleri, doğrusu ve adımlar; yer değiştirmede açıklama', () => {
    const swapped = placementFor(p, { R1: p.answer.R2, R2: p.answer.R1 });
    const ev = evaluatePlacement(C, p, swapped, createRng(1));
    const rep = buildSeriesParallelReport('motor-driver', C, p, swapped, ev, ev.outcome);
    expect(rep.success).toBe(false);
    expect(rep.facts.map((f) => f.label)).toContain('Motor akımı');
    expect(rep.steps).toHaveLength(C.steps.length + 1);
    expect(rep.steps.at(-1)).toMatch(/yuvalar karışmış/);
    expect(rep.correctLabel).toContain('R₁');
  });
});
