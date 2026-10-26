// Kapsülün yükselişi (saf, Three.js'siz; testli): derinlik eğrisi, derinliğe göre su rengi ve sisi, istasyon
// ışıklarının sönme sırası ve yaratığın takip yolu. Sahne (hub.ts) bunları her karede uygular. Derinlik göstergesi
// gerçek 221 m'yi sayar; dünyada kapsül RISE metre yükselir (sahne sıkıştırılmıştır, sis farkı örter).

export const START_DEPTH = 221;
/** Yükseliş süresi (sn): 221 m → 0. */
export const ASCENT_SECONDS = 52;
/** Kapsülün dünyada yükseldiği mesafe (m). */
export const RISE = 70;
/** Sürenin ivmelenme payı; sonrası sabit hız (kapsül yüzerek çıkar, yüzeye yaklaşırken yavaşlamaz). */
const ACCEL = 0.06;
const VMAX = 1 / (1 - ACCEL / 2);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => k * k * (3 - 2 * k);

/** Yolun kesri (0 → 1) zamanın kesrinden (0 → 1). */
function travelled(k: number): number {
  return k < ACCEL ? (VMAX * k * k) / (2 * ACCEL) : Math.min(1, VMAX * (ACCEL / 2 + k - ACCEL));
}

/** t saniyede derinlik (m). */
export function depthAt(t: number): number {
  return START_DEPTH * (1 - travelled(clamp01(t / ASCENT_SECONDS)));
}

/** `depthAt`'in tersi: verilen derinliğe varılan an (sn). */
export function timeForDepth(depth: number): number {
  const f = 1 - clamp01(depth / START_DEPTH);
  const k = f < (VMAX * ACCEL) / 2 ? Math.sqrt((2 * ACCEL * f) / VMAX) : f / VMAX + ACCEL / 2;
  return k * ASCENT_SECONDS;
}

/** Kapsülün yuvadan yüksekliği (m). */
export const riseAt = (depth: number) => RISE * (1 - clamp01(depth / START_DEPTH));

// ---------------------------------------------------------------- su

export interface WaterLook {
  /** sRGB bileşenleri (0..1). */
  top: [number, number, number];
  bottom: [number, number, number];
  density: number;
}

const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
/** İstasyondaki su (exterior.ts'teki varsayılanlarla aynı). */
const DEEP = { top: rgb(0x3fb8c4), bottom: rgb(0x020f17), density: 0.045 };
/** Yüzeyin hemen altı: yukarısı neredeyse beyaz, aşağısı açık camgöbeği, sis seyrek. */
const SHALLOW = { top: rgb(0xd2f8ef), bottom: rgb(0x1d6f7c), density: 0.016 };

/** Derinliğe göre su: ışık yüzeye yaklaştıkça hızla artar. `waterAt(START_DEPTH)` varsayılanın tam kendisidir. */
export function waterAt(depth: number): WaterLook {
  const k = (1 - clamp01(depth / START_DEPTH)) ** 2;
  const mix = (a: number[], b: number[]) => a.map((v, i) => lerp(v, b[i], k)) as [number, number, number];
  return { top: mix(DEEP.top, SHALLOW.top), bottom: mix(DEEP.bottom, SHALLOW.bottom), density: lerp(DEEP.density, SHALLOW.density, k) };
}

// ---------------------------------------------------------------- istasyon ışıkları

export interface StationLights {
  /** Pencere parıltısı 0..1. */
  windows: number;
  /** Yanan kılavuz lambası kesri 0..1 (uzaktakiler önce söner). */
  guides: number;
  beacon: boolean;
}

/** Işıklar `k` (0 → 1) boyunca söner: pencereler kısa titremelerle kademe kademe, lambalar tek tek, fener en son. */
export function lightsAt(k: number): StationLights {
  const c = clamp01(k);
  const steps = [0.18, 0.42, 0.63, 0.82];
  let windows = 1 - steps.filter((s) => c >= s).length / steps.length;
  // Her kademeden hemen önce kısa titreme
  if (steps.some((s) => c > s - 0.035 && c < s - 0.015)) windows = Math.max(0, windows - 0.6);
  return { windows, guides: clamp01(1 - c / 0.9), beacon: c < 0.93 };
}

