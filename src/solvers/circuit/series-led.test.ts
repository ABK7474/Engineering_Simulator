import { describe, expect, it } from 'vitest';
import fault from '../../../content/faults/door-power-01.json';
import { createRng } from '../../core/rng';
import { e12Values } from './e-series';
import {
  classify,
  parseSeriesLedConfig,
  solveSeriesLed,
  type SeriesLedSpec,
} from './series-led';
import { generateSeriesLed } from './series-led.generate';
import { outcomePool, resolveOutcome } from './series-led.outcomes';
import { buildSeriesLedReport } from './series-led.report';
import { REQUIRED_ZONES, verifySeriesLed } from './series-led.verify';

const red = { kind: 'constant-vf', vf: 2.0 } as const;

const spec: SeriesLedSpec = {
  vs: 9,
  led: { color: 'kırmızı', model: red },
  targetMin: 0.01,
  targetMax: 0.02,
  absMax: 0.03,
  visibleMin: 0.001,
  fuse: 0.2,
  resistorRating: 0.25,
};

const solve = (r: number) => solveSeriesLed(spec.vs, red, r);

describe('solveSeriesLed (bilinen cevaplar)', () => {
  it('9 V, Vf 2 V, 330 Ω → 21,2 mA', () => {
    const s = solve(330);
    expect(s.current).toBeCloseTo(7 / 330, 12);
    expect(s.current * 1000).toBeCloseTo(21.21, 2);
    expect(s.vResistor).toBeCloseTo(7, 12);
    expect(s.vLed).toBe(2);
  });

  it('5 V, Vf 3 V, 150 Ω → 13,3 mA, P_R = 26,7 mW', () => {
    const s = solveSeriesLed(5, { kind: 'constant-vf', vf: 3 }, 150);
    expect(s.current * 1000).toBeCloseTo(13.333, 3);
    expect(s.pResistor * 1000).toBeCloseTo(26.667, 3);
    expect(s.pLed * 1000).toBeCloseTo(40, 6);
  });

  it('KVL her zaman sağlanır: V_R + V_LED = Vs (LED iletimdeyken)', () => {
    for (const r of e12Values(10, 100_000)) {
      const s = solve(r);
      expect(s.vResistor + s.vLed).toBeCloseTo(spec.vs, 10);
    }
  });

  it('Vs ≤ Vf → akım 0, LED kaynağın tamamını görür', () => {
    const s = solveSeriesLed(1.5, red, 100);
    expect(s.current).toBe(0);
    expect(s.pResistor).toBe(0);
    expect(s.vLed).toBe(1.5);
  });

  it('geçersiz direnci reddeder', () => {
    expect(() => solve(0)).toThrow();
    expect(() => solve(-10)).toThrow();
  });
});

describe('classify', () => {
  it.each([
    [470, 'ok'], // 14,9 mA
    [1000, 'dim'], // 7 mA
    [10_000, 'no_light'], // 0,7 mA
    [270, 'over_mild'], // 25,9 mA
    [100, 'over_severe'], // 70 mA
    [22, 'fuse'], // 318 mA
  ] as const)('%d Ω → %s', (r, zone) => {
    expect(classify(spec, solve(r))).toBe(zone);
  });

  it('hedefte ama direnç anma gücünü aşıyorsa resistor_overheat', () => {
    const hot = { ...spec, vs: 60 }; // 58 V / 3,9 kΩ ≈ 14,9 mA, P ≈ 0,86 W
    expect(classify(hot, solveSeriesLed(60, red, 3900))).toBe('resistor_overheat');
  });
});

describe('outcomePool / resolveOutcome', () => {
  it('doğru direnç her tohumda başarı verir', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(resolveOutcome(spec, solve(470), createRng(seed)).kind).toBe('success');
    }
  });

  it('sigorta durumu deterministik', () => {
    expect(outcomePool(spec, solve(22))).toEqual([{ value: 'fuse_blown', weight: 1 }]);
  });

  it('hafif aşırı akımda yanma olasılığı akımla artar', () => {
    const pBurnt = (r: number) =>
      outcomePool(spec, solve(r)).find((e) => e.value === 'led_burnt')!.weight;
    // 330 Ω → 21,2 mA ; 270 Ω → 25,9 mA ; 240 Ω → 29,2 mA
    expect(pBurnt(330)).toBeLessThan(pBurnt(270));
    expect(pBurnt(270)).toBeLessThan(pBurnt(240));
    expect(pBurnt(330)).toBeCloseTo((7 / 330 - 0.02) / 0.01, 10);
  });

  it('ampirik dağılım havuz ağırlığına uyar', () => {
    const rng = createRng(42);
    let burnt = 0;
    const n = 4000;
    for (let k = 0; k < n; k++) if (resolveOutcome(spec, solve(270), rng).kind === 'led_burnt') burnt++;
    const p = (7 / 270 - 0.02) / 0.01;
    expect(burnt / n).toBeGreaterThan(p - 0.03);
    expect(burnt / n).toBeLessThan(p + 0.03);
  });

  it('aynı tohum aynı sonucu verir', () => {
    const a = resolveOutcome(spec, solve(270), createRng(7));
    const b = resolveOutcome(spec, solve(270), createRng(7));
    expect(a).toEqual(b);
  });

  it('direnç aşırı ısınması ek bulgu olarak işaretlenir', () => {
    expect(resolveOutcome(spec, solve(100), createRng(1)).resistorOverheat).toBe(true); // 0,49 W
    expect(resolveOutcome(spec, solve(470), createRng(1)).resistorOverheat).toBe(false);
  });
});

