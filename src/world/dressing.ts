// Oda giydirme: temaya göre (content/world/themes.json) duvar boylarına eşya setleri, tavan boruları/fanları,
// zemin kabloları, duvar süsleri, kir/pas izleri, tabelalar, ekranlar, buhar/damla kaynakları ve titreyen
// lambalar üretir. Saf veri ve deterministik (oda kimliğinden tohum); görseli hub/atmosphere.ts çizer.
// Yerleşim (layout.ts) ona hazır duvar yuvaları ve yasak bölgeler verir; eşyalar yalnız duvara yaslanır,
// her aday mevcut çarpışma kutuları ve yasak bölgelerle çakışmıyorsa konur. Yürünebilirlik walk.ts'te sınanır.

import { createRng, pick, shuffle, type Rng } from '../core/rng';
import { MODELS, type ModelId, type ModelSpec } from './catalog';
import type { Placement, Point, Rect } from './layout';
import type { RoomDef, Side } from './schema';

export type WallSet = 'barrels' | 'locker' | 'shelves' | 'desk' | 'crates' | 'tarp' | 'chest' | 'pipeRack' | 'pipeColumn' | 'greebles' | 'screen' | 'none';
export const WALL_SETS: readonly WallSet[] = ['barrels', 'locker', 'shelves', 'desk', 'crates', 'tarp', 'chest', 'pipeRack', 'pipeColumn', 'greebles', 'screen', 'none'];

export interface Theme {
  label: string;
  /** Odanın karakterini garanti eden setler: önce bunlar, sığdıkları ilk yuvaya konur. */
  required: WallSet[];
  /** Duvar setlerinin ağırlıkları. */
  wall: Partial<Record<WallSet, number>>;
  ceiling: { pipes: number; fan: number; vent: number };
  floor: { cables: number; floorLight: number };
  /** Duvar hücresi başına kir/pas izi olasılığı. */
  grime: number;
  /** Lamba başına titreme olasılığı. */
  flicker: number;
  emitters: { steam: number; drip: number; gas: number };
  /** İç sütun ızgarası (ör. çekirdek odası). */
  columns?: boolean;
  /** Uyarı levhaları: [başlık, alt satır]. */
  warnings: [string, string][];
}

export type ThemeId = 'corridor' | 'control' | 'power' | 'airlock' | 'sensor' | 'core';
export const THEME_IDS: readonly ThemeId[] = ['corridor', 'control', 'power', 'airlock', 'sensor', 'core'];

export function parseThemes(raw: unknown): Record<ThemeId, Theme> {
  const o = raw as Record<string, Theme>;
  const errors: string[] = [];
  for (const id of THEME_IDS) {
    const t = o?.[id];
    if (!t) {
      errors.push(`tema '${id}' yok`);
      continue;
    }
    for (const k of [...Object.keys(t.wall ?? {}), ...(t.required ?? [])]) if (!WALL_SETS.includes(k as WallSet)) errors.push(`tema '${id}': bilinmeyen duvar seti '${k}'`);
    if (!Array.isArray(t.required)) errors.push(`tema '${id}': required dizi olmalı`);
    const p01 = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1;
    if (![t.ceiling?.pipes, t.ceiling?.fan, t.ceiling?.vent, t.floor?.cables, t.floor?.floorLight, t.grime, t.flicker].every(p01)) errors.push(`tema '${id}': olasılıklar 0–1 olmalı`);
    if (!Array.isArray(t.warnings) || !t.warnings.every((w) => Array.isArray(w) && w.length === 2 && w.every((s) => typeof s === 'string'))) errors.push(`tema '${id}': warnings [başlık, alt] listesi olmalı`);
  }
  if (errors.length) throw new Error(`Tema dosyası geçersiz:\n- ${errors.join('\n- ')}`);
  return o as Record<ThemeId, Theme>;
}

/** Duvar hücresinin iç yüzündeki orta nokta ve yönler (yerleşim hesaplar). */
export interface WallSlot {
  side: Side;
  index: number;
  /** İç yüzün hücre ortasındaki noktası. */
  x: number;
  z: number;
  /** Duvar boyunca birim vektör ve odaya bakan birim normal. */
  ax: number;
  az: number;
  nx: number;
  nz: number;
  window: boolean;
  broken: boolean;
  /**
   * Komşu odayla ortak duvar: yatık panel sınırın ötesine, komşunun hacmine taşar. Bu yüzden 3B süs ve ekran
   * konmaz (komşudan havada görünürdü); tek yüzlü iz/levha komşunun köşe kolonlarından uzak durur.
   */
  shared?: boolean;
}