// ---------------------------------------------------------------- yaratık

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Burnun yatay yönü (exterior.ts'teki gölge gövdesi: kuyruk +z). */
  yaw: number;
  /** Burun yukarı pozitif. */
  pitch: number;
}

export interface FollowOpts {
  /** Taban yüksekliği: gövde bunun altına inmez. */
  floorY: number;
  /** Yaklaştığı yatay yön (birim). */
  side: [number, number];
}

/** Takibin durduğu an (u): bundan sonra yaratık yükselmez, kapsül uzaklaşır. */
export const FOLLOW_STOP = 0.42;
const TURN_END = 0.58;
const MIN_ABOVE_FLOOR = 3;

type V3 = { x: number; y: number; z: number };

/** Yaklaşma: kapsülün 26 m altından ve 40 m yanından, 15 m altına ve 16 m yanına (kapsülle birlikte yükselir; kapsülün
 * tabanı görüşü örtmesin diye tam altına girmez, ~45° aşağıda kalır). */
function approach(u: number, cap: V3, o: FollowOpts): V3 {
  const k = ease(clamp01(u / FOLLOW_STOP));
  const lateral = lerp(40, 16, k);
  return { x: cap.x + o.side[0] * lateral, y: Math.max(o.floorY + MIN_ABOVE_FLOOR, cap.y - lerp(26, 15, k)), z: cap.z + o.side[1] * lateral };
}

/** Durduktan sonra: yerinde döner, sonra aşağı ve yana, sise dalar. */
function depart(u: number, stop: V3, o: FollowOpts): V3 {
  const k = clamp01((u - TURN_END) / (1 - TURN_END));
  const d = k * k;
  return { x: stop.x + o.side[0] * 22 * d, y: Math.max(o.floorY + MIN_ABOVE_FLOOR, stop.y - 32 * d), z: stop.z + o.side[1] * 22 * d };
}

/** Yaratığın durduğu nokta (takip `FOLLOW_STOP`'a vardığında kapsül `capAtStop`'tayken). */
export const followStop = (capAtStop: V3, o: FollowOpts) => approach(FOLLOW_STOP, capAtStop, o);

/**
 * Takip yolu, u ∈ [0, 1]. `cap`: kapsülün şimdiki yeri. `stop`: durma noktası (u ≥ FOLLOW_STOP için; yoksa şimdiki
 * kapsülden hesaplanır). Yön, yolun türevinden: burun gidiş yönüne bakar; dönüş aralığında yavaşça çevrilir.
 */
export function creatureAt(u: number, cap: V3, o: FollowOpts, stop: V3 = followStop(cap, o)): Pose {
  const at = (v: number) => (v <= FOLLOW_STOP ? approach(v, cap, o) : depart(v, stop, o));
  const p = at(u);
  // Yaklaşırken: kapsüle (yukarı-içe) bakar; ayrılırken: aşağı-dışa. Dönüş aralığında ikisi arasında.
  const up = { x: -o.side[0], y: 0.9, z: -o.side[1] };
  const down = { x: o.side[0], y: -0.9, z: o.side[1] };
  const t = ease(clamp01((u - FOLLOW_STOP) / (TURN_END - FOLLOW_STOP)));
  const dir = { x: lerp(up.x, down.x, t), y: lerp(up.y, down.y, t), z: lerp(up.z, down.z, t) };
  // Dönüşün ortasında yatay yön sıfırdan geçmesin: yana doğru kıvrılır
  const sideways = Math.sin(t * Math.PI) * 0.8;
  dir.x += -o.side[1] * sideways;
  dir.z += o.side[0] * sideways;
  const horiz = Math.hypot(dir.x, dir.z) || 1e-6;
  return { ...p, yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.atan2(dir.y, horiz) };
}
