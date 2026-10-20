import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME, layerGains, parseSettings, StrideCounter } from './mix';

describe('parseSettings', () => {
  it('boş ya da bozuk veride varsayılana döner', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_VOLUME);
    expect(parseSettings('{bozuk')).toEqual(DEFAULT_VOLUME);
    expect(parseSettings('"metin"')).toEqual(DEFAULT_VOLUME);
  });

  it('varsayılan müzik sesi düşük (~%40)', () => {
    expect(DEFAULT_VOLUME.music).toBeCloseTo(0.4, 6);
    expect(DEFAULT_VOLUME.muted).toBe(false);
  });

  it('geçerli değerleri korur, aralık dışını kırpar, eksikleri tamamlar', () => {
    expect(parseSettings('{"music":0.2,"sfx":0.9,"muted":true}')).toEqual({ music: 0.2, sfx: 0.9, muted: true });
    expect(parseSettings('{"music":3,"sfx":-1}')).toEqual({ music: 1, sfx: 0, muted: false });
    expect(parseSettings('{"music":"yüksek"}').music).toBe(DEFAULT_VOLUME.music);
  });
});

describe('layerGains', () => {
  it('gerilim 0: yalnız sakin katman; 1: gerilim tam, sakin alttan sürer', () => {
    expect(layerGains(0)).toEqual({ calm: 1, tension: 0 });
    const hi = layerGains(1);
    expect(hi.tension).toBeCloseTo(1, 10);
    expect(hi.calm).toBeCloseTo(0.35, 10);
  });

  it('tekdüze: gerilim arttıkça gerilim katmanı artar, sakin azalır', () => {
    let prev = layerGains(0);
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const g = layerGains(t);
      expect(g.tension).toBeGreaterThan(prev.tension);
      expect(g.calm).toBeLessThan(prev.calm);
      prev = g;
    }
  });

  it('aralık dışı girdiyi kırpar', () => {
    expect(layerGains(-2)).toEqual(layerGains(0));
    expect(layerGains(5)).toEqual(layerGains(1));
  });
});

describe('StrideCounter', () => {
  it('her adım uzunluğunda bir adım üretir, artanı biriktirir', () => {
    const s = new StrideCounter(0.6);
    expect(s.add(0.5)).toBe(0);
    expect(s.add(0.2)).toBe(1); // 0.7
    expect(s.add(0.4)).toBe(0); // 0.1 + 0.4 = 0.5
    expect(s.add(1.3)).toBe(3); // 1.8
  });

  it('durunca/geri dönüşte sıfır ve negatif mesafe adım üretmez', () => {
    const s = new StrideCounter(0.6);
    expect(s.add(0)).toBe(0);
    expect(s.add(-1)).toBe(0);
    expect(s.add(Number.NaN)).toBe(0);
  });
});