describe('içerik yapılandırması', () => {
  it('door-power-01 kartı ayrıştırılır ve SI birimine çevrilir', () => {
    const cfg = parseSeriesLedConfig(fault.stages[0].config);
    expect(cfg.targetMin).toBeCloseTo(0.01, 12);
    expect(cfg.fuse).toBeCloseTo(0.2, 12);
  });

  it('sırası bozuk eşikleri reddeder', () => {
    const bad = { ...fault.stages[0].config, targetMin_mA: 25 };
    expect(() => parseSeriesLedConfig(bad)).toThrow();
  });
});

describe('üretici + doğrulayıcı', () => {
  const cfg = parseSeriesLedConfig(fault.stages[0].config);

  it('1000 tohumun hepsinde doğrulanmış problem: tam 1 doğru, her tuzak ayrı bölgede', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = generateSeriesLed(cfg, seed);
      expect(verifySeriesLed(p)).toEqual({ ok: true, errors: [] });
      expect(p.choices).toHaveLength(REQUIRED_ZONES.length);
      const zones = p.choices.map((c) => classify(p.spec, solveSeriesLed(p.spec.vs, p.spec.led.model, c.r)));
      expect(new Set(zones).size).toBe(zones.length);
      const correct = p.choices.find((c) => c.id === p.correctId)!;
      expect(classify(p.spec, solveSeriesLed(p.spec.vs, p.spec.led.model, correct.r))).toBe('ok');
    }
  });

  it('üretim deterministik', () => {
    expect(generateSeriesLed(cfg, 123)).toEqual(generateSeriesLed(cfg, 123));
  });

  it('bozuk problemi reddeder (yanlış cevap işaretli)', () => {
    const p = generateSeriesLed(cfg, 5);
    const wrong = p.choices.find((c) => c.id !== p.correctId)!;
    const v = verifySeriesLed({ ...p, correctId: wrong.id });
    expect(v.ok).toBe(false);
  });

  it('bozuk problemi reddeder (iki doğru seçenek)', () => {
    const p = generateSeriesLed(cfg, 5);
    const correct = p.choices.find((c) => c.id === p.correctId)!;
    const twin = e12Values().find(
      (r) =>
        r !== correct.r &&
        classify(p.spec, solveSeriesLed(p.spec.vs, p.spec.led.model, r)) === 'ok' &&
        !p.choices.some((c) => c.r === r),
    )!;
    const v = verifySeriesLed({ ...p, choices: [...p.choices, { id: 'x', r: twin, label: '' }] });
    expect(v.ok).toBe(false);
  });

  it('"Vf unutuldu" tuzağı doğru cevap olamaz', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const p = generateSeriesLed(cfg, seed);
      for (const c of p.choices) if (c.mistake) expect(c.id).not.toBe(p.correctId);
    }
  });
});

describe('olay raporu', () => {
  it('seçilen direncin akımını ve doğru cevabı içerir', () => {
    const cfg = parseSeriesLedConfig(fault.stages[0].config);
    const p = generateSeriesLed(cfg, 9);
    const wrong = p.choices.find((c) => c.id !== p.correctId)!;
    const sol = solveSeriesLed(p.spec.vs, p.spec.led.model, wrong.r);
    const outcome = resolveOutcome(p.spec, sol, createRng(1));
    const report = buildSeriesLedReport('s', p, wrong.id, outcome);
    expect(report.success).toBe(false);
    expect(report.correctLabel).toBe(p.choices.find((c) => c.id === p.correctId)!.label);
    expect(report.steps.join('\n')).toContain(wrong.label);
  });
});
