// Dünya yerleşimi: JSON'daki odalardan (koridor ve gerçek oda) dünya koordinatında model yerleşimleri,
// çarpışma kutuları, kapılar, pencereler, terminal yerleri ve lambalar üretir. Three.js'siz, saf veri;
// görselden ayrı tutulur ki birim testi yazılabilsin. Bütün odalar baştan kurulur (geçişte yükleme yok).

import themesJson from '../../content/world/themes.json';
import type { ModelId } from './catalog';
import { dressRoom, footprint, parseThemes, type RoomDecor, type ThemeId, type WallSlot } from './dressing';
import type { DoorDef, FaultDef, RoomDef, Side, TerminalModel, WorldDef } from './schema';

export type { ModelId } from './catalog';
export const THEMES = parseThemes(themesJson);

/** Quaternius modüler kitinin grid adımı (m). */
export const MODULE = 4;
export const CEILING = 5;
/** Duvar modüllerinin iç yüzeyi (çıkıntılar dahil) hücre merkezinden bu kadar uzakta. */
export const WALL_INNER = 1.55;
/** Duvar iç yüzünün oda sınır çizgisinden içeri girişi. */
export const WALL_DEPTH = MODULE / 2 - WALL_INNER;
/** Köşe kolonunun oda köşesinden iki eksende içeri kayması (duvar iç yüzü WALL_DEPTH'te). */
const CORNER_INSET = 0.4;
/** Köşe dolgusu: köşeden dışarı ve içeri uzanım (iç uç duvar iç yüzünün gerisinde kalır). */
const CORNER_FILL_OUT = 0.8;
const CORNER_FILL_IN = 0.3;
/** Koridor boyunca orta hatta engelsiz kalması gereken genişlik (m). */
export const CLEAR_PATH = 2;

export interface Placement {
  model: ModelId;
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Tavan için modeli X ekseninde ters çevir. */
  flip?: boolean;
  /** Ait olduğu oda (odalara göre gizleme/çizim grupları). */
  room?: string;
}

/** XZ düzleminde dikdörtgen; isteğe bağlı yükseklik aralığı (yoksa yerden tavana). */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Alt kenar (m). Gövdeden yüksekse altından geçilir (ör. duvar terminali). */
  minY?: number;
  maxY?: number;
  /** Çakışma denetimi için tür. */
  tag?: 'wall' | 'column' | 'prop' | 'terminal';
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** Odası belli nokta (lamba, ışık). */
export interface RoomPoint extends Point {
  room: string;
}

export interface RoomLayout {
  def: RoomDef;
  rect: Rect;
}

export interface DoorLayout {
  def: DoorDef;
  x: number;
  z: number;
  /** Kapı düzleminin dönüşü: 0 = kuzey/güney duvarında, π/2 = doğu/batı duvarında. */
  rotY: number;
  /** Kapalıyken geçişi kapatan kutu. */
  collider: Rect;
}

export interface TerminalLayout {
  fault: FaultDef;
  model: TerminalModel;
  x: number;
  z: number;
  rotY: number;
  collider: Rect;
}

export interface WindowLayout {
  roomId: string;
  side: Side;
  /** Duvar hücresinin oda sınırındaki orta noktası. */
  x: number;
  z: number;
  /** Dışa doğru birim normal. */
  nx: number;
  nz: number;
}

export interface WorldLayout {
  world: WorldDef;
  rooms: RoomLayout[];
  placements: Placement[];
  colliders: Rect[];
  doors: DoorLayout[];
  terminals: TerminalLayout[];
  windows: WindowLayout[];
  lampFixtures: RoomPoint[];
  lampLights: RoomPoint[];
  leaks: Point[];
  /** Oda başına görsel süsler: kir/pas, tabela, ekran, buhar/damla kaynakları, sıcak vurgu noktaları. */
  decor: RoomDecor[];
  /** Titreyen lamba armatürlerinin `lampFixtures` dizinleri. */
  flicker: number[];
  /** Oda köşelerinin arkasındaki opak dolgu blokları (tabandan tavana). */
  cornerFills: Rect[];
  bounds: Rect;
}

// ---------------------------------------------------------------- geometri yardımcıları

const { PI } = Math;
/** Duvar modelleri batı (−x) tarafa göre modellenmiş; diğer taraflar Y ekseninde döndürülerek elde edilir. */
export const SIDE_ROT: Record<Side, number> = { west: 0, east: PI, north: PI / 2, south: -PI / 2 };
/** Odanın içine bakan birim normal. */
export const INWARD: Record<Side, [number, number]> = { west: [1, 0], east: [-1, 0], north: [0, -1], south: [0, 1] };
export const OPPOSITE: Record<Side, Side> = { west: 'east', east: 'west', north: 'south', south: 'north' };

