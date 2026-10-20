// Seri devre çözücü: pil + direnç + LED. Cevabı bu kod hesaplar (altın kural 1).

/** Diyot modeli. İleride Shockley + Newton buraya yeni bir tür olarak eklenir. */
export type DiodeModel = { kind: 'constant-vf'; vf: number };

export interface LedPart {
  color: string;
  model: DiodeModel;
}

/** Somut bir problemin fiziksel parametreleri (SI birimleri). */
export interface SeriesLedSpec {
  vs: number;
  led: LedPart;
  targetMin: number;
  targetMax: number;
  absMax: number;
  visibleMin: number;
  fuse: number;
  resistorRating: number;
}

export interface SeriesLedSolution {
  r: number;
  current: number;
  vResistor: number;
  vLed: number;
  pResistor: number;
  pLed: number;
}

/** Fiziksel durum bölgesi. Hata sonucu havuzu bölgeye göre seçilir. */
export type Zone =
  | 'ok'
  | 'no_light'
  | 'dim'
  | 'over_mild'
  | 'over_severe'
  | 'fuse'
  | 'resistor_overheat';

export function solveSeriesLed(vs: number, model: DiodeModel, r: number): SeriesLedSolution {
  if (!(r > 0)) throw new Error(`Geçersiz direnç: ${r}`);
  // Sabit Vf modeli: Vs > Vf ise LED iletir ve gerilimi Vf'ye kenetlenir; değilse akım 0.
  // KVL: Vs = I·R + Vf  →  I = (Vs − Vf) / R
  const current = Math.max(0, (vs - model.vf) / r);
  const vResistor = current * r;
  const vLed = current > 0 ? model.vf : vs;
  return {
    r,
    current,
    vResistor,
    vLed,
    pResistor: current * current * r,
    pLed: current * model.vf,
  };
}

export function classify(spec: SeriesLedSpec, sol: SeriesLedSolution): Zone {
  const i = sol.current;
  if (i >= spec.fuse) return 'fuse';
  if (i >= spec.absMax) return 'over_severe';
  if (i > spec.targetMax) return 'over_mild';
  if (i < spec.visibleMin) return 'no_light';
  if (i < spec.targetMin) return 'dim';
  if (sol.pResistor > spec.resistorRating) return 'resistor_overheat';
  return 'ok';
}

/** Akım bölge sınırları (artan sırada). Doğrulayıcı seçeneklerin sınıra yapışmadığını kontrol eder. */
export function currentBoundaries(spec: SeriesLedSpec): number[] {
  return [spec.visibleMin, spec.targetMin, spec.targetMax, spec.absMax, spec.fuse];
}

/** İçerik JSON'undaki ham yapılandırma (mA cinsinden, okunaklı). */
export interface SeriesLedConfig {
  supplyVoltages: number[];
  leds: { color: string; vf: number }[];
  targetMin: number;
  targetMax: number;
  absMax: number;
  visibleMin: number;
  fuse: number;
  resistorRating: number;
}

export function parseSeriesLedConfig(raw: unknown): SeriesLedConfig {
  const o = raw as Record<string, unknown>;
  const numArr = (k: string) => {
    const v = o[k];
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'number' && x > 0)) {
      throw new Error(`series-led yapılandırması: '${k}' pozitif sayı dizisi olmalı`);
    }
    return v as number[];
  };
  const pos = (k: string) => {
    const v = o[k];
    if (typeof v !== 'number' || !(v > 0)) {
      throw new Error(`series-led yapılandırması: '${k}' pozitif sayı olmalı`);
    }
    return v;
  };
  const leds = o.leds;
  if (
    !Array.isArray(leds) ||
    leds.length === 0 ||
    !leds.every((l) => typeof l?.color === 'string' && typeof l?.vf === 'number' && l.vf > 0)
  ) {
    throw new Error("series-led yapılandırması: 'leds' {color, vf} dizisi olmalı");
  }
  const cfg: SeriesLedConfig = {
    supplyVoltages: numArr('supplyVoltages'),
    leds: leds as SeriesLedConfig['leds'],
    targetMin: pos('targetMin_mA') / 1000,
    targetMax: pos('targetMax_mA') / 1000,
    absMax: pos('absMax_mA') / 1000,
    visibleMin: pos('visibleMin_mA') / 1000,
    fuse: pos('fuse_mA') / 1000,
    resistorRating: pos('resistorRating_W'),
  };
  const order = [cfg.visibleMin, cfg.targetMin, cfg.targetMax, cfg.absMax, cfg.fuse];
  if (!order.every((x, k) => k === 0 || order[k - 1] < x)) {
    throw new Error('series-led yapılandırması: visibleMin < targetMin < targetMax < absMax < fuse olmalı');
  }
  return cfg;
}