export type GrimeKind = 'rust' | 'drip' | 'water' | 'dirt';
export interface Grime {
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Yatık duvar paneline uyan geriye eğim (radyan; yoksa dikey). */
  tilt?: number;
  w: number;
  h: number;
  kind: GrimeKind;
  /** Zemindeki leke (yatay). */
  floor?: boolean;
  /** Doku varyantı (0–3). */
  variant: number;
}
export interface Sign {
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Yatık duvar paneline uyan geriye eğim (radyan; yoksa dikey). */
  tilt?: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  kind: 'room' | 'warning';
}
export type ScreenKind = 'wave' | 'text' | 'graph' | 'sonar';
export interface Screen {
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Yatık duvar paneline uyan geriye eğim (radyan; yoksa dikey). */
  tilt?: number;
  w: number;
  h: number;
  kind: ScreenKind;
}
export type EmitterKind = 'steam' | 'drip' | 'gas';
export interface Emitter {
  kind: EmitterKind;
  x: number;
  y: number;
  z: number;
  /** Buhar/gaz çıkış yönü (birim). */
  dx: number;
  dy: number;
  dz: number;
}

export interface RoomDecor {
  room: string;
  grime: Grime[];
  signs: Sign[];
  screens: Screen[];
  emitters: Emitter[];
  /** Sıcak vurgu ışığı adayları (ekranlar). */
  accents: Point[];
}

export interface DressInput {
  room: RoomDef;
  rect: Rect;
  theme: Theme;
  slots: WallSlot[];
  /** Odadaki mevcut çarpışma kutuları (kolon, terminal, elle konmuş eşya). */
  blocked: Rect[];
  /** Boş kalması gereken bölgeler (kapı önü, terminal önü, giriş). */
  keepOut: Rect[];
  /** Tavan modüllerinin merkezleri. */
  cells: { x: number; z: number }[];
  /** Tavandaki sabit parçalar (lamba armatürleri): tavan dekoru bunlara binmez. */
  ceilingBlocked?: Rect[];
  /** Duvar yuvasının (çarpışma yüzü) hücre merkezinden uzaklığı; duvara yaslanan dekor gerçek yüzeye göre konur. */
  wallInner: number;
  ceiling: number;
  /** Duvardan içeri en fazla bu kadar derin eşya (koridorda orta yol serbest kalsın). */
  maxDepth: number;
  /** Odanın lamba armatürlerinin genel dizideki dizinleri (titreme seçimi). */
  lampIndices: number[];
  /** Hata ayıklama: reddedilen setlerin nedenleri buraya yazılır. */
  trace?: string[];
}

export interface DressOutput {
  placements: Placement[];
  colliders: Rect[];
  decor: RoomDecor;
  flicker: number[];
}

// ---------------------------------------------------------------- yardımcılar

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const overlap = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Modelin taban kutusunun dönmüş hâlinin eksen hizalı kutusu (dünya). */
export function footprint(model: ModelId, x: number, z: number, rotY: number): Rect | null {
  const box = (MODELS[model] as ModelSpec).box;
  if (!box) return null;
  return { ...boxAt(box, x, z, rotY), minY: 0, maxY: MODELS[model].height, tag: 'prop' };
}

