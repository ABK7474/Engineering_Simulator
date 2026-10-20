// Oyuncu hareketinin saf kuralları (three.js'siz, test edilebilir): yürüme/koşma/eğilme hızları,
// göz ve gövde yükseklikleri, gürültü seviyesi, adım sesi profili, yüksekliğe bağlı çarpışma.

export type MoveMode = 'idle' | 'crouch' | 'walk' | 'run';

export const WALK_SPEED = 2.8;
export const RUN_FACTOR = 1.6;
export const CROUCH_FACTOR = 0.5;

/** Göz yüksekliği (kamera) ve çarpışma için gövde yüksekliği (m). */
export const EYE = { stand: 1.6, crouch: 1.0 } as const;
export const BODY = { stand: 1.75, crouch: 1.05 } as const;

export function moveMode(input: { moving: boolean; run: boolean; crouched: boolean }): MoveMode {
  if (!input.moving) return 'idle';
  if (input.crouched) return 'crouch'; // eğilirken koşulmaz
  return input.run ? 'run' : 'walk';
}

/** İleri tuşuna iki kez bu süre içinde basılırsa koşu başlar (Minecraft gibi). */
export const DOUBLE_TAP_MS = 300;

/**
 * Çift dokunuşla koşma: ileri tuşu bırakılınca ya da oyuncu eğilince koşu biter.
 * Tuş tekrarı (basılı tutma) dokunuş sayılmaz.
 */
export function createSprint() {
  let lastTap = -Infinity;
  let sprinting = false;
  return {
    get sprinting() {
      return sprinting;
    },
    forwardDown(timeMs: number, repeat = false) {
      if (repeat) return;
      if (timeMs - lastTap <= DOUBLE_TAP_MS) {
        sprinting = true;
        lastTap = -Infinity; // üçüncü dokunuş yeni bir çift başlatır
      } else lastTap = timeMs;
    },
    forwardUp() {
      sprinting = false;
    },
    cancel() {
      sprinting = false;
    },
  };
}

export function speedFor(mode: MoveMode): number {
  return mode === 'run' ? WALK_SPEED * RUN_FACTOR : mode === 'crouch' ? WALK_SPEED * CROUCH_FACTOR : mode === 'walk' ? WALK_SPEED : 0;
}

/**
 * Oyuncunun çevreye yaydığı gürültü: eğilme 0, yürüme 1, koşma 2. Hareketsiz durmak da 0.
 * Şimdilik hiçbir sistem kullanmıyor; sonraki adımlar (ör. istasyonun dinleyen sensörleri) için hazır.
 */
export function noiseLevel(mode: MoveMode): 0 | 1 | 2 {
  return mode === 'run' ? 2 : mode === 'walk' ? 1 : 0;
}

/** Adım sesi: koşarken sık ve yüksek, eğilirken seyrek ve kısık. `stride` iki adım arası metre. */
export function stepProfile(mode: MoveMode): { stride: number; volume: number } {
  switch (mode) {
    case 'run':
      return { stride: 0.85, volume: 0.85 };
    case 'crouch':
      return { stride: 0.55, volume: 0.22 };
    default:
      return { stride: 0.65, volume: 0.55 };
  }
}

/** Saniyede adım sayısı (hız / adım aralığı). */
export const stepsPerSecond = (mode: MoveMode) => (mode === 'idle' ? 0 : speedFor(mode) / stepProfile(mode).stride);

export interface Aabb {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** Kutu, verilen gövde yüksekliğindeki oyuncuyu engeller mi (altından geçilebilir mi)? */
export function blocksBody(box: Aabb, bodyHeight: number): boolean {
  return box.min.y < bodyHeight && box.max.y > 0;
}

/** Eğilmişken ayağa kalkılabilir mi: başın üstünde, ayakta kalınca çarpılacak bir şey var mı? */
export function canStand(x: number, z: number, radius: number, colliders: readonly Aabb[]): boolean {
  return !colliders.some((b) => {
    if (!blocksBody(b, BODY.stand)) return false;
    const cx = Math.min(Math.max(x, b.min.x), b.max.x);
    const cz = Math.min(Math.max(z, b.min.z), b.max.z);
    return (x - cx) ** 2 + (z - cz) ** 2 < radius * radius;
  });
}