export function roomRect(r: RoomDef): Rect {
  const [x0, z0] = r.origin;
  return { minX: x0, maxX: x0 + MODULE * r.size[0], minZ: z0 - MODULE * r.size[1], maxZ: z0 };
}

export const cellCount = (r: RoomDef, side: Side) => (side === 'north' || side === 'south' ? r.size[0] : r.size[1]);

/** Duvar hücresinin oda sınırındaki orta noktası. Dizin: kuzey/güneyde batıdan, doğu/batıda kuzeyden. */
export function edgeMid(r: RoomDef, side: Side, k: number): [number, number] {
  const rc = roomRect(r);
  switch (side) {
    case 'north':
      return [rc.minX + MODULE * (k + 0.5), rc.maxZ];
    case 'south':
      return [rc.minX + MODULE * (k + 0.5), rc.minZ];
    case 'west':
      return [rc.minX, rc.maxZ - MODULE * (k + 0.5)];
    case 'east':
      return [rc.maxX, rc.maxZ - MODULE * (k + 0.5)];
  }
}

/** Duvar hücresine komşu iç hücrenin merkezi (duvar modeli buraya, SIDE_ROT ile konur). */
export function cellCenter(r: RoomDef, side: Side, k: number): [number, number] {
  const [ex, ez] = edgeMid(r, side, k);
  const [nx, nz] = INWARD[side];
  return [ex + nx * (MODULE / 2), ez + nz * (MODULE / 2)];
}

/** Başka bir odanın aynı kenarı paylaşan duvar hücresi (kapı komşuluğu). */
export function neighborCell(rooms: readonly RoomDef[], self: RoomDef, side: Side, k: number): { room: RoomDef; side: Side; index: number } | null {
  const [ex, ez] = edgeMid(self, side, k);
  const opp = OPPOSITE[side];
  for (const o of rooms) {
    if (o.id === self.id) continue;
    for (let j = 0; j < cellCount(o, opp); j++) {
      const [ox, oz] = edgeMid(o, opp, j);
      if (Math.abs(ox - ex) < 1e-6 && Math.abs(oz - ez) < 1e-6) return { room: o, side: opp, index: j };
    }
  }
  return null;
}

/** Duvar hücresinin çarpışma kutusu: iç yüzden dışarıya 1 m. */
function wallRect(r: RoomDef, side: Side, k: number): Rect {
  const [ex, ez] = edgeMid(r, side, k);
  const h = MODULE / 2;
  switch (side) {
    case 'west':
      return { minX: ex - 1, maxX: ex + WALL_DEPTH, minZ: ez - h, maxZ: ez + h };
    case 'east':
      return { minX: ex - WALL_DEPTH, maxX: ex + 1, minZ: ez - h, maxZ: ez + h };
    case 'north':
      return { minX: ex - h, maxX: ex + h, minZ: ez - WALL_DEPTH, maxZ: ez + 1 };
    case 'south':
      return { minX: ex - h, maxX: ex + h, minZ: ez - 1, maxZ: ez + WALL_DEPTH };
  }
}

const rect = (cx: number, cz: number, hx: number, hz: number): Rect => ({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz });

