import { describe, expect, it } from 'vitest';
import { initialThreat, parseThreats, tickThreat, validThreatState, type ThreatDef, type ThreatState } from './threat';

const DEF: ThreatDef = { id: 'c', after: ['sensor.calibrated'], delaySec: 20, timeLimitSec: 100, retrySec: 60, activeState: 'threat.active', clearedBy: 'threat.cleared', noise: [1, 1, 2.5] };
const run = (st: ThreatState, steps: number, input: Partial<Parameters<typeof tickThreat>[2]> = {}) => {
  const events: string[] = [];
  for (let k = 0; k < steps; k++) {
    const r = tickThreat(DEF, st, { states: ['sensor.calibrated'], dt: 1, roaming: true, noise: 1, ...input });
    st = r.state;
    events.push(...r.events.map((e) => e.kind));
  }
  return { st, events };
};

describe('tehdit durum makinesi', () => {
  it('koşul yokken uyur; koşul gelince bekler, 20 sn dolaşınca başlar', () => {
    expect(tickThreat(DEF, initialThreat(), { states: [], dt: 1, roaming: true, noise: 1 }).state.phase).toBe('dormant');
    const a = run(initialThreat(), 19);
    expect(a.st.phase).toBe('pending');
    const b = run(a.st, 1);
    expect(b.st).toMatchObject({ phase: 'active', timer: 100 });
    expect(b.events).toEqual(['started']);
  });

  it('panel açıkken (dolaşmıyorken) sayaç durur', () => {
    const active = run(initialThreat(), 20).st;
    expect(run(active, 50, { roaming: false }).st.timer).toBe(100);
  });

  it('yürürken 100 sn: %50 ve %20 uyarıları, sonra saldırı; yaratık 60 sn sonra yeniden gelir', () => {
    const active = run(initialThreat(), 20).st;
    const r = run(active, 100);
    expect(r.events).toEqual(['warning', 'warning', 'strike']);
    expect(r.st).toMatchObject({ phase: 'active', strikes: 1, timer: 60, warned: 0 });
  });

  it('koşmak yaratığı 2,5 kat hızlı getirir: 40 sn koşu = 100 sn yürüyüş; eğilmek yavaşlatmaz (çarpan 1)', () => {
    const active = run(initialThreat(), 20).st;
    expect(run(active, 40, { noise: 2 }).events.at(-1)).toBe('strike');
    expect(run(active, 40, { noise: 0 }).st.timer).toBe(60);
  });

  it('pano onarılınca olay biter, bir daha başlamaz', () => {
    const active = run(initialThreat(), 25).st;
    const r = tickThreat(DEF, active, { states: ['sensor.calibrated', 'threat.cleared'], dt: 1, roaming: true, noise: 1 });
    expect(r.state.phase).toBe('cleared');
    expect(r.events).toEqual([{ kind: 'cleared' }]);
    expect(run(r.state, 500).events).toEqual([]);
  });

  it('tanım ve kayıt doğrulaması', () => {
    expect(parseThreats([DEF])).toHaveLength(1);
    expect(parseThreats(undefined)).toEqual([]);
    expect(() => parseThreats([{ ...DEF, noise: [2, 1, 1] }])).toThrow(/noise/);
    expect(() => parseThreats([{ ...DEF, clearedBy: 'threat.active' }])).toThrow(/farklı/);
    expect(validThreatState(initialThreat())).toBe(true);
    expect(validThreatState({ phase: 'x', timer: 0, strikes: 0, warned: 0 })).toBe(false);
  });
});
