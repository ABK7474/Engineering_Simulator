// Ses karışımının saf kısmı: ayarların okunması, katman kazançları, adım sayacı.

export interface VolumeSettings {
  music: number;
  sfx: number;
  muted: boolean;
}

/** Varsayılanlar bilerek düşük. */
export const DEFAULT_VOLUME: VolumeSettings = { music: 0.4, sfx: 0.5, muted: false };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** localStorage'dan gelen ham metni doğrular; bozuksa varsayılana döner. */
export function parseSettings(raw: string | null): VolumeSettings {
  if (!raw) return { ...DEFAULT_VOLUME };
  try {
    const o = JSON.parse(raw) as Partial<VolumeSettings>;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : d);
    return {
      music: num(o.music, DEFAULT_VOLUME.music),
      sfx: num(o.sfx, DEFAULT_VOLUME.sfx),
      muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_VOLUME.muted,
    };
  } catch {
    return { ...DEFAULT_VOLUME };
  }
}

/**
 * Eşit güçlü çapraz geçiş: gerilim 0 → yalnız sakin, 1 → gerilim baskın ama sakin katman
 * tamamen kesilmez (alttan devam eder).
 */
export function layerGains(tension: number): { calm: number; tension: number } {
  const t = clamp01(tension);
  return { calm: 0.35 + 0.65 * Math.cos((t * Math.PI) / 2), tension: Math.sin((t * Math.PI) / 2) };
}

/** Yürünen mesafeyi biriktirir; her `stride` metrede bir adım üretir. */
export class StrideCounter {
  private acc = 0;
  constructor(private stride: number) {}
  /** Bu kare kaç adım sesi çalınacağını döndürür. */
  add(distance: number): number {
    if (!(distance > 0)) return 0;
    this.acc += distance;
    const steps = Math.floor(this.acc / this.stride);
    this.acc -= steps * this.stride;
    return steps;
  }
  reset(): void {
    this.acc = 0;
  }
}
