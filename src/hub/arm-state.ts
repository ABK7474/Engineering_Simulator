// Kolların durumu (saf, Three.js'siz): sol kol bilek cihazıyla dinlenir ya da kaldırılır (Q bakış, M harita,
// N defter); sağ kol E'de panele uzanır. Kaldırma yumuşak (~0,3 s); uzanma kısa bir ileri-geri hareket ve
// uzanmanın tepesinde panel açılır. Yürürken iki kol da hafifçe sallanır.

export type ArmMode = 'rest' | 'glance' | 'map' | 'notebook';

export const RAISE_SECONDS = 0.3;
export const REACH_SECONDS = 0.42;
/** Uzanmanın tepe anı (panel bu anda açılır). */
export const REACH_PEAK = 0.55;

export interface ArmPose {
  /** Sol kolun kalkıklığı 0 (dinlenme) … 1 (yüze kaldırılmış). */
  raise: number;
  /** Sağ kolun uzanması 0 … 1 … 0. */
  reach: number;
  /** Yürüme salınımı (m). */
  bobX: number;
  bobY: number;
}

const ease = (k: number) => k * k * (3 - 2 * k);

export class ArmState {
  mode: ArmMode = 'rest';
  private level = 0;
  private reachT = -1;
  private reachFired = true;
  private onPeak: (() => void) | null = null;
  private phase = 0;
  private sway = 0;

  setMode(m: ArmMode): void {
    this.mode = m;
  }

  /** Kol hedef konumunda mı (kaldırıldıysa tam kalkık, indiyse tam inik). */
  get settled(): boolean {
    return this.mode === 'rest' ? this.level <= 0.001 : this.level >= 0.999;
  }

  /** Sağ el uzanır; `peak` uzanmanın tepesinde bir kez çağrılır (panel açılışı). */
  reach(peak?: () => void): void {
    this.reachT = 0;
    this.reachFired = false;
    this.onPeak = peak ?? null;
  }

  get reaching(): boolean {
    return this.reachT >= 0;
  }

  update(dt: number, speed: number): ArmPose {
    const target = this.mode === 'rest' ? 0 : 1;
    const step = dt / RAISE_SECONDS;
    this.level = target > this.level ? Math.min(target, this.level + step) : Math.max(target, this.level - step);
    let reach = 0;
    if (this.reachT >= 0) {
      this.reachT += dt;
      const k = this.reachT / REACH_SECONDS;
      reach = Math.sin(Math.min(1, k) * Math.PI);
      if (!this.reachFired && k >= REACH_PEAK) {
        this.reachFired = true;
        this.onPeak?.();
      }
      if (k >= 1) this.reachT = -1;
    }
    // Yürüyüş salınımı: hızla artar, durunca söner
    this.sway += (Math.min(1, speed / 2.8) - this.sway) * Math.min(1, dt * 6);
    this.phase += dt * (4 + speed * 2.2);
    return {
      raise: ease(this.level),
      reach,
      bobX: Math.sin(this.phase) * 0.012 * this.sway,
      bobY: Math.abs(Math.cos(this.phase)) * 0.016 * this.sway,
    };
  }
}
