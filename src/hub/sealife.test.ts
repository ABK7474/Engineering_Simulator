import { describe, expect, it } from 'vitest';
import worldJson from '../../content/world/season1-world.json';
import { buildWorldLayout } from '../world/layout';
import { parseWorld } from '../world/schema';
import { clearZones, dishSpots, distanceToRects, expand, seabedHeight, stationRocks, WALL_OUT } from './exterior';
import { FishSim, jellyLayout, kelpLayout, obstacleFloor, pushOutside, schoolCenter, schoolPaths } from './sealife';

const L = buildWorldLayout(parseWorld(worldJson));
const interiors = L.rooms.map((r) => expand(r.rect, WALL_OUT));
const rocks = stationRocks(L);
const zones = clearZones(L);
const dishes = dishSpots(L);
const bed = (x: number, z: number) => seabedHeight(x, z, distanceToRects(interiors, x, z));
const floor = (x: number, z: number) => obstacleFloor(rocks, dishes, x, z, bed(x, z));
const rockReach = (r: (typeof rocks)[number]) => r.scale * 1.1 * 1.25;

describe('deniz canlıları: yerleşim', () => {
  it('pushOutside noktayı genişletilmiş dikdörtgenin en yakın kenarına iter, dışarıdakine dokunmaz', () => {
    const r = [{ minX: 0, maxX: 10, minZ: 0, maxZ: 4 }];
    expect(pushOutside(r, 5, 1, 0.5)[1]).toBeCloseTo(-0.501, 3);
    expect(pushOutside(r, 9.8, 2, 0.5)[0]).toBeCloseTo(10.501, 3);
    expect(pushOutside(r, -3, 2, 0.5)).toEqual([-3, 2]);
  });

  it('her odanın penceresinin önünde bir sürü; yolun her noktası iç hacimlerden ≥ 3 m uzak', () => {
    const paths = schoolPaths(L.windows, interiors);
    expect(new Set(paths.map((p) => p.roomId))).toEqual(new Set(L.windows.map((w) => w.roomId)));
    for (const p of paths)
      for (let k = 0; k < 200; k++) {
        const [x, , z] = schoolCenter(p, (k / 200) * p.period);
        expect(distanceToRects(interiors, x, z)).toBeGreaterThanOrEqual(3);
      }
  });

  it('yosun kökleri tabana gömülü, kayalara, çanağa ve iç hacimlere değmiyor', () => {
    const kelp = kelpLayout(L.windows, interiors, rocks, dishes, undefined, zones);
    expect(kelp.length).toBeGreaterThan(40);
    for (const k of kelp) {
      expect(k.y).toBeLessThan(bed(k.x, k.z));
      expect(distanceToRects(interiors, k.x, k.z)).toBeGreaterThanOrEqual(1.4);
      for (const r of rocks) expect(Math.hypot(k.x - r.x, k.z - r.z)).toBeGreaterThan(rockReach(r));
      for (const d of dishes) expect(Math.hypot(k.x - d.x, k.z - d.z)).toBeGreaterThan(2.6);
    }
  });

  it('denizanaları dokunaçlarıyla birlikte tabanın üstünde, kayalardan ve iç hacimlerden uzak', () => {
    const jellies = jellyLayout(L.windows, interiors, rocks, dishes, undefined, undefined, zones);
    expect(jellies.length).toBe(18);
    for (const j of jellies) {
      // En alçak an: salınım −0,5, dokunaç 0,9·ölçek
      expect(j.y - 0.5 - 0.95 * j.scale).toBeGreaterThan(bed(j.x, j.z) + 0.1);
      // Sürüklenme her eksende ≤ 1,2 m (yatayda ≤ 1,7 m)
      expect(distanceToRects(interiors, j.x, j.z)).toBeGreaterThanOrEqual(2.5);
      for (const r of rocks) expect(Math.hypot(j.x - r.x, j.z - r.z) - 1.2 * Math.SQRT2).toBeGreaterThan(rockReach(r));
      for (const d of dishes) expect(Math.hypot(j.x - d.x, j.z - d.z) - 1.2 * Math.SQRT2).toBeGreaterThan(3.2);
    }
  });

  it('deterministik', () => {
    expect(kelpLayout(L.windows, interiors, rocks, dishes, undefined, zones)).toEqual(kelpLayout(L.windows, interiors, rocks, dishes, undefined, zones));
    expect(jellyLayout(L.windows, interiors, rocks, dishes, undefined, undefined, zones)).toEqual(jellyLayout(L.windows, interiors, rocks, dishes, undefined, undefined, zones));
  });
});

