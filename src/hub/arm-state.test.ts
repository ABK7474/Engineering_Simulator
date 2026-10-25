import { describe, expect, it } from 'vitest';
import { ArmState, RAISE_SECONDS, REACH_PEAK, REACH_SECONDS } from './arm-state';

const run = (a: ArmState, seconds: number, speed = 0, dt = 1 / 60) => {
  let pose = a.update(0, speed);
  for (let t = 0; t < seconds - 1e-9; t += dt) pose = a.update(dt, speed);
  return pose;
};

describe('kol durumu', () => {
  it('Q/M/N kolu ~0,3 s’de kaldırır, bırakınca indirir', () => {
    const a = new ArmState();
    expect(run(a, 0.5).raise).toBe(0);
    a.setMode('map');
    expect(run(a, RAISE_SECONDS / 2).raise).toBeGreaterThan(0.3);
    expect(a.settled).toBe(false);
    expect(run(a, RAISE_SECONDS).raise).toBeCloseTo(1, 6);
    expect(a.settled).toBe(true);
    a.setMode('rest');
    expect(run(a, RAISE_SECONDS + 0.02).raise).toBeCloseTo(0, 6);
    expect(a.settled).toBe(true);
  });

  it('uzanma: tepede panel bir kez açılır, sonra el geri çekilir', () => {
    const a = new ArmState();
    let opened = 0;
    a.reach(() => opened++);
    run(a, REACH_SECONDS * REACH_PEAK - 0.02);
    expect(opened).toBe(0);
    const mid = run(a, 0.05);
    expect(opened).toBe(1);
    expect(mid.reach).toBeGreaterThan(0.9);
    const end = run(a, REACH_SECONDS);
    expect(opened).toBe(1);
    expect(end.reach).toBe(0);
    expect(a.reaching).toBe(false);
  });

  it('yürürken sallanır, dururken söner', () => {
    const a = new ArmState();
    const walking = Array.from({ length: 120 }, () => a.update(1 / 60, 2.8));
    expect(Math.max(...walking.map((p) => Math.abs(p.bobX)))).toBeGreaterThan(0.008);
    const still = run(a, 2, 0);
    expect(Math.abs(still.bobX) + still.bobY).toBeLessThan(0.001);
  });
});
