import { describe, expect, it } from 'vitest';
import balanceJson from '../../content/balance/resources.json';
import {
  anyLow,
  applyOutcome,
  createResources,
  drainPerMinute,
  isCritical,
  level,
  parseBalance,
  repair,
  resetEpisode,
  severityFactor,
  spend,
  tensionFor,
  tick,
  type ResourceState,
} from './resources';
import type { Outcome, OutcomeKind } from './types';

const B = parseBalance(balanceJson);
const FAULT = 'door-power-01';

const out = (kind: OutcomeKind, severity = 1, resistorOverheat = false): Outcome => ({
  kind,
  severity,
  resistorOverheat,
  headline: '',
  explanation: '',
});
const withValues = (oxygen: number, power: number): ResourceState => ({
  ...createResources(B),
  values: { oxygen, power },
  warned: { oxygen: oxygen <= B.warning, power: power <= B.warning },
});
const lossOf = (kind: OutcomeKind, severity = 1, overheat = false) => {
  const s = applyOutcome(createResources(B), B, FAULT, out(kind, severity, overheat)).state;
  return { oxygen: 100 - s.values.oxygen, power: 100 - s.values.power };
};

describe('denge dosyası', () => {
  it('içerikteki denge geçerli; iki kaynak 100 ile başlar', () => {
    expect(createResources(B).values).toEqual({ oxygen: 100, power: 100 });
    expect(B.warning).toBeGreaterThan(B.critical);
  });

  it('bozuk dengeyi reddeder', () => {
    const bad = (patch: object) => () => parseBalance({ ...balanceJson, ...patch });
    expect(bad({ warning: 10 })).toThrow(/warning > critical/);
    expect(bad({ recovery: { water: 5 } })).toThrow(/bilinmeyen kaynak/);
    expect(bad({ resources: {} })).toThrow(/boş/);
    expect(bad({ overheat: { label: 'x', loss: { oxygen: -1 } } })).toThrow(/negatif/);
    expect(() => parseBalance(null)).toThrow();
  });
});

describe('denge kapsamı', () => {
  it('her hata sonucu türünün denge satırı var', () => {
    const kinds: OutcomeKind[] = [
      'no_light', 'dim', 'led_stressed', 'led_burnt', 'resistor_burnt', 'fuse_blown',
      'motor_stall', 'motor_slow', 'motor_overheat', 'motor_burnt',
      'core_reboot', 'core_crash', 'sensor_misread', 'core_freeze',
    ];
    for (const k of kinds) expect(B.outcomes[k as Exclude<OutcomeKind, 'success'>], k).toBeDefined();
  });

  it.each([
    ['motor_stall', 0, 3],
    ['motor_slow', 3, 4],
    ['motor_overheat', 0, 8],
    ['motor_burnt', 10, 14],
  ] as const)('%s → O₂ −%d, güç −%d (şiddet 1)', (kind, o2, pw) => {
    const l = lossOf(kind, 1);
    expect(l.oxygen).toBeCloseTo(o2, 10);
    expect(l.power).toBeCloseTo(pw, 10);
  });

  it('motor yanması şiddetle ölçeklenir, termik korumadan ağırdır', () => {
    expect(lossOf('motor_burnt', 3).power).toBeCloseTo(14 * 1.5, 10);
    const total = (k: OutcomeKind) => lossOf(k, 1.2).oxygen + lossOf(k, 1.2).power;
    expect(total('motor_overheat')).toBeLessThan(total('motor_burnt'));
  });
});

describe('applyOutcome: hasar fiziksel sonuçtan gelir', () => {
  it.each([
    ['no_light', 0, 3],
    ['dim', 4, 5],
    ['fuse_blown', 0, 6],
    ['resistor_burnt', 12, 8],
  ] as const)('%s → O₂ −%d, güç −%d', (kind, o2, pw) => {
    const l = lossOf(kind);
    expect(l.oxygen).toBeCloseTo(o2, 10);
    expect(l.power).toBeCloseTo(pw, 10);
  });

  it('sigorta atması az, yanma ve duman fazla hasar verir', () => {
    const total = (k: OutcomeKind, sev = 1) => {
      const l = lossOf(k, sev);
      return l.oxygen + l.power;
    };
    expect(total('fuse_blown')).toBeLessThan(total('led_burnt', 1));
    expect(total('fuse_blown')).toBeLessThan(total('resistor_burnt'));
  });

  it('aşırı akımda kayıp şiddetle artar ama tavanlıdır', () => {
    const p = (sev: number) => lossOf('led_burnt', sev).power;
    expect(p(1.2)).toBeLessThan(p(2));
    expect(p(2)).toBeLessThan(p(3));
    expect(p(3)).toBeCloseTo(12 * 1.5, 10);
    expect(p(50)).toBeCloseTo(12 * 1.5, 10);
    expect(severityFactor(B, out('led_burnt', Infinity))).toBe(1.5);
    // Şiddet ölçeği yalnız aşırı akım türlerine uygulanır
    expect(lossOf('fuse_blown', 9).power).toBeCloseTo(6, 10);
  });

  it('aşırı ısınan direnç ek duman hasarı ve kalıcı tüketim ekler', () => {
    const s = applyOutcome(createResources(B), B, FAULT, out('led_burnt', 1, true)).state;
    expect(100 - s.values.oxygen).toBeCloseTo(8 + 5, 10);
    expect(s.damages.map((d) => d.source).sort()).toEqual(['led_burnt', 'overheat']);
  });

  it('kaynaklar 0\'ın altına inmez', () => {
    const s = applyOutcome(withValues(3, 2), B, FAULT, out('resistor_burnt')).state;
    expect(s.values).toEqual({ oxygen: 0, power: 0 });
  });

  it('olaylar: hasar, uyarı eşiği bir kez, kritik', () => {
    const near = withValues(38, 100);
    const a = applyOutcome(near, B, FAULT, out('dim'));
    expect(a.events.map((e) => e.type)).toEqual(['damage', 'crossedWarning']);
    const b = applyOutcome(a.state, B, FAULT, out('dim'));
    expect(b.events.map((e) => e.type)).toEqual(['damage']); // tekrar uyarı yok
    const c = applyOutcome(withValues(18, 100), B, FAULT, out('resistor_burnt'));
    expect(c.events).toContainEqual({ type: 'critical', resource: 'oxygen', value: 6 });
    expect(isCritical(c.state, B)).toBe(true);
  });
});