describe('deniz canlıları: balık sürüsü', () => {
  const make = () => new FishSim(schoolPaths(L.windows, interiors), 26, { interiors, floor });

  it('uzun süre (yaratık geçişleri dahil) balıklar istasyona, tabana ve kayalara girmez', () => {
    const sim = make();
    const dt = 1 / 30;
    const bad: string[] = [];
    for (let f = 0; f < 30 * 150; f++) {
      const t = f * dt;
      // Her 30 s'de bir, 8 s boyunca yaratık rastgele bir sürünün içinden geçer
      const s = Math.floor(t / 30) % sim.paths.length;
      const c = t % 30 < 8 ? schoolCenter(sim.paths[s], t) : null;
      sim.step(dt, t, c && { x: c[0] + ((t % 30) - 4) * 2, y: c[1], z: c[2] });
      if (f % 15) continue;
      for (let i = 0; i < sim.n; i++) {
        const [x, y, z] = [sim.pos[i * 3], sim.pos[i * 3 + 1], sim.pos[i * 3 + 2]];
        if (distanceToRects(interiors, x, z) < 0.59 || y < floor(x, z) - 1e-3) bad.push(`${t.toFixed(1)} s, balık ${i}: ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
  }, 30_000);

  it('yaratık yaklaşınca sürü ondan kaçar, dağılır ve hızlanır; gidince korku söner', () => {
    const calm = make();
    const scared = make();
    const dt = 1 / 30;
    for (let f = 0; f < 300; f++) {
      calm.step(dt, f * dt, null);
      scared.step(dt, f * dt, null);
    }
    const t0 = 300 * dt;
    const c0 = schoolCenter(scared.paths[0], t0);
    const creature = { x: c0[0] + 4, y: c0[1], z: c0[2] };
    const meanDist = (sim: FishSim) => {
      let d = 0;
      let k = 0;
      for (let i = 0; i < sim.n; i++) if (sim.school[i] === 0) (d += Math.hypot(sim.pos[i * 3] - creature.x, sim.pos[i * 3 + 1] - creature.y, sim.pos[i * 3 + 2] - creature.z)), k++;
      return d / k;
    };
    const meanSpeed = (sim: FishSim) => {
      let v = 0;
      for (let i = 0; i < sim.n; i++) if (sim.school[i] === 0) v += Math.hypot(sim.vel[i * 3], sim.vel[i * 3 + 1], sim.vel[i * 3 + 2]);
      return v / 26;
    };
    const before = meanDist(scared);
    for (let f = 0; f < 60; f++) {
      calm.step(dt, t0 + f * dt, null);
      scared.step(dt, t0 + f * dt, creature);
    }
    expect(scared.fear[0]).toBeGreaterThan(0.9);
    expect(meanDist(scared) - before).toBeGreaterThan(3);
    expect(meanDist(scared)).toBeGreaterThan(meanDist(calm) + 3);
    expect(meanSpeed(scared)).toBeGreaterThan(meanSpeed(calm) * 2);
    // Uzaktaki sürüler etkilenmez
    expect(Math.min(...[...scared.fear].slice(1).filter((_, s) => Math.hypot(...[0, 1, 2].map((a) => schoolCenter(scared.paths[s + 1], t0)[a] - [creature.x, creature.y, creature.z][a])) > 30))).toBe(0);
    for (let f = 0; f < 30 * 25; f++) scared.step(dt, t0 + 2 + f * dt, null);
    expect(scared.fear[0]).toBeLessThan(0.01);
  });

  it('deterministik', () => {
    const [a, b] = [make(), make()];
    for (let f = 0; f < 90; f++) {
      a.step(1 / 30, f / 30, null);
      b.step(1 / 30, f / 30, null);
    }
    expect([...a.pos]).toEqual([...b.pos]);
  });
});