/** Taban kutusunun ([x0, x1, z0, z1], model çerçevesi) dönmüş hâlinin eksen hizalı kutusu (dünya). */
export function boxAt(box: readonly [number, number, number, number], x: number, z: number, rotY: number): Rect {
  const [x0, x1, z0, z1] = box;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [px, pz] of [
    [x0, z0],
    [x0, z1],
    [x1, z0],
    [x1, z1],
  ]) {
    // three.js Y dönüşü: x' = x·cos + z·sin, z' = −x·sin + z·cos
    const wx = x + px * c + pz * s;
    const wz = z - px * s + pz * c;
    minX = Math.min(minX, wx);
    maxX = Math.max(maxX, wx);
    minZ = Math.min(minZ, wz);
    maxZ = Math.max(maxZ, wz);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Zemin ve tavan dekorunun taban kutuları (GLB'den; yalnız görsel çakışma denetimi için, çarpışma kutusu değil:
 * kablonun üstünden yürünür). Katalogda kutu verilseydi elle konmuş kablolar da yürüyüşü kapatırdı.
 */
export const FLAT_BOX: Partial<Record<ModelId, [number, number, number, number]>> = {
  Prop_Cable_1: [-0.49, 0.53, -0.58, 1.07],
  Prop_Light_Floor: [-0.67, 0.67, -0.26, 0.26],
  Prop_PipeHolder: [-2.06, 2.05, -0.58, 0.58],
  Prop_Vent_Big: [-1.0, 1.0, -0.5, 0.48],
  Prop_Fan_Small: [-0.84, 0.84, -0.84, 0.84],
};

/** Zemindeki yassı dekorun kutusu (yürünebilir; yalnız görsel çakışma için), yoksa null. */
export function flatFootprint(model: ModelId, x: number, z: number, rotY: number): Rect | null {
  const box = FLAT_BOX[model];
  return box ? { ...boxAt(box, x, z, rotY), minY: 0, maxY: MODELS[model].height } : null;
}

function weighted<T extends string>(rng: Rng, w: Partial<Record<T, number>>): T {
  const entries = Object.entries(w) as [T, number][];
  const total = entries.reduce((s, [, v]) => s + Math.max(0, v), 0);
  let r = rng() * total;
  for (const [k, v] of entries) {
    if (r < v) return k;
    r -= v;
  }
  return entries[entries.length - 1][0];
}

/** Yuvaya göre eşyanın dünya konumu: duvar boyunca `along`, iç yüzden `dist` içeri. */
interface Item {
  model: ModelId;
  along: number;
  dist: number;
  /** Duvara göre ek dönüş (0: ön yüz odaya bakar). */
  rot?: number;
  y?: number;
  flip?: boolean;
}

/** Süslerin duvar boyunca yarı genişliği ve yarı yüksekliği (m; GLB'den ölçüldü, orijin merkezde). */
export const GREEBLE_HALF: Record<string, [number, number]> = {
  Details_Pipes_Long: [0.26, 0.79],
  Details_Pipes_Medium: [0.26, 0.38],
  Details_Cylinder: [0.22, 0.19],
  Details_Cylinder_Long: [0.57, 0.19],
  Details_Vent_1: [0.26, 0.16],
  Details_Vent_3: [0.52, 0.11],
  Details_Output: [0.15, 0.15],
  Details_Output_Small: [0.08, 0.08],
  Details_Plate_Large: [0.53, 0.54],
  Details_Plate_Details: [0.31, 0.31],
  Details_Hexagon: [0.18, 0.2],
  Details_Triangles: [0.24, 0.08],
};
/** Duvar hücresinin kenarı (köşe kolonları, kapı çerçeveleri): duvara yapışan süs/iz/levha merkezden bu kadar uzağa taşamaz. */
export const WALL_EDGE = 1.6;
/** Ortak duvarda kenar sınırı: komşu odanın köşe kolonu hücre kenarından ~0,7 m içeri uzanır. */
export const SHARED_EDGE = 1.25;
/**
 * WallAstra düz/kırık modülünün ön yüzeyi, hücre merkezinden uzaklık (m), yüksekliğe göre. GLB'ye ışın atılarak
 * ölçüldü: 0,8 m'nin altında dikey süpürgelik (2,036 m), üstünde ~11° geriye yatık panel. Çarpışma yüzü 1,55 m'de
 * olduğundan dekor eskiden duvardan 0,5–0,8 m önde havada duruyordu.
 */
export const WALL_SLOPE = 0.19;
export const TRIM_TOP = 0.8;
export const wallSurface = (y: number) => (y < TRIM_TOP ? 2.036 : 2.115 + WALL_SLOPE * (y - 1.2));
export const WALL_TILT = Math.atan(WALL_SLOPE);
/** Hücre ortasındaki çıkıntılı pilaster (yarı genişlik, m): dekor buna binmez. */
export const PILASTER = 0.3;

const GREEBLES: readonly ModelId[] = ['Details_Pipes_Long', 'Details_Pipes_Medium', 'Details_Cylinder', 'Details_Cylinder_Long', 'Details_Vent_1', 'Details_Vent_3', 'Details_Output', 'Details_Output_Small', 'Details_Plate_Large', 'Details_Plate_Details', 'Details_Hexagon', 'Details_Triangles'];

/** Duvar boyunca konumu, hücre ortasındaki pilasterin (± PILASTER) dışına iter. */
const offPilaster = (along: number, half: number) => (Math.abs(along) < PILASTER + half + 0.02 ? (along < 0 ? -1 : 1) * (PILASTER + half + 0.02) : along);

/** Bir duvar setinin eşyaları (yerel çerçevede) ve ekran/tabela ekleri. */
function wallSet(set: WallSet, rng: Rng): { items: Item[]; screens: { along: number; dist: number; y: number; w: number; h: number; facing: 'in' | 'out' }[] } {
  const j = () => (rng() - 0.5) * 0.4; // küçük konum oynaması
  const r = () => (rng() - 0.5) * 0.25; // küçük dönüş oynaması
  switch (set) {
    case 'barrels':
      return {
        items: [
          { model: 'Prop_Barrel_Large', along: -0.6 + j() * 0.5, dist: 0.27 },
          { model: 'Prop_Barrel2_Closed', along: 0.05, dist: 0.27 },
          ...(rng() < 0.5 ? [{ model: 'Prop_Barrel_Large' as ModelId, along: 0.7, dist: 0.27 }] : []),
        ],
        screens: [],
      };
    case 'locker':
      return { items: [{ model: 'Prop_Locker', along: -0.52, dist: 0.24 }, ...(rng() < 0.6 ? [{ model: 'Prop_Locker' as ModelId, along: 0.52, dist: 0.24 }] : [])], screens: [] };
    case 'shelves':
      return {
        items: [
          { model: rng() < 0.6 ? 'Prop_Shelves_WideTall' : 'Prop_Shelves_WideShort', along: j(), dist: 0.28 },
          ...(rng() < 0.4 ? [{ model: 'Prop_Barrel2_Closed' as ModelId, along: 1.35, dist: 0.27 }] : []),
        ],
        screens: [],
      };
    case 'desk': {
      // Geniş ya da dar masa; köşe kolonlarından kaçmak için hücre içinde kaydırılabilir
      const small = rng() < 0.5;
      const shift = (rng() < 0.5 ? -1 : 1) * (small ? 0.6 : 0.3) * rng();
      return {
        items: [
          { model: small ? 'Prop_Desk_Small' : 'Prop_Desk_Medium', along: shift, dist: 0.55 },
          { model: 'Prop_Chair', along: shift + j(), dist: 1.72, rot: Math.PI + r() * 1.5 },
        ],
        screens: [{ along: offPilaster(shift + (rng() - 0.5) * 0.6, 0.36), dist: 0.25, y: 1.3, w: 0.72, h: 0.44, facing: 'in' }],
      };
    }
    case 'crates':
      return {
        items: [
          { model: 'Prop_Crate4', along: -0.7, dist: 0.68, rot: r() },
          ...(rng() < 0.6 ? [{ model: 'Prop_Crate3' as ModelId, along: -0.7, dist: 0.68, rot: r() * 2, y: 1.12 }] : []),
          { model: 'Prop_Crate3', along: 0.6, dist: 0.6, rot: r() },
        ],
        screens: [],
      };
    case 'tarp':
      return { items: [{ model: 'Prop_Crate_Tarp', along: j(), dist: 0.9, rot: r() }], screens: [] };
    case 'chest':
      return { items: [{ model: 'Prop_Chest', along: j(), dist: 0.4 }, ...(rng() < 0.5 ? [{ model: 'Prop_ItemHolder' as ModelId, along: 1.2, dist: 0.6 }] : [])], screens: [] };
    case 'pipeRack':
      return { items: [{ model: 'Prop_PipeHolder', along: 0, dist: 0.6, rot: Math.PI / 2 }], screens: [] };
    case 'pipeColumn':
      return { items: [{ model: 'Column_Pipes', along: rng() < 0.5 ? -1.2 : 1.2, dist: 0.46 }], screens: [] };
    case 'screen':
      // Hücre ortasında pilaster var: ekran onun bir yanında
      return { items: [], screens: [{ along: (rng() < 0.5 ? -1 : 1) * (PILASTER + 0.55 + rng() * 0.25), dist: 0.04, y: 1.75, w: 1.05, h: 0.6, facing: 'in' }] };
    case 'greebles':
    case 'none':
      return { items: [], screens: [] };
  }
}

// ---------------------------------------------------------------- giydirme

export function dressRoom(inp: DressInput): DressOutput {
  const rng = createRng(hashString(inp.room.id));
  const { room, theme, ceiling: CEIL } = inp;
  const placements: Placement[] = [];
  const colliders: Rect[] = [];
  const decor: RoomDecor = { room: room.id, grime: [], signs: [], screens: [], emitters: [], accents: [] };
  const occupied = [...inp.blocked];
  /** Önünde göz hizasını kapatan uzun eşya olan duvar yuvaları (tabela konmaz). */
  const tallSlots = new Set<WallSlot>();
  const add = (model: ModelId, x: number, y: number, z: number, rotY: number, flip = false, tilt = 0) => {
    const lift = (MODELS[model] as ModelSpec).lift ?? 0;
    placements.push({ model, x, y: y + (flip ? -lift : lift), z, rotY, room: room.id, ...(flip ? { flip } : {}), ...(tilt ? { tilt } : {}) });
  };
  /** Kutunun duvar iç yüzünden odaya doğru en uzak noktası. */
  const depthOf = (s: WallSlot, f: Rect) => (s.nx > 0 ? f.maxX - s.x : s.nx < 0 ? s.x - f.minX : s.nz > 0 ? f.maxZ - s.z : s.z - f.minZ);
  const inner: Rect = { minX: inp.rect.minX + 0.44, maxX: inp.rect.maxX - 0.44, minZ: inp.rect.minZ + 0.44, maxZ: inp.rect.maxZ - 0.44 };
  const inside = (f: Rect) => f.minX >= inner.minX - 1e-9 && f.maxX <= inner.maxX + 1e-9 && f.minZ >= inner.minZ - 1e-9 && f.maxZ <= inner.maxZ + 1e-9;
  const facing = (s: WallSlot) => Math.atan2(s.nx, s.nz);
  const at = (s: WallSlot, along: number, dist: number): [number, number] => [s.x + s.ax * along + s.nx * dist, s.z + s.az * along + s.nz * dist];
  /** Duvar yüzeyindeki nokta (y yüksekliğinde), yüzeyden `lift` kadar önde; yuva yüzünün gerisinde kalır. */
  const onWall = (s: WallSlot, along: number, y: number, lift: number) => at(s, along, inp.wallInner - wallSurface(y) + lift);

  // Duvar doluluğu: duvara yapışan süs, iz, ekran ve levhalar önündeki eşyaya, terminale, kolona ya da birbirine
  // binmesin. Her yuva için duvar boyunca [lo, hi] aralığı ve [y0, y1] yükseklik bandı.
  type Occ = { lo: number; hi: number; y0: number; y1: number };
  const wallDecor = new Map<WallSlot, Occ[]>();
  /** Kutunun bu yuvanın duvarı önündeki izdüşümü (duvardan 1 m'den uzaktaysa yok sayılır). */
  const project = (sl: WallSlot, f: Rect): Occ | null => {
    let lo = Infinity;
    let hi = -Infinity;
    let near = Infinity;
    for (const [px, pz] of [[f.minX, f.minZ], [f.minX, f.maxZ], [f.maxX, f.minZ], [f.maxX, f.maxZ]]) {
      const a = (px - sl.x) * sl.ax + (pz - sl.z) * sl.az;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
      near = Math.min(near, (px - sl.x) * sl.nx + (pz - sl.z) * sl.nz);
    }
    if (near > 1.0 || hi < -2.2 || lo > 2.2) return null;
    return { lo, hi, y0: f.minY ?? 0, y1: f.maxY ?? CEIL };
  };
  /** Duvarda [along ± half] × [y0, y1] boş mu (hücre kenarı sütunları, eşyalar, terminaller, önceki süsler). */
  const wallFree = (sl: WallSlot, along: number, half: number, y0: number, y1: number): boolean => {
    if (Math.abs(along) + half > (sl.shared ? SHARED_EDGE : WALL_EDGE) + 1e-9) return false;
    const lo = along - half;
    const hi = along + half;
    if (!sl.window && lo < PILASTER && hi > -PILASTER) return false; // ortadaki pilaster
    // Süpürgelik (dikey) ile yatık panel arasındaki kırılmayı geçen dekor yüzeye oturmaz
    if (y0 < TRIM_TOP - 0.02 && y1 > TRIM_TOP + 0.02) return false;
    const hits = (o: Occ) => lo < o.hi && hi > o.lo && y0 < o.y1 && y1 > o.y0;
    if ((wallDecor.get(sl) ?? []).some(hits)) return false;
    return !occupied.some((f) => {
      const o = project(sl, f);
      return o !== null && hits(o);
    });
  };
  const claim = (sl: WallSlot, along: number, half: number, y0: number, y1: number) =>
    wallDecor.set(sl, [...(wallDecor.get(sl) ?? []), { lo: along - half, hi: along + half, y0, y1 }]);

  /** Seti dene: bütün eşyalar sığarsa konur. */
  const tryWallSet = (s: WallSlot, set: WallSet): boolean => {
    const { items, screens } = wallSet(set, rng);
    const plan: { it: Item; x: number; z: number; rotY: number; f: Rect | null }[] = [];
    for (const it of items) {
      const spec = MODELS[it.model];
      const no = (why: string) => (inp.trace?.push(`${room.id} ${s.side}/${s.index} ${set}: ${why}`), false);
      // Pencereyi kapatmasın (sandalye duvardan uzakta, oturma yeri: muaf)
      if (s.window && spec.height > 1.3 && (it.y ?? 0) === 0 && it.model !== 'Prop_Chair') return no('pencere');
      const [x, z] = at(s, it.along, it.dist);
      const rotY = facing(s) + (it.rot ?? 0);
      const f = footprint(it.model, x, z, rotY);
      if (f) {
        if (depthOf(s, f) > inp.maxDepth + 1e-6) return no('derinlik');
        if (!inside(f)) return no('oda dışı');
        const hit = (it.y ?? 0) === 0 ? [...occupied, ...plan.map((p) => p.f).filter((g): g is Rect => g !== null)].find((o) => overlap(o, f)) : undefined;
        if (hit) return no(`çakışma ${it.model} ↔ ${hit.tag ?? '?'} [${[hit.minX, hit.maxX, hit.minZ, hit.maxZ].map((v) => v.toFixed(1)).join(' ')}]`);
        if (inp.keepOut.some((k) => overlap(k, f))) return no(`yasak bölge ${it.model}`);
      }
      plan.push({ it, x, z, rotY, f });
    }
    if (screens.some(() => s.window) && set === 'screen') return false;
    // Ekranlar: setin kendi eşyaları da dahil, duvarda yer yoksa ekran konmaz ('screen' seti hiç konmaz)
    const planned = plan.map((p) => p.f).filter((g): g is Rect => g !== null && (g.minY ?? 0) === 0);
    const screenFree = (sc: (typeof screens)[number]) => {
      const lo = sc.along - sc.w / 2;
      const hi = sc.along + sc.w / 2;
      const [y0, y1] = [sc.y - sc.h / 2, sc.y + sc.h / 2];
      const others = planned.map((f) => project(s, f)).filter((o): o is Occ => o !== null && o.y1 > 0.95); // masa üstü (~0,8 m) engel değil
      return wallFree(s, sc.along, sc.w / 2, y0, y1) && !others.some((o) => lo < o.hi && hi > o.lo && y0 < o.y1 && y1 > o.y0);
    };
    const okScreens = s.window || s.shared ? [] : screens.filter(screenFree);
    if (set === 'screen' && okScreens.length < screens.length) return false;
    for (const p of plan) {
      if (MODELS[p.it.model].height > 1.9) tallSlots.add(s);
      add(p.it.model, p.x, p.it.y ?? 0, p.z, p.rotY);
      if (p.f && (p.it.y ?? 0) === 0) {
        occupied.push(p.f);
        colliders.push(p.f);
      }
    }
    for (const sc of okScreens) {
      claim(s, sc.along, sc.w / 2, sc.y - sc.h / 2, sc.y + sc.h / 2);
      const [x, z] = onWall(s, sc.along, sc.y, 0.02);
      decor.screens.push({ x, y: sc.y, z, rotY: facing(s), tilt: WALL_TILT, w: sc.w, h: sc.h, kind: pick(rng, ['wave', 'text', 'graph'] as const) });
      decor.accents.push({ x: x + s.nx * 1.1, y: sc.y, z: z + s.nz * 1.1 });
    }
    return true;
  };

  /** Bir kir/pas/damla izi dener: kir süpürgelikte (0,8 m altı, dikey), pas/damla yatık panelde (0,85–2,9 m). */
  const tryGrime = (s: WallSlot, kinds: readonly GrimeKind[] = ['rust', 'drip', 'water', 'dirt']): boolean => {
    const kind = pick(rng, kinds);
    const h = kind === 'dirt' ? 0.4 + rng() * 0.3 : 1.0 + rng() * 1.0;
    const y = kind === 'dirt' ? 0.08 + h / 2 : 2.9 - h / 2;
    const variant = Math.floor(rng() * 4);
    const onTrim = kind === 'dirt';
    // İz duvarın yüzeyinde: önünde eşya/sütun varsa havada asılı görünür; boş yer yoksa konmaz
    for (let tries = 0; tries < 8; tries++) {
      const w = (0.5 + rng() * 0.9) * (1 - tries * 0.08); // dar duvar aralıklarına sığsın diye giderek daralır
      const along = (rng() - 0.5) * 2.6;
      if (!wallFree(s, along, w / 2, y - h / 2, y + h / 2)) continue;
      claim(s, along, w / 2, y - h / 2, y + h / 2);
      const [x, z] = onWall(s, along, y, 0.012);
      decor.grime.push({ x, y, z, rotY: facing(s), ...(onTrim ? {} : { tilt: WALL_TILT }), w, h, kind, variant });
      return true;
    }
    return false;
  };

  /** Yuvanın duvar süsleri, kir/pas izleri ve kırık duvar damlası. */
  const decorateSlot = (s: WallSlot, set: WallSet) => {
    // Duvar süsleri (pencere ve kırık duvar dışında): set 'greebles' ise 2–3, değilse ara sıra 1
    if (!s.window && !s.broken && !s.shared) {
      const count = set === 'greebles' ? 2 + Math.floor(rng() * 2) : rng() < 0.35 ? 1 : 0;
      for (let k = 0; k < count; k++) {
        // Boş bir yer bulunana kadar birkaç aday; bulunamazsa süs konmaz (eşyaya/sütuna binmesin)
        for (let tries = 0; tries < 6; tries++) {
          const g = pick(rng, GREEBLES);
          const [hw, hh] = GREEBLE_HALF[g];
          const along = (rng() - 0.5) * 2.4;
          const y = 2.0 + rng() * 0.7;
          if (!wallFree(s, along, hw, y - hh, y + hh)) continue;
          claim(s, along, hw, y - hh, y + hh);
          const [x, z] = onWall(s, along, y, 0.03);
          add(g, x, y, z, facing(s), false, WALL_TILT);
          break;
        }
      }
    }
    // Kir, pas, damlama izleri
    if (!s.window && rng() < theme.grime) {
      const n = 1 + (rng() < 0.4 ? 1 : 0);
      for (let k = 0; k < n; k++) tryGrime(s);
    }
    if (s.broken) {
      const [x, z] = at(s, 0, 0.3);
      decor.emitters.push({ kind: 'drip', x, y: 2.6, z, dx: 0, dy: -1, dz: 0 });
      decor.grime.push({ x: x + s.nx * 0.5, y: 0.012, z: z + s.nz * 0.5, rotY: 0, w: 1.6, h: 1.2, kind: 'water', floor: true, variant: 0 });
    }
  };

  // Önce zorunlu setler: karıştırılmış yuva sırasıyla, sığdığı ilk boş yuvaya
  const used = new Map<WallSlot, WallSet>();
  for (const set of theme.required) {
    const order = shuffle(rng, inp.slots); // sort(() => rng() − 0,5) motora bağlıydı: tarayıcı ile düğüm farklı yerleşim üretiyordu
    for (const s of order) {
      if (used.has(s)) continue;
      if (set === 'greebles' && (s.window || s.broken || s.shared)) continue; // süs yalnız düz, dış duvara konur
      if (set === 'screen' && (s.window || s.shared)) continue;
      if (tryWallSet(s, set)) {
        used.set(s, set);
        break;
      }
    }
  }
  // Duvarlar: kalan her yuvaya temadan bir set; sığmazsa temadan dört set daha denenir, olmazsa yalnız süs
  for (const s of inp.slots) {
    if (used.has(s)) {
      decorateSlot(s, used.get(s)!);
      continue;
    }
    let first = weighted(rng, theme.wall);
    let placed = tryWallSet(s, first);
    for (let k = 0; k < 4 && !placed; k++) {
      first = weighted(rng, theme.wall);
      placed = tryWallSet(s, first);
    }
    if (!placed) first = tryWallSet(s, 'greebles') ? 'greebles' : 'none';
    decorateSlot(s, first);
  }

  // Her odada en az bir iz (eskimişlik hissi): zar tutmadıysa uygun bir düz yuvaya
  if (!decor.grime.some((g) => !g.floor)) for (const sl of shuffle(rng, inp.slots.filter((x) => !x.window))) if (tryGrime(sl, ['rust', 'drip', 'dirt'])) break;

  // Zemin: duvar diplerinde kablolar ve zemin lambaları (çarpışmasız ama görünür): eşyaların altına girmesinler,
  // birbirine binmesinler. 5,7 m'lik Prop_Cable_3 hücreye sığmadığı için (komşu hücrelere ve eşyalara taşıyordu)
  // rastgele zemin dekorunda kullanılmaz.
  const floorRects: Rect[] = [];
  const floorFree = (r: Rect) => inside(r) && ![...occupied.filter((o) => (o.minY ?? 0) < 0.3), ...floorRects].some((o) => overlap(o, r));
  for (const s of inp.slots) {
    if (rng() < theme.floor.cables) {
      const [x, z] = at(s, (rng() - 0.5) * 1.2, 0.25);
      const rotY = facing(s) + Math.PI / 2 + (rng() - 0.5) * 0.3;
      const r = boxAt(FLAT_BOX.Prop_Cable_1!, x, z, rotY);
      if (floorFree(r)) {
        add('Prop_Cable_1', x, 0.005, z, rotY);
        floorRects.push(r);
      }
    }
    if (rng() < theme.floor.floorLight) {
      const [x, z] = at(s, (rng() - 0.5) * 2.4, 0.3);
      const r = boxAt(FLAT_BOX.Prop_Light_Floor!, x, z, facing(s));
      if (floorFree(r)) {
        add('Prop_Light_Floor', x, 0.002, z, facing(s));
        floorRects.push(r);
      }
    }
  }

  // Tavan: boru demetleri (koridor boyunca), fanlar, menfezler; hepsi baş üstünde (çarpışmasız)
  const long = inp.rect.maxX - inp.rect.minX < inp.rect.maxZ - inp.rect.minZ;
  /** Tavan parçaları (boru rafı, fan, menfez) ve lamba armatürleri birbirine binmesin. */
  const ceilingRects: Rect[] = [...(inp.ceilingBlocked ?? [])];
  // İç sütunlar (çekirdek): dört çeyrek noktada, yasak bölgelerle çakışmıyorsa
  if (theme.columns) {
    const w = inp.rect.maxX - inp.rect.minX;
    const d = inp.rect.maxZ - inp.rect.minZ;
    for (const fx of [0.3, 0.7])
      for (const fz of [0.3, 0.7]) {
        const x = inp.rect.minX + w * fx;
        const z = inp.rect.minZ + d * fz;
        const model: ModelId = rng() < 0.5 ? 'Column_Hollow' : 'Column_Round';
        const f = footprint(model, x, z, 0)!;
        if ([...occupied, ...inp.keepOut, ...ceilingRects].some((o) => overlap(o, f))) continue; // lamba armatürünü de kesmesin
        add(model, x, 0, z, 0);
        occupied.push(f);
        colliders.push({ ...f, tag: 'column' });
        ceilingRects.push(f); // tavana kadar uzanır: fan/boru buna binmesin
      }
  }

  for (const c of inp.cells) {
    if (rng() < theme.ceiling.pipes) {
      // Boru demeti duvar boyunca, duvara yakın asılır: koridorda doğu duvarı, odada hücreye en yakın duvar
      const dW = c.x - inner.minX;
      const dE = inner.maxX - c.x;
      const dN = inner.maxZ - c.z;
      const dS = c.z - inner.minZ;
      const m = Math.min(dW, dE, dN, dS);
      const corridor = inp.maxDepth < 1;
      const alongZ = corridor ? long : m === dW || m === dE;
      if (!corridor && m > 2.5) continue; // iç hücrede boru yok (havada asılı kalmasın)
      const px = alongZ ? (corridor || m === dE ? inner.maxX - 0.62 : inner.minX + 0.62) : c.x;
      const pz = alongZ ? c.z : m === dN ? inner.maxZ - 0.62 : inner.minZ + 0.62;
      const pr = boxAt(FLAT_BOX.Prop_PipeHolder!, px, pz, alongZ ? Math.PI / 2 : 0);
      if (ceilingRects.some((o) => overlap(o, pr))) continue; // başka boru rafına binmesin
      ceilingRects.push(pr);
      add('Prop_PipeHolder', px, CEIL, pz, alongZ ? Math.PI / 2 : 0, true);
      if (rng() < theme.emitters.steam * 0.25) decor.emitters.push({ kind: 'steam', x: px + (alongZ ? 0 : (rng() - 0.5) * 2), y: CEIL - 0.6, z: pz + (alongZ ? (rng() - 0.5) * 2 : 0), dx: 0, dy: -0.4, dz: 0 });
    }
    const ceilingFree = (r: Rect) => !ceilingRects.some((o) => overlap(o, r));
    if (rng() < theme.ceiling.fan) {
      const fz = c.z + (rng() < 0.5 ? -1 : 1);
      const r = boxAt(FLAT_BOX.Prop_Fan_Small!, c.x - 1.1, fz, 0);
      if (ceilingFree(r)) {
        ceilingRects.push(r);
        add('Prop_Fan_Small', c.x - 1.1, CEIL, fz, 0, true);
      }
    } else if (rng() < theme.ceiling.vent) {
      const r = boxAt(FLAT_BOX.Prop_Vent_Big!, c.x - 1.0, c.z - 1.1, long ? Math.PI / 2 : 0);
      if (ceilingFree(r)) {
        ceilingRects.push(r);
        add('Prop_Vent_Big', c.x - 1.0, CEIL - 0.001, c.z - 1.1, long ? Math.PI / 2 : 0);
      }
    }
  }

  // Ek kaynaklar: buhar ve gaz boru/duvar diplerinde, damla tavandan
  const wallPoint = (): [number, number, WallSlot] => {
    const s = pick(rng, inp.slots.filter((x) => !x.window));
    const [x, z] = at(s, (rng() - 0.5) * 2.4, 0.12);
    return [x, z, s];
  };
  const steamLeft = Math.max(0, theme.emitters.steam - decor.emitters.filter((e) => e.kind === 'steam').length);
  for (let k = 0; k < steamLeft && inp.slots.some((x) => !x.window); k++) {
    const [x, z, s] = wallPoint();
    decor.emitters.push({ kind: 'steam', x, y: 0.5 + rng() * 1.6, z, dx: s.nx * 0.6, dy: 0.5, dz: s.nz * 0.6 });
  }
  for (let k = 0; k < theme.emitters.gas && inp.slots.some((x) => !x.window); k++) {
    const [x, z, s] = wallPoint();
    decor.emitters.push({ kind: 'gas', x, y: 0.4, z, dx: s.nx, dy: 0.15, dz: s.nz });
  }
  for (let k = 0; k < theme.emitters.drip; k++) {
    const x = inner.minX + 0.8 + rng() * (inner.maxX - inner.minX - 1.6);
    const z = inner.minZ + 0.8 + rng() * (inner.maxZ - inner.minZ - 1.6);
    decor.emitters.push({ kind: 'drip', x, y: CEIL - 0.1, z, dx: 0, dy: -1, dz: 0 });
    decor.grime.push({ x, y: 0.011 + k * 0.001, z, rotY: rng() * Math.PI, w: 0.9 + rng() * 0.8, h: 0.7 + rng() * 0.6, kind: 'water', floor: true, variant: Math.floor(rng() * 4) });
  }

  // Uyarı levhaları: pencere dışı duvarlarda, göz hizasında
  const free = inp.slots.filter((x) => !x.window && !tallSlots.has(x));
  theme.warnings.forEach(([title, sub], k) => {
    if (!free.length) return;
    // Önce eski seçim (deterministik), sonra diğer yuvalar ve konumlar; levha hiçbir şeye binmemeli
    const start = (hashString(room.id + k) + k * 3) % free.length;
    const side = k % 2 ? 1 : -1;
    for (let i = 0; i < free.length; i++) {
      const s = free[(start + i) % free.length];
      const along = [side * 1.15, -side * 1.15, side * 0.5, -side * 0.5, 0].find((a) => wallFree(s, a, 0.45, 2.1, 2.6));
      if (along === undefined) continue;
      claim(s, along, 0.45, 2.1, 2.6);
      const [x, z] = onWall(s, along, 2.35, 0.02);
      decor.signs.push({ x, y: 2.35, z, rotY: facing(s), tilt: WALL_TILT, w: 0.9, h: 0.5, title, sub, kind: 'warning' });
      return;
    }
  });

  const flicker = inp.lampIndices.filter(() => rng() < theme.flicker);
  return { placements, colliders, decor, flicker };
}
