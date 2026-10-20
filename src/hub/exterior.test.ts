import { describe, expect, it } from 'vitest';
import worldJson from '../../content/world/season1-world.json';
import { createRng } from '../core/rng';
import { buildWorldLayout, insideAny } from '../world/layout';
import { parseWorld } from '../world/schema';
import { distanceToRects, expand, outsidePoint, rockLayout, seabedHeight, WALL_OUT } from './exterior';

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

  it('pencereler iki odada da var: koridor batısı ve kontrol odası batısı', () => {
    expect(new Set(L.windows.map((w) => w.roomId))).toEqual(new Set(['corridor-b2', 'lab-c1']));
    expect(L.windows.every((w) => w.nx === -1)).toBe(true);
  });
});