describe('repair', () => {
  it('başarı küçük bir pay geri verir, tavan 100', () => {
    const s = applyOutcome(withValues(50, 95), B, FAULT, out('success')).state;
    expect(s.values).toEqual({ oxygen: 60, power: 100 });
  });

  it('yalnız onarılan arızanın kalıcı hasarını siler', () => {
    let s = applyOutcome(createResources(B), B, FAULT, out('led_burnt')).state;
    s = applyOutcome(s, B, 'baska-ariza', out('fuse_blown')).state;
    s = repair(s, B, FAULT).state;
    expect(s.damages.map((d) => d.faultId)).toEqual(['baska-ariza']);
  });

  it('uyarı eşiğinin üstüne çıkınca uyarı yeniden kurulur', () => {
    let s = applyOutcome(withValues(38, 100), B, FAULT, out('dim')).state; // 34
    s = repair(s, B, FAULT).state; // 44
    const again = applyOutcome(withValues(s.values.oxygen, 100), B, FAULT, out('resistor_burnt'));
    expect(again.events.some((e) => e.type === 'crossedWarning')).toBe(true);
  });
});

describe('tick: onarılmayan hasar yavaşça tüketir', () => {
  it('hasar yoksa tüketim yok', () => {
    const s = createResources(B);
    expect(tick(s, B, 600).state).toBe(s);
  });

  it('süreyle orantılı tüketir', () => {
    const s = applyOutcome(createResources(B), B, FAULT, out('resistor_burnt')).state; // O₂ 88, 0,8/dk
    const t1 = tick(s, B, 60).state;
    const t5 = tick(s, B, 300).state;
    expect(s.values.oxygen - t1.values.oxygen).toBeCloseTo(0.8, 10);
    expect(s.values.oxygen - t5.values.oxygen).toBeCloseTo(4, 10);
    expect(t5.values.power).toBe(s.values.power);
  });

  it('aynı tür hata üst üste binmez, farklı türler toplanır', () => {
    let s = createResources(B);
    for (let k = 0; k < 4; k++) s = applyOutcome(s, B, FAULT, out('led_burnt')).state;
    expect(drainPerMinute(s, B).oxygen).toBeCloseTo(0.6, 10);
    s = applyOutcome(s, B, FAULT, out('resistor_burnt')).state;
    expect(drainPerMinute(s, B).oxygen).toBeCloseTo(1.4, 10);
  });

  it('toplam tüketim tavanı aşılmaz', () => {
    let s = createResources(B);
    for (const f of ['a', 'b', 'c', 'd', 'e']) s = applyOutcome(s, B, f, out('resistor_burnt')).state; // 5 × 0,8
    expect(drainPerMinute(s, B).oxygen).toBe(B.drainCapPerMinute);
  });

  it('tüketimle kritik eşiğe inilince olay üretir', () => {
    const s = applyOutcome(withValues(27.5, 100), B, FAULT, out('resistor_burnt')); // O₂ 15,5
    expect(s.events.some((e) => e.type === 'critical')).toBe(false);
    const step = tick(s.state, B, 60); // −0,8 → 14,7
    expect(step.events).toContainEqual(expect.objectContaining({ type: 'critical', resource: 'oxygen' }));
  });
});

describe('seviye, gerilim, sıfırlama', () => {
  it('seviyeler eşiklere göre', () => {
    expect(level(B, 80)).toBe('ok');
    expect(level(B, 35)).toBe('low');
    expect(level(B, 15)).toBe('critical');
    expect(anyLow(withValues(80, 30), B)).toBe(true);
    expect(anyLow(withValues(80, 80), B)).toBe(false);
  });

  it('gerilim: 60 ve üstü 0, 15 ve altı 1, arası tekdüze; en düşük kaynak belirler', () => {
    expect(tensionFor(withValues(100, 60), B)).toBe(0);
    expect(tensionFor(withValues(100, 15), B)).toBe(1);
    expect(tensionFor(withValues(5, 100), B)).toBe(1);
    let prev = -1;
    for (let v = 60; v >= 15; v -= 5) {
      const t = tensionFor(withValues(100, v), B);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('bölüm sıfırlama: kaynaklar başa döner, kalıcı hasar silinir', () => {
    const s = applyOutcome(withValues(20, 20), B, FAULT, out('led_burnt')).state;
    expect(resetEpisode(s, B)).toEqual(createResources(B));
  });

  it('spend: bilinçli harcama düşürür', () => {
    expect(spend(createResources(B), B, { power: 5 }).state.values.power).toBe(95);
  });
});
