// Koridor yerleşimi: hangi modül nereye, hangi çarpışma kutusu nerede. Three.js'siz, saf veri;
// birim testi yazılabilsin diye görselden ayrı tutuluyor.

/** Quaternius modüler kitinin grid adımı (m). */
export const MODULE = 4;
export const CEILING = 5;
/** Duvar modüllerinin iç yüzeyi (çıkıntılar dahil) merkezden bu kadar uzakta. */
export const WALL_INNER = 1.55;
/** Koridor boyunca orta hatta engelsiz kalması gereken genişlik (m). */
export const CLEAR_PATH = 2;

export type ModelId =
  | 'WallAstra_Straight'
  | 'WallAstra_Straight_Window'
  | 'WallAstra_Straight_Broken'
  | 'TopCables_Straight'
  | 'TopCables_Straight_Hanging'
  | 'BottomMetal_Straight'
  | 'Platform_DarkPlates'
  | 'Door_Frame_Square'
  | 'Prop_Light_Wide'
  | 'Prop_Vent_Wide'
  | 'Prop_Cable_1'
  | 'Column_Simple'
  | 'Prop_Crate'
  | 'Prop_Crate_Large'
  | 'Prop_Locker';

export interface Placement {
  model: ModelId;
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Tavan için modeli X ekseninde ters çevir. */
  flip?: boolean;
}

/** XZ düzleminde dikdörtgen. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface CorridorLayout {
  modules: number;
  zStart: number;
  doorZ: number;
  zEnd: number;
  placements: Placement[];
  colliders: Rect[];
  /** Tavan lambası armatürleri (her modülde). */
  lampFixtures: Point[];
  /** Gerçek ışık kaynakları (az sayıda; ışık bütçesi). */
  lampLights: Point[];
  spawn: Point;
  leak: Point;
  panel: { x: number; z: number; rotY: number };
  alarm: Point;
}

const { PI } = Math;
// Duvar modelleri sol tarafa (−x) göre modellenmiş; diğer yönler Y ekseninde döndürülerek elde edilir.
const ROT = { left: 0, right: PI, back: PI / 2, front: -PI / 2 };

/** Koridor: `modules` adet modül, sonda kapı, kapının arkasında tek modüllük oda. */
export function buildLayout(modules = 7): CorridorLayout {
  if (!Number.isInteger(modules) || modules < 3) throw new Error('En az 3 modül gerekir');
  const zStart = MODULE / 2;
  const doorZ = zStart - modules * MODULE;
  const zEnd = doorZ - MODULE;
  const centers = Array.from({ length: modules + 1 }, (_, i) => zStart - MODULE * (i + 0.5));
  const broken = Math.floor(modules / 2);
  const P: Placement[] = [];
  const add = (model: ModelId, x: number, y: number, z: number, rotY = 0, flip = false) =>
    P.push({ model, x, y, z, rotY, ...(flip ? { flip } : {}) });

  centers.forEach((z, i) => {
    const leftWall: ModelId =
      i === broken ? 'WallAstra_Straight_Broken' : i % 2 === 1 ? 'WallAstra_Straight_Window' : 'WallAstra_Straight';
    add(leftWall, 0, 0, z, ROT.left);
    add('WallAstra_Straight', 0, 0, z, ROT.right);
    const top: ModelId = i === broken + 1 ? 'TopCables_Straight_Hanging' : 'TopCables_Straight';
    add(top, 0, 0, z, ROT.left);
    add('TopCables_Straight', 0, 0, z, ROT.right);
    add('BottomMetal_Straight', 0, 0, z, ROT.left);
    add('BottomMetal_Straight', 0, 0, z, ROT.right);
    add('Platform_DarkPlates', 0, CEILING, z, 0, true);
    add('Prop_Light_Wide', MODULE / 6, CEILING, z, 0);
  });

  // Uç duvarlar: başlangıç (arka) ve odanın sonu (ön)
  const first = centers[0];
  const last = centers[modules];
  for (const m of ['WallAstra_Straight', 'TopCables_Straight', 'BottomMetal_Straight'] as const) {
    add(m, 0, 0, first, ROT.back);
    add(m, 0, 0, last, ROT.front);
  }

  add('Door_Frame_Square', 0, 0, doorZ);

  // Kaburgalar: her iki modülde bir, iki yanda kolon
  const colliders: Rect[] = [];
  for (let i = 2; i < modules; i += 2) {
    const z = zStart - i * MODULE;
    for (const side of [-1, 1]) {
      const x = side * (WALL_INNER - 0.25);
      add('Column_Simple', x, 0, z);
      colliders.push(rect(x, z, 0.25, 0.5));
    }
  }

  // Detaylar ve engeller
  add('Prop_Vent_Wide', 0, 0.001, centers[1]);
  add('Prop_Cable_1', -0.8, 0, centers[broken] + 0.8, 0.4);
  // Sandık başlangıçtaki arka köşede (oyuncunun arkasında); orta yolu kapatmaz.
  const crateZ = zStart - (MODULE / 2 - WALL_INNER) - 0.75;
  add('Prop_Crate', -(WALL_INNER - 0.78), 0, crateZ, 0);
  colliders.push(rect(-(WALL_INNER - 0.78), crateZ, 0.78, 0.75));
  const lockerZ = centers[1] - 1;
  add('Prop_Locker', WALL_INNER - 0.27, 0, lockerZ, ROT.front);
  colliders.push(rect(WALL_INNER - 0.27, lockerZ, 0.27, 0.5));
  const bigCrateZ = zEnd + (MODULE / 2 - WALL_INNER) + 0.75;
  add('Prop_Crate_Large', 0, 0, bigCrateZ);
  colliders.push(rect(0, bigCrateZ, 1.73, 0.75));

  // Kabuk çarpışmaları
  const far = 3;
  colliders.push(
    { minX: -far, maxX: -WALL_INNER, minZ: zEnd - far, maxZ: zStart + far },
    { minX: WALL_INNER, maxX: far, minZ: zEnd - far, maxZ: zStart + far },
    { minX: -far, maxX: far, minZ: zStart - (MODULE / 2 - WALL_INNER), maxZ: zStart + far },
    { minX: -far, maxX: far, minZ: zEnd - far, maxZ: zEnd + (MODULE / 2 - WALL_INNER) },
  );

  // Panel: sol duvarda, kapıdan 2,2 m önce. Terminal duvar boyunca uzanır, eğik ekranı
  // yaklaşan oyuncuya (+z) bakar; modelin arkası (−x) duvara yaslanır.
  const panel = { x: -(WALL_INNER - 0.22), z: doorZ + 2.2, rotY: ROT.left };
  colliders.push(rect(panel.x, panel.z, 0.22, 0.66));

  const lampLights = centers.filter((_, i) => i % 2 === 0 || i === modules).map((z) => ({ x: 0, y: CEILING - 0.6, z }));

  return {
    modules,
    zStart,
    doorZ,
    zEnd,
    placements: P,
    colliders,
    lampFixtures: centers.map((z) => ({ x: 0, y: CEILING - 0.12, z })),
    lampLights,
    spawn: { x: 0, y: 0, z: crateZ - 1.5 },
    leak: { x: -WALL_INNER, y: 1.2, z: centers[broken] },
    panel,
    alarm: { x: 0, y: CEILING - 0.3, z: doorZ + 1 },
  };
}

function rect(cx: number, cz: number, hx: number, hz: number): Rect {
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
}

export function insideAny(rects: readonly Rect[], x: number, z: number): boolean {
  return rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}
