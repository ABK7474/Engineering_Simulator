import { describe, expect, it } from 'vitest';
import { buildLayout, CEILING, CLEAR_PATH, insideAny, MODULE, WALL_INNER } from './layout';

describe('buildLayout', () => {
  const L = buildLayout(7);

  it('koridor uzunluğu modül sayısıyla uyumlu; kapı koridorun sonunda, oda arkasında', () => {
    expect(L.zStart - L.doorZ).toBe(7 * MODULE);
    expect(L.doorZ - L.zEnd).toBe(MODULE);
    const frames = L.placements.filter((p) => p.model === 'Door_Frame_Square');
    expect(frames).toEqual([expect.objectContaining({ z: L.doorZ })]);
  });

  it('her modülde iki yan duvar ve bir tavan var (oda dahil)', () => {
    const walls = L.placements.filter((p) => p.model.startsWith('WallAstra'));
    // 8 modül × 2 yan + 2 uç duvar
    expect(walls).toHaveLength(8 * 2 + 2);
    expect(L.placements.filter((p) => p.model === 'Platform_DarkPlates' && p.flip && p.y === CEILING)).toHaveLength(8);
    expect(walls.filter((p) => p.model === 'WallAstra_Straight_Broken')).toHaveLength(1);
  });

  it('başlangıç noktası ve koridor ekseni boş; dışarısı kapalı', () => {
    expect(insideAny(L.colliders, L.spawn.x, L.spawn.z)).toBe(false);
    expect(insideAny(L.colliders, WALL_INNER + 0.1, -5)).toBe(true);
    expect(insideAny(L.colliders, -(WALL_INNER + 0.1), -5)).toBe(true);
    expect(insideAny(L.colliders, 0, L.zStart + 0.5)).toBe(true);
    expect(insideAny(L.colliders, 0, L.zEnd - 0.5)).toBe(true);
  });

  it('doğma noktasından kapıya kadar ortada en az 2 m engelsiz yol var', () => {
    const half = CLEAR_PATH / 2;
    const blocking = L.colliders.filter(
      (r) => r.maxX > -half && r.minX < half && r.maxZ > L.doorZ + 0.5 && r.minZ < L.spawn.z,
    );
    expect(blocking).toEqual([]);
  });

  it('sandık bir köşede: iki duvara yaslı ve doğma noktasının arkasında', () => {
    const crate = L.placements.find((p) => p.model === 'Prop_Crate')!;
    expect(crate.x - 0.78).toBeCloseTo(-WALL_INNER, 6);
    expect(crate.z + 0.75).toBeCloseTo(L.zStart - (MODULE / 2 - WALL_INNER), 6);
    expect(crate.z).toBeGreaterThan(L.spawn.z);
  });

  it('çarpışma kutuları x ekseninde simetrik kabuk içerir', () => {
    const shell = L.colliders.filter((r) => r.maxZ - r.minZ > 10);
    expect(shell).toHaveLength(2);
    expect(shell[0].maxX).toBe(-shell[1].minX);
  });

  it('panel kapıdan önce, sol duvara yaslı; sızıntı kırık duvarın önünde', () => {
    expect(L.panel.z).toBeGreaterThan(L.doorZ);
    expect(L.panel.x).toBeLessThan(0);
    expect(L.panel.x - 0.22).toBeCloseTo(-WALL_INNER, 6);
    const broken = L.placements.find((p) => p.model === 'WallAstra_Straight_Broken')!;
    expect(L.leak.z).toBe(broken.z);
  });

  it('gerçek ışık sayısı sınırlı (ışık bütçesi)', () => {
    expect(L.lampLights.length).toBeLessThanOrEqual(5);
    expect(L.lampFixtures).toHaveLength(8);
  });

  it('geçersiz modül sayısını reddeder', () => {
    expect(() => buildLayout(2)).toThrow();
    expect(() => buildLayout(3.5)).toThrow();
  });
});
