// Duvara yapışan dekor (süs, kir/pas izi, ekran, uyarı levhası) önündeki eşyaya, terminale ya da kolona binmemeli:
// aksi hâlde dolabın içinden çıkan ızgara ya da sütunun önünde havada asılı pas izi görünür.
import { describe, expect, it } from 'vitest';
import { loadWorld } from './content';
import { GREEBLE_HALF, PILASTER, wallSurface } from './dressing';
import { MODULE } from './layout';
import type { Rect } from './layout';

type Item = { what: string; x: number; z: number; rotY: number; half: number; y0: number; y1: number };

/** Duvar yüzeyindeki ince kutu (duvardan 0,12 m'ye kadar) ve eşyalar aynı yükseklik bandında kesişiyor mu. */
function clashes(it: Item, f: Rect): boolean {
  const nx = Math.sin(it.rotY);
  const nz = Math.cos(it.rotY);
  const [ax, az] = [nz, -nx];
  const xs = [it.x + ax * it.half, it.x - ax * it.half, it.x + ax * it.half + nx * 0.12, it.x - ax * it.half + nx * 0.12];
  const zs = [it.z + az * it.half, it.z - az * it.half, it.z + az * it.half + nz * 0.12, it.z - az * it.half + nz * 0.12];
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const xz = box.minX < f.maxX - 0.02 && box.maxX > f.minX + 0.02 && box.minZ < f.maxZ - 0.02 && box.maxZ > f.minZ + 0.02;
  return xz && it.y0 < (f.maxY ?? 5) && it.y1 > (f.minY ?? 0);
}

describe('duvar dekoru', () => {
  it('süs, iz, ekran ve levhalar eşyalara, terminallere ve kolonlara binmiyor', () => {
    const { layout: L } = loadWorld(undefined, undefined, undefined, { verifySeeds: 0 });
    const solids = L.colliders.filter((c) => c.tag !== 'wall');
    const items: Item[] = [];
    for (const p of L.placements) {
      const h = GREEBLE_HALF[p.model];
      if (h) items.push({ what: `${p.room}/${p.model}`, x: p.x, z: p.z, rotY: p.rotY, half: h[0], y0: p.y - h[1], y1: p.y + h[1] });
    }
    for (const d of L.decor) {
      for (const g of d.grime) if (!g.floor) items.push({ what: `${d.room}/iz`, x: g.x, z: g.z, rotY: g.rotY, half: g.w / 2, y0: g.y - g.h / 2, y1: g.y + g.h / 2 });
      for (const sc of d.screens) items.push({ what: `${d.room}/ekran`, x: sc.x, z: sc.z, rotY: sc.rotY, half: sc.w / 2, y0: sc.y - sc.h / 2, y1: sc.y + sc.h / 2 });
      for (const s of d.signs) if (s.kind === 'warning') items.push({ what: `${d.room}/levha ${s.title}`, x: s.x, z: s.z, rotY: s.rotY, half: s.w / 2, y0: s.y - s.h / 2, y1: s.y + s.h / 2 });
    }
    expect(items.length).toBeGreaterThan(30);
    const bad = items.flatMap((it) => solids.filter((f) => clashes(it, f)).map((f) => `${it.what} ↔ ${JSON.stringify(f)} @ ${it.x.toFixed(2)},${it.y0.toFixed(2)},${it.z.toFixed(2)}`));
    expect(bad).toEqual([]);
  });

  it('duvar dekoru havada değil: yüksekliğine göre yatık duvar yüzeyinde, pilasterin dışında', () => {
    const { layout: L } = loadWorld(undefined, undefined, undefined, { verifySeeds: 0 });
    const bad: string[] = [];
    const check = (what: string, room: string | undefined, x: number, y: number, z: number, rotY: number, half: number, lift: number) => {
      const r = L.rooms.find((q) => q.def.id === room)!.rect;
      const nx = Math.round(Math.sin(rotY));
      const nz = Math.round(Math.cos(rotY));
      // Bakılan duvar çizgisi (oda sınırı) ve hücre merkezi: yüzey sınırın wallSurface − MODULE/2 gerisinde
      const edge = nx > 0 ? r.minX : nx < 0 ? r.maxX : nz > 0 ? r.minZ : r.maxZ;
      const pos = nx !== 0 ? x : z;
      const dir = nx !== 0 ? nx : nz;
      const expected = edge - dir * (wallSurface(y) - MODULE / 2) + dir * lift;
      if (Math.abs(pos - expected) > 0.03) bad.push(`${what}: duvardan ${((pos - expected) * dir).toFixed(2)} m`);
      // Hücre içindeki konum: pilasterin (hücre ortası) üstüne binmesin
      const along = nx !== 0 ? z : x;
      const lo = nx !== 0 ? r.minZ : r.minX;
      const c = ((((along - lo) % MODULE) + MODULE) % MODULE) - MODULE / 2;
      if (Math.abs(c) < PILASTER + half - 1e-6) bad.push(`${what}: pilasterin üstünde`);
    };
    for (const p of L.placements) {
      const h = GREEBLE_HALF[p.model];
      if (h) check(`${p.room}/${p.model}`, p.room, p.x, p.y, p.z, p.rotY, h[0], 0.03);
    }
    for (const d of L.decor) {
      for (const g of d.grime) if (!g.floor) check(`${d.room}/iz`, d.room, g.x, g.y, g.z, g.rotY, g.w / 2, 0.012);
      for (const s of d.signs) if (s.kind === 'warning') check(`${d.room}/levha`, d.room, s.x, s.y, s.z, s.rotY, s.w / 2, 0.02);
      for (const sc of d.screens) check(`${d.room}/ekran`, d.room, sc.x, sc.y, sc.z, sc.rotY, sc.w / 2, 0.02);
    }
    expect(bad).toEqual([]);
  });
});
