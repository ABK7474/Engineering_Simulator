import { describe, expect, it } from 'vitest';
import { ASCENT_SECONDS, creatureAt, depthAt, FOLLOW_STOP, followStop, lightsAt, riseAt, RISE, START_DEPTH, timeForDepth, waterAt } from './ascent';

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('yükseliş eğrisi', () => {
  it('221 m\'den başlar, sürenin sonunda yüzeydedir; tekdüze ve sıçramasız', () => {
    expect(depthAt(0)).toBe(START_DEPTH);
    expect(depthAt(ASCENT_SECONDS)).toBe(0);
    expect(depthAt(ASCENT_SECONDS + 10)).toBe(0);
    let prev = depthAt(0);
    for (let t = 0.1; t <= ASCENT_SECONDS; t += 0.1) {
      const d = depthAt(t);
      expect(d).toBeLessThanOrEqual(prev);
      expect(prev - d).toBeLessThan(0.6); // 0,1 sn'de en çok ~0,45 m
      prev = d;
    }
  });

  it('kalkış yavaş, sonra sabit hız: ilk 15 m birkaç saniyede', () => {
    expect(depthAt(1)).toBeGreaterThan(START_DEPTH - 2);
    expect(timeForDepth(205)).toBeLessThan(7);
  });

  it('ters fonksiyon tutarlı', () => {
    for (const d of [221, 210, 205, 150, 60, 55, 4, 0]) expect(depthAt(timeForDepth(d))).toBeCloseTo(d, 6);
  });

  it('dünyadaki yükseklik derinlikle orantılı', () => {
    expect(riseAt(START_DEPTH)).toBe(0);
    expect(riseAt(0)).toBe(RISE);
  });
});

describe('derinliğe göre su', () => {
  it('istasyon derinliğinde varsayılan su (exterior.ts ile aynı)', () => {
    const w = waterAt(START_DEPTH);
    expect(w.top.map((v) => Math.round(v * 255))).toEqual([0x3f, 0xb8, 0xc4]);
    expect(w.bottom.map((v) => Math.round(v * 255))).toEqual([0x02, 0x0f, 0x17]);
    expect(w.density).toBe(0.045);
  });

  it('yükseldikçe aydınlanır, sis seyrelir', () => {
    let prev = waterAt(START_DEPTH);
    for (let d = START_DEPTH - 10; d >= 0; d -= 10) {
      const w = waterAt(d);
      expect(lum(w.top)).toBeGreaterThan(lum(prev.top));
      expect(lum(w.bottom)).toBeGreaterThan(lum(prev.bottom));
      expect(w.density).toBeLessThan(prev.density);
      prev = w;
    }
  });
});

describe('istasyon ışıkları', () => {
  it('başta hepsi yanık, sonda hepsi sönük', () => {
    expect(lightsAt(0)).toEqual({ windows: 1, guides: 1, beacon: true });
    expect(lightsAt(1)).toEqual({ windows: 0, guides: 0, beacon: false });
  });

  it('kademeli: titremeler dışında pencere parıltısı artmaz', () => {
    let prev = 1;
    for (let k = 0; k <= 1; k += 0.01) {
      const w = lightsAt(k).windows;
      const flickering = [0.18, 0.42, 0.63, 0.82].some((s) => k > s - 0.035 && k < s - 0.015);
      if (!flickering) {
        expect(w).toBeLessThanOrEqual(prev + 1e-9);
        prev = w;
      }
    }
  });
});

describe('yaratığın takibi', () => {
  // Kapsül 1,35 m/sn yükselir; takip 19 sn sürer; taban y = −1
  const o = { floorY: -1, side: [0.8, 0.6] as [number, number] };
  const capAt = (u: number) => ({ x: 6, y: 22 + 1.35 * 19 * u, z: -50 });
  const stop = followStop(capAt(FOLLOW_STOP), o);
  const poses = Array.from({ length: 201 }, (_, i) => {
    const u = i / 200;
    return { u, cap: capAt(u), p: creatureAt(u, capAt(u), o, stop) };
  });
  const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  it('kapsüle 12 m\'den fazla yaklaşmaz, tabanın altına inmez', () => {
    for (const { cap, p } of poses) {
      expect(dist(cap, p)).toBeGreaterThanOrEqual(12);
      expect(p.y).toBeGreaterThanOrEqual(o.floorY + 3);
    }
  });

  it('durunca yükselmez; sonunda aşağıda ve uzakta kalır (sise karışır)', () => {
    const after = poses.filter((x) => x.u >= FOLLOW_STOP);
    for (let i = 1; i < after.length; i++) expect(after[i].p.y).toBeLessThanOrEqual(after[i - 1].p.y + 1e-9);
    const last = poses[poses.length - 1];
    expect(last.p.y).toBeLessThan(stop.y);
    expect(dist(last.cap, last.p)).toBeGreaterThan(40);
  });

  it('yaklaşırken burun yukarı, ayrılırken aşağı', () => {
    expect(creatureAt(0.2, capAt(0.2), o, stop).pitch).toBeGreaterThan(0.3);
    expect(creatureAt(0.9, capAt(0.9), o, stop).pitch).toBeLessThan(-0.3);
  });
});
