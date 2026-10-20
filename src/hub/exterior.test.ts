import { describe, expect, it } from 'vitest';
import { OUTSIDE_X, rockLayout, seabedHeight } from './exterior';

describe('dış sahne yerleşimi (yalnız pencerelerden görünür)', () => {
  it('deniz tabanı koridor zemininin (y = 0) hep altında ve istasyondan uzaklaştıkça iner', () => {
    for (let x = OUTSIDE_X; x > -75; x -= 1.7) {
      for (let z = -48; z < 24; z += 1.3) expect(seabedHeight(x, z)).toBeLessThanOrEqual(-0.6);
    }
    const avg = (x: number) => Array.from({ length: 40 }, (_, k) => seabedHeight(x, -40 + k * 1.5)).reduce((a, b) => a + b) / 40;
    expect(avg(-40)).toBeLessThan(avg(-5));
  });

  it('deterministik', () => {
    expect(seabedHeight(-12.3, 4.5)).toBe(seabedHeight(-12.3, 4.5));
    expect(rockLayout()).toEqual(rockLayout());
  });

  it('kayaların hepsi dışarıda (koridora taşmaz) ve tabana oturur', () => {
    for (const r of rockLayout()) {
      expect(r.x + r.scale * 1.1).toBeLessThan(OUTSIDE_X);
      expect(r.y).toBeGreaterThan(seabedHeight(r.x, r.z));
    }
  });
});
