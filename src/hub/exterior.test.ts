import { describe, expect, it } from 'vitest';
import worldJson from '../../content/world/season1-world.json';
import { createRng } from '../core/rng';
import { buildWorldLayout, insideAny } from '../world/layout';
import { parseWorld } from '../world/schema';
import { clearZones, dishSpots, distanceToRects, expand, outsidePoint, rockLayout, seabedHeight, stationRocks, WALL_OUT } from './exterior';

const L = buildWorldLayout(parseWorld(worldJson));
const interiors = L.rooms.map((r) => expand(r.rect, WALL_OUT));

describe('dış sahne yerleşimi (yalnız pencerelerden görünür, iç hacimlere girmez)', () => {
  it('deniz tabanı zeminin (y = 0) hep altında ve istasyondan uzaklaştıkça iner', () => {
    for (let x = -60; x < 60; x += 2.3) for (let z = -80; z < 40; z += 1.9) expect(seabedHeight(x, z, distanceToRects(interiors, x, z))).toBeLessThanOrEqual(-0.6);
    const avg = (away: number) => Array.from({ length: 50 }, (_, k) => seabedHeight(-10 - k, -20 + k * 0.7, away)).reduce((a, b) => a + b) / 50;
    expect(avg(30)).toBeLessThan(avg(2));
  });

  it('deterministik', () => {
    expect(seabedHeight(-12.3, 4.5, 3)).toBe(seabedHeight(-12.3, 4.5, 3));
    expect(rockLayout(L.windows, interiors)).toEqual(rockLayout(L.windows, interiors));
  });

  it('kayaların hiçbiri bir odaya taşmaz ve tabana oturur', () => {
    for (const r of rockLayout(L.windows, interiors)) {
      expect(distanceToRects(interiors, r.x, r.z)).toBeGreaterThanOrEqual(r.scale * 1.1);
      expect(r.y).toBeGreaterThan(seabedHeight(r.x, r.z, distanceToRects(interiors, r.x, r.z)));
    }
  });

  it('parçacık ve huzme noktaları her zaman dışarıda (oda 2 dahil)', () => {
    const rng = createRng(5);
    for (let i = 0; i < 2000; i++) {
      const [x, z] = outsidePoint(rng, L.windows, interiors, [1.2, 22], 12, 0.3);
      expect(insideAny(interiors, x, z), `${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
    }
  });

  it('her odada pencere var; koridorun ve kontrol odasının pencereleri batıya bakar', () => {
    expect(new Set(L.windows.map((w) => w.roomId))).toEqual(new Set(['corridor-b2', 'lab-c1', 'power-p1', 'sensor-s1', 'core-k1', 'airlock-a1']));
    expect(L.windows.filter((w) => w.roomId === 'corridor-b2' || w.roomId === 'lab-c1').every((w) => w.nx === -1)).toBe(true);
  });
});

describe('çanak', () => {
  it('sensör odasının penceresinin önünde, dışarıda ve iç hacimlerden uzak', () => {
    const spots = dishSpots(L);
    expect(spots).toHaveLength(1);
    const interiors = L.rooms.map((r) => expand(r.rect, WALL_OUT));
    expect(distanceToRects(interiors, spots[0].x, spots[0].z)).toBeGreaterThan(5);
  });
});

describe('prolog: enkaz ve yürüyüş yolu', () => {
  const e = L.entry!;
  const rocks = stationRocks(L);
  const reach = (r: (typeof rocks)[number]) => r.scale * 1.1 * 1.25;
  const sample = () => {
    const pts: [number, number][] = [];
    for (let i = 1; i < e.path.length; i++)
      for (let k = 0; k <= 20; k++) {
        const [a, b] = [e.path[i - 1], e.path[i]];
        pts.push([a[0] + ((b[0] - a[0]) * k) / 20, a[1] + ((b[1] - a[1]) * k) / 20]);
      }
    return pts;
  };

  it('yol enkazın yanından başlar, servis kilidinin önünde biter', () => {
    expect(Math.hypot(e.path[0][0] - e.wreck!.x, e.path[0][1] - e.wreck!.z)).toBeLessThan(4);
    const end = e.path.at(-1)!;
    expect(Math.hypot(end[0] - (e.hatch.x + e.hatch.nx * 1.7), end[1] - (e.hatch.z + e.hatch.nz * 1.7))).toBeLessThan(0.3);
  });

  it('yol istasyona girmez; hiçbir kaya yola ya da enkaza değmez', () => {
    for (const [x, z] of sample().slice(0, -8)) expect(distanceToRects(interiors, x, z), `${x}, ${z}`).toBeGreaterThan(0.5);
    for (const r of rocks) {
      for (const [x, z] of sample()) expect(Math.hypot(x - r.x, z - r.z)).toBeGreaterThan(reach(r) + 0.4);
      expect(Math.hypot(e.wreck!.x - r.x, e.wreck!.z - r.z)).toBeGreaterThan(reach(r) + 3.5);
    }
  });

  it('enkaz istasyondan uzak ve pencereden görünür mesafede', () => {
    const d = distanceToRects(interiors, e.wreck!.x, e.wreck!.z);
    expect(d).toBeGreaterThan(4);
    expect(Math.min(...L.windows.map((w) => Math.hypot(w.x - e.wreck!.x, w.z - e.wreck!.z)))).toBeLessThan(12);
  });

  it('açık bölgeler kaya yerleşimini yalnız yolda değiştirir (diğerleri belirlenimci)', () => {
    expect(stationRocks(L)).toEqual(stationRocks(L));
    expect(clearZones(L).length).toBe(e.path.length);
  });
});