/** Duvardaki bir noktanın önünde, odaya doğru `depth` derinliğinde, duvar boyunca ±`half` genişliğinde bölge. */
function bandRect(ex: number, ez: number, ax: number, az: number, nx: number, nz: number, half: number, depth: number): Rect {
  const xs = [ex - ax * half, ex + ax * half, ex - ax * half + nx * depth, ex + ax * half + nx * depth];
  const zs = [ez - az * half, ez + az * half, ez - az * half + nz * depth, ez + az * half + nz * depth];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Terminal modelleri: duvara yaslanma biçimi ve çarpışma kutusu. */
export const TERMINAL_SPEC: Record<TerminalModel, { back: 'x' | 'z'; backDepth: number; alongHalf: number; depth: number; minY?: number; maxY?: number }> = {
  // Duvar terminali: arkası modelin −x yüzü; yerden 1,1 m yukarıda başlar (eğilen altından geçer).
  Prop_AccessPoint: { back: 'x', backDepth: 0.22, alongHalf: 0.66, depth: 0.44, minY: 1.1, maxY: 1.6 },
  // Ayakta duran konsol: arkası modelin −z yüzü; ekranı +z'ye bakar.
  Prop_Computer: { back: 'z', backDepth: 0.22, alongHalf: 0.37, depth: 0.57 },
};

export function along(side: Side): [number, number] {
  return side === 'north' || side === 'south' ? [1, 0] : [0, -1];
}

/** Terminalin model kökü, dönüşü ve çarpışma kutusu. */
export function placeTerminal(r: RoomDef, f: FaultDef): { x: number; z: number; rotY: number; collider: Rect } {
  const { wall, index, along: t } = f.anchor;
  const spec = TERMINAL_SPEC[f.model];
  const [ex, ez] = edgeMid(r, wall, index);
  const [ax, az] = along(wall);
  const [nx, nz] = INWARD[wall];
  // Hücre içinde konum (t = 0 hücrenin başı, 1 sonu), duvar iç yüzünde
  const fx = ex + ax * MODULE * (t - 0.5) + nx * WALL_DEPTH;
  const fz = ez + az * MODULE * (t - 0.5) + nz * WALL_DEPTH;
  const x = fx + nx * spec.backDepth;
  const z = fz + nz * spec.backDepth;
  // Modelin arka ekseni duvara (−n) bakacak şekilde dönüş
  // `+ 0`: atan2(−0, 1) = −0'ı 0'a çevirir
  const rotY = (spec.back === 'x' ? Math.atan2(-nz, nx) : Math.atan2(nx, nz)) + 0;
  const cx = fx + nx * (spec.depth / 2);
  const cz = fz + nz * (spec.depth / 2);
  const [hx, hz] = ax !== 0 ? [spec.alongHalf, spec.depth / 2] : [spec.depth / 2, spec.alongHalf];
  return { x, z, rotY, collider: { ...rect(cx, cz, hx, hz), ...(spec.minY !== undefined ? { minY: spec.minY, maxY: spec.maxY } : {}) } };
}

/** Bir noktanın bulunduğu oda (yoksa null). */
export function roomAt(L: Pick<WorldLayout, 'rooms'>, x: number, z: number): string | null {
  const r = L.rooms.find(({ rect: c }) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ);
  return r?.def.id ?? null;
}

export function insideAny(rects: readonly Rect[], x: number, z: number): boolean {
  return rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}

// ---------------------------------------------------------------- üretici

export function buildWorldLayout(world: WorldDef, opts: { trace?: string[] } = {}): WorldLayout {
  const P: Placement[] = [];
  const colliders: Rect[] = [];
  const windows: WindowLayout[] = [];
  const lampFixtures: RoomPoint[] = [];
  const lampLights: RoomPoint[] = [];
  const decor: RoomDecor[] = [];
  const flicker: number[] = [];
  let curRoom: string | undefined;
  const leaks: Point[] = [];
  const cornerFills: Rect[] = [];
  const add = (model: ModelId, x: number, y: number, z: number, rotY = 0, flip = false) =>
    P.push({ model, x, y, z, rotY, ...(flip ? { flip } : {}), ...(curRoom ? { room: curRoom } : {}) });

  // Kapı hücreleri (her iki odada da duvar konmaz)
  const doorCells = new Set<string>();
  const doors: DoorLayout[] = world.doors.map((d) => {
    const a = world.rooms.find((r) => r.id === d.at.room)!;
    const [x, z] = edgeMid(a, d.at.wall, d.at.index);
    doorCells.add(`${a.id}/${d.at.wall}/${d.at.index}`);
    const nb = neighborCell(world.rooms, a, d.at.wall, d.at.index);
    if (nb) doorCells.add(`${nb.room.id}/${nb.side}/${nb.index}`);
    const ns = d.at.wall === 'north' || d.at.wall === 'south';
    add('Door_Frame_Square', x, 0, z, ns ? 0 : PI / 2);
    return { def: d, x, z, rotY: ns ? 0 : PI / 2, collider: ns ? rect(x, z, 2, 0.15) : rect(x, z, 0.15, 2) };
  });

  // Terminaller
  const terminals: TerminalLayout[] = world.faults.map((f) => {
    const room = world.rooms.find((r) => r.id === f.room)!;
    const t = placeTerminal(room, f);
    curRoom = room.id;
    add(f.model, t.x, 0, t.z, t.rotY);
    curRoom = undefined;
    colliders.push({ ...t.collider, tag: 'terminal' });
    return { fault: f, model: f.model, ...t };
  });

  const rooms: RoomLayout[] = world.rooms.map((r) => {
    const rc = roomRect(r);
    const [w, d] = r.size;
    curRoom = r.id;
    const firstCollider = colliders.length;
    const slots: WallSlot[] = [];
    const cells: { x: number; z: number }[] = [];
    const lampStart = lampFixtures.length;
    // Tavan, lamba armatürleri
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        const cx = rc.minX + MODULE * (i + 0.5);
        const cz = rc.maxZ - MODULE * (j + 0.5);
        add('Platform_DarkPlates', cx, CEILING, cz, 0, true);
        add('Prop_Light_Wide', cx + MODULE / 6, CEILING, cz);
        lampFixtures.push({ x: cx, y: CEILING - 0.12, z: cz, room: r.id });
        cells.push({ x: cx, z: cz });
      }
    }
    // Gerçek ışıklar: koridorda iki modülde bir; odada en fazla iki
    if (r.type === 'corridor') {
      for (let j = 0; j < d; j += 2) lampLights.push({ x: rc.minX + MODULE / 2, y: CEILING - 0.6, z: rc.maxZ - MODULE * (j + 0.5), room: r.id });
    } else {
      const long = w >= d;
      for (const f of [0.28, 0.72]) {
        lampLights.push({
          x: long ? rc.minX + (rc.maxX - rc.minX) * f : (rc.minX + rc.maxX) / 2,
          y: CEILING - 0.6,
          z: long ? (rc.minZ + rc.maxZ) / 2 : rc.minZ + (rc.maxZ - rc.minZ) * f,
          room: r.id,
        });
      }
    }

    // Duvarlar
    for (const side of ['north', 'south', 'east', 'west'] as Side[]) {
      const spec = r.walls[side] ?? {};
      for (let k = 0; k < cellCount(r, side); k++) {
        if (doorCells.has(`${r.id}/${side}/${k}`)) continue;
        const [cx, cz] = cellCenter(r, side, k);
        const rot = SIDE_ROT[side];
        const isWindow = spec.windows?.includes(k);
        const wall: ModelId = spec.broken?.includes(k) ? 'WallAstra_Straight_Broken' : isWindow ? 'WallAstra_Straight_Window' : 'WallAstra_Straight';
        add(wall, cx, 0, cz, rot);
        add(spec.hangingCables?.includes(k) ? 'TopCables_Straight_Hanging' : 'TopCables_Straight', cx, 0, cz, rot);
        add('BottomMetal_Straight', cx, 0, cz, rot);
        colliders.push({ ...wallRect(r, side, k), tag: 'wall' });
        const [ex, ez] = edgeMid(r, side, k);
        const [nx, nz] = INWARD[side];
        if (isWindow) windows.push({ roomId: r.id, side, x: ex, z: ez, nx: -nx, nz: -nz });
        if (spec.broken?.includes(k)) leaks.push({ x: ex + nx * WALL_DEPTH, y: 1.2, z: ez + nz * WALL_DEPTH });
        const [ax, az] = along(side);
        slots.push({ side, index: k, x: ex + nx * WALL_DEPTH, z: ez + nz * WALL_DEPTH, ax, az, nx, nz, window: Boolean(isWindow), broken: Boolean(spec.broken?.includes(k)) });
      }
    }

    // Köşe kolonları: iki düz duvar köşede birleşmez, aradaki kamadan dışarısı görünür. Köşe modülü
    // pencereli köşe hücreleriyle uyuşmadığından köşeyi 45° döndürülmüş bir kolon kapatır.
    const [w0, d0] = [w - 1, d - 1];
    for (const [cx, sx, cz, sz, cells] of [
      [rc.minX, 1, rc.maxZ, -1, ['north/0', 'west/0']],
      [rc.maxX, -1, rc.maxZ, -1, [`north/${w0}`, 'east/0']],
      [rc.minX, 1, rc.minZ, 1, ['south/0', `west/${d0}`]],
      [rc.maxX, -1, rc.minZ, 1, [`south/${w0}`, `east/${d0}`]],
    ] as const) {
      if (cells.some((c) => doorCells.has(`${r.id}/${c}`))) continue; // kapı çerçevesi köşeyi zaten kapatır
      const x = cx + sx * CORNER_INSET;
      const z = cz + sz * CORNER_INSET;
      add('Column_Simple', x, 0, z, sx === sz ? -PI / 4 : PI / 4);
      // Kolonun yanından da görünmesin: köşenin dış tarafını duvar kalınlığı içinde opak blok doldurur.
      const [ax, bx] = [cx - sx * CORNER_FILL_OUT, cx + sx * CORNER_FILL_IN];
      const [az, bz] = [cz - sz * CORNER_FILL_OUT, cz + sz * CORNER_FILL_IN];
      cornerFills.push({ minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) });
      colliders.push({ ...rect(x, z, 0.3, 0.3), tag: 'column' });
    }

    // Koridor süsü: iki modülde bir iki yanda kolon (kaburga)
    if (r.type === 'corridor') {
      for (let j = 2; j < d; j += 2) {
        const z = rc.maxZ - MODULE * j;
        for (const s of [-1, 1]) {
          const x = (rc.minX + rc.maxX) / 2 + s * (WALL_INNER - 0.25);
          add('Column_Simple', x, 0, z);
          colliders.push({ ...rect(x, z, 0.25, 0.5), tag: 'column' });
        }
      }
    }

    // Eşyalar
    for (const pr of r.props) {
      const x = rc.minX + pr.u;
      const z = rc.maxZ - pr.v;
      add(pr.model as ModelId, x, pr.model === 'Prop_Vent_Wide' ? 0.001 : 0, z, pr.rotY);
      const f = footprint(pr.model as ModelId, x, z, pr.rotY);
      if (f) colliders.push(f);
    }

    // Tema giydirmesi: duvar boyu setler, tavan, zemin, süsler. Kapı önü, terminal önü ve giriş boş kalır.
    const keepOut: Rect[] = [];
    for (const key of doorCells) {
      const [rid, side, idx] = key.split('/');
      if (rid !== r.id) continue;
      const [ex, ez] = edgeMid(r, side as Side, Number(idx));
      const [nx, nz] = INWARD[side as Side];
      const [ax, az] = along(side as Side);
      keepOut.push(bandRect(ex, ez, ax, az, nx, nz, 1.4, 2.6));
    }
    for (const t of terminals.filter((x) => x.fault.room === r.id)) {
      const [ex, ez] = edgeMid(r, t.fault.anchor.wall, t.fault.anchor.index);
      const [nx, nz] = INWARD[t.fault.anchor.wall];
      const [ax, az] = along(t.fault.anchor.wall);
      const tx = t.x - nx * TERMINAL_SPEC[t.model].backDepth;
      const tz = t.z - nz * TERMINAL_SPEC[t.model].backDepth;
      keepOut.push(bandRect(ex + ax * ((tx - ex) * ax + (tz - ez) * az), ez + az * ((tx - ex) * ax + (tz - ez) * az), ax, az, nx, nz, 1.2, 2.2));
    }
    keepOut.push(rect(r.entrance.x, r.entrance.z, 0.9, 0.9));
    const theme = THEMES[(r.theme ?? (r.type === 'corridor' ? 'corridor' : 'control')) as ThemeId];
    const dressed = dressRoom({
      room: r,
      rect: rc,
      theme,
      slots,
      blocked: colliders.slice(firstCollider).filter((c) => c.tag !== 'wall').concat(terminals.filter((x) => x.fault.room === r.id).map((x) => x.collider)),
      keepOut,
      cells,
      ceiling: CEILING,
      maxDepth: r.type === 'corridor' ? (2 * WALL_INNER - CLEAR_PATH) / 2 : 2.4,
      lampIndices: Array.from({ length: lampFixtures.length - lampStart }, (_, k) => lampStart + k),
      trace: opts.trace,
    });
    P.push(...dressed.placements);
    colliders.push(...dressed.colliders);
    decor.push(dressed.decor);
    flicker.push(...dressed.flicker);
    curRoom = undefined;
    return { def: r, rect: rc };
  });

  // Kapı üstü tabelalar: her iki yüzde, kapının açıldığı odanın adı
  for (const d of doors) {
    const a = world.rooms.find((r) => r.id === d.def.at.room)!;
    const nb = neighborCell(world.rooms, a, d.def.at.wall, d.def.at.index);
    if (!nb) continue;
    for (const [here, side, there] of [
      [a, d.def.at.wall, nb.room],
      [nb.room, nb.side, a],
    ] as const) {
      const [nx, nz] = INWARD[side];
      const dec = decor.find((x) => x.room === here.id)!;
      const t = THEMES[(there.theme ?? (there.type === 'corridor' ? 'corridor' : 'control')) as ThemeId];
      dec.signs.push({ x: d.x + nx * 0.32, y: 4.5, z: d.z + nz * 0.32, rotY: Math.atan2(nx, nz), w: 1.7, h: 0.5, title: there.name.toLocaleUpperCase('tr'), sub: `→ ${t.label}`, kind: 'room' });
    }
  }

  const bounds = rooms.reduce<Rect>(
    (b, { rect: c }) => ({ minX: Math.min(b.minX, c.minX), maxX: Math.max(b.maxX, c.maxX), minZ: Math.min(b.minZ, c.minZ), maxZ: Math.max(b.maxZ, c.maxZ) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );

  return { world, rooms, placements: P, colliders, doors, terminals, windows, lampFixtures, lampLights, leaks, decor, flicker, cornerFills, bounds };
}
