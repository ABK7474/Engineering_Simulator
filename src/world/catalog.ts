// Model kataloğu: oyunun yüklediği her model tek yerde. Dosya yolu (public/assets/models altında), model
// koordinatında taban kutusu (çarpışma), yükseklik ve modelin kökü tabanda değilse y kayması.
// Kutular modellerin gerçek sınırlarından ölçüldü (Quaternius: ön yüz +z, arka −z).
// Yerleşim (layout.ts), oda giydirme (dressing.ts), içerik doğrulama ve yükleyici (hub/assets.ts) bunu kullanır.

export interface ModelSpec {
  file: string;
  /** Taban kutusu, model koordinatında [minX, maxX, minZ, maxZ]; yoksa çarpışma yok (duvar/tavan süsü, kablo). */
  box?: [number, number, number, number];
  /** Model yüksekliği (m). */
  height: number;
  /** Modelin kökü tabanda değilse yerleşimde eklenecek y (ör. merkezli kasalar). */
  lift?: number;
}

const q = (name: string, height: number, box?: ModelSpec['box'], lift?: number): ModelSpec => ({
  file: `quaternius/${name}.gltf`,
  height,
  ...(box ? { box } : {}),
  ...(lift ? { lift } : {}),
});
const u = (name: string, height: number): ModelSpec => ({ file: `umsf/${name}.glb`, height });

export const MODELS = {
  // Yapı
  WallAstra_Straight: q('WallAstra_Straight', 3),
  WallAstra_Straight_Window: q('WallAstra_Straight_Window', 3),
  WallAstra_Straight_Broken: q('WallAstra_Straight_Broken', 3),
  TopCables_Straight: q('TopCables_Straight', 2),
  TopCables_Straight_Hanging: q('TopCables_Straight_Hanging', 2),
  BottomMetal_Straight: q('BottomMetal_Straight', 0.02),
  Platform_DarkPlates: q('Platform_DarkPlates', 0.1),
  Door_Frame_Square: q('Door_Frame_Square', 4),
  Door_Metal: q('Door_Metal', 3.4),
  Column_Simple: q('Column_Simple', 5),
  // Terminaller (çarpışmaları TERMINAL_SPEC'te)
  Prop_AccessPoint: q('Prop_AccessPoint', 1.6),
  Prop_Computer: q('Prop_Computer', 1.4),
  // Tavan, zemin süsleri (çarpışmasız)
  Prop_Light_Wide: q('Prop_Light_Wide', 0.2),
  Prop_Light_Small: q('Prop_Light_Small', 0.2),
  Prop_Light_Floor: q('Prop_Light_Floor', 0.21),
  Prop_Vent_Wide: q('Prop_Vent_Wide', 0.05),
  Prop_Vent_Big: q('Prop_Vent_Big', 0.07),
  Prop_Vent_Small: q('Prop_Vent_Small', 0.04),
  Prop_Fan_Small: q('Prop_Fan_Small', 0.44),
  Prop_Cable_1: q('Prop_Cable_1', 0.1),
  Prop_Cable_3: q('Prop_Cable_3', 0.1),
  Prop_Clamp: q('Prop_Clamp', 0.16),
  // Zemin eşyaları (çarpışmalı)
  Prop_Crate: q('Prop_Crate', 1.5, [-0.78, 0.78, -0.75, 0.75]),
  Prop_Crate_Large: q('Prop_Crate_Large', 1.5, [-1.73, 1.73, -0.75, 0.75]),
  Prop_Crate3: q('Prop_Crate3', 1, [-0.5, 0.5, -0.5, 0.5], 0.5),
  Prop_Crate4: q('Prop_Crate4', 1.12, [-0.56, 0.56, -0.56, 0.56], 0.56),
  Prop_Crate_Tarp: q('Prop_Crate_Tarp', 1.56, [-0.86, 0.86, -0.86, 0.86]),
  Prop_Locker: q('Prop_Locker', 2.67, [-0.49, 0.49, -0.23, 0.27]),
  Prop_Chest: q('Prop_Chest', 0.73, [-0.75, 0.75, -0.36, 0.39]),
  Prop_ItemHolder: q('Prop_ItemHolder', 0.43, [-0.57, 0.47, -0.51, 0.56]),
  Prop_Barrel_Large: q('Prop_Barrel_Large', 1.11, [-0.25, 0.25, -0.27, 0.27]),
  Prop_Barrel1: q('Prop_Barrel1', 1.11, [-0.36, 0.36, -0.32, 0.32]),
  Prop_Barrel2_Closed: q('Prop_Barrel2_Closed', 0.77, [-0.27, 0.27, -0.27, 0.27]),
  Prop_Shelves_WideTall: q('Prop_Shelves_WideTall', 2.67, [-0.99, 0.99, -0.27, 0.27]),
  Prop_Shelves_WideShort: q('Prop_Shelves_WideShort', 1.21, [-0.99, 0.99, -0.27, 0.27]),
  Prop_Desk_Medium: q('Prop_Desk_Medium', 0.94, [-1.42, 1.42, -0.53, 0.5]),
  Prop_Desk_Small: q('Prop_Desk_Small', 0.94, [-1.03, 1.03, -0.53, 0.5]),
  Prop_Desk_L: q('Prop_Desk_L', 0.94, [-0.8, 1.42, -1.42, 0.8]),
  Prop_Chair: q('Prop_Chair', 1.63, [-0.44, 0.44, -0.49, 0.63]),
  Prop_PipeHolder: q('Prop_PipeHolder', 0.94, [-2.06, 2.05, -0.58, 0.58]),
  Column_Pipes: q('Column_Pipes', 5, [-0.44, 0.44, -0.44, 0.44]),
  Column_Hollow: q('Column_Hollow', 5, [-0.6, 0.6, -0.6, 0.6]),
  Column_Round: q('Column_Round', 5, [-0.5, 0.5, -0.5, 0.5]),
  // Dış sahne
  Prop_SatelliteDish: q('Prop_SatelliteDish', 5.76),
  // Duvar süsleri (Ultimate Modular Sci-Fi; ön yüz +z, arka z ≈ 0)
  Details_Pipes_Long: u('Details_Pipes_Long', 1.58),
  Details_Pipes_Medium: u('Details_Pipes_Medium', 0.76),
  Details_Cylinder: u('Details_Cylinder', 0.38),
  Details_Cylinder_Long: u('Details_Cylinder_Long', 0.38),
  Details_Vent_1: u('Details_Vent_1', 0.31),
  Details_Vent_3: u('Details_Vent_3', 0.22),
  Details_Output: u('Details_Output', 0.3),
  Details_Output_Small: u('Details_Output_Small', 0.16),
  Details_Plate_Large: u('Details_Plate_Large', 1.08),
  Details_Plate_Details: u('Details_Plate_Details', 0.62),
  Details_Hexagon: u('Details_Hexagon', 0.4),
  Details_Triangles: u('Details_Triangles', 0.16),
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODELS;
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];
export const isModelId = (x: string): x is ModelId => x in MODELS;
