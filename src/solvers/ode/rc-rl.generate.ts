// rc-rl üretici + doğrulayıcı. Cevap R önce E12'den seçilir; pencere onun ateşleme anından açılır.
// Kurallar: pencere bitişik E12 değerlerinin (cevabın bir altı/üstü) anını içermez; kutuda pencereye düşen
// tek aday cevaptır; kapalı form ve RK4 her aday için %0,1 içinde uyuşur; gösterilen (yuvarlanmış)
// sayılarla elle hesap aynı sonucu verir. Sağlanamazsa 200 denemeden sonra açıklamalı hata.

import { formatOhm } from '../../core/format';
import { createRng, pick, shuffle, type Rng } from '../../core/rng';
import { nearestE12, shown } from '../circuit/design-core';
import { e12Values } from '../circuit/e-series';
import { crossingClosed, crossingRk4, type CircuitKind, type Params, type RcRlConfig } from './rc-rl';

export const MAX_ATTEMPTS = 200;
/** Pencere dışındaki adaylar pencereden en az bu oranda uzak olmalı (sınırda belirsizlik yok). */
export const OUTSIDE_MARGIN = 0.03;
/** Kapalı form ile RK4 arasındaki izinli göreli fark. */
export const ODE_AGREEMENT = 1e-3;

export interface RcRlCard {
  id: string;
  r: number;
  label: string;
  mistake?: string;
}

export interface RcRlProblem {
  seed: number;
  kind: CircuitKind;
  /** Gösterilen değerlerle (3 basamak) parametreler; fizik de bunlarla hesaplanır. */
  params: Params;
  tmin: number;
  tmax: number;
  answer: number;
  bin: RcRlCard[];
}

const inWindow = (t: number | null, lo: number, hi: number) => t !== null && t >= lo && t <= hi;

export function verifyRcRl(c: RcRlConfig, p: RcRlProblem): string[] {
  const errors: string[] = [];
  const rs = p.bin.map((b) => b.r);
  if (new Set(rs).size !== rs.length) errors.push('kutuda aynı değer iki kez');
  if (p.bin.length !== c.binSize) errors.push('kutu boyutu yanlış');
  if (!rs.includes(p.answer)) errors.push('cevap kutuda yok');
  const all = e12Values();
  const idx = all.indexOf(p.answer);
  for (const nb of [all[idx - 1], all[idx + 1]]) {
    if (nb !== undefined && inWindow(crossingClosed(p.params, nb), p.tmin, p.tmax)) errors.push(`bitişik E12 (${nb} Ω) pencereye düşüyor`);
  }
  let inside = 0;
  for (const r of rs) {
    const a = crossingClosed(p.params, r);
    const b = crossingRk4(p.params, r);
    if ((a === null) !== (b === null) || (a !== null && b !== null && Math.abs(b / a - 1) > ODE_AGREEMENT)) errors.push(`${r} Ω: kapalı form ile RK4 uyuşmuyor`);
    if (inWindow(a, p.tmin, p.tmax)) inside++;
    if (r === p.answer && !inWindow(a, p.tmin, p.tmax)) errors.push('cevap pencerede değil');
    if (r !== p.answer && a !== null && a > p.tmin * (1 - OUTSIDE_MARGIN) && a < p.tmax * (1 + OUTSIDE_MARGIN)) errors.push(`${r} Ω pencereye çok yakın`);
  }
  if (inside !== 1) errors.push(`pencerede ${inside} aday var (1 olmalı)`);
  return [...new Set(errors)];
}

function pickParams(c: RcRlConfig, rng: Rng, kind: CircuitKind): Params {
  const vs = pick(rng, c.vs);
  if (kind === 'rc') return { kind, vs, c: pick(rng, c.rc.C_uF) * 1e-6, v0: shown(pick(rng, c.rc.v0) * vs), vth: shown(pick(rng, c.rc.vth) * vs) };
  return { kind, vs, l: pick(rng, c.rl.L_mH) * 1e-3, i0: pick(rng, c.rl.i0_mA) * 1e-3, ith: pick(rng, c.rl.ith_mA) * 1e-3 };
}

/** Hedef ana göre, verilen (yanlış) formülle R'yi çözer (log ölçekte ikiye bölme); bulunamazsa null. */
function solveR(f: (r: number) => number | null, target: number): number | null {
  let lo = 0.1;
  let hi = 1e7;
  const g = (r: number) => {
    const t = f(r);
    return t === null ? Infinity : t - target;
  };
  if (Math.sign(g(lo)) === Math.sign(g(hi))) return null;
  for (let k = 0; k < 80; k++) {
    const mid = Math.sqrt(lo * hi);
    if (Math.sign(g(mid)) === Math.sign(g(lo))) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

function candidate(c: RcRlConfig, rng: Rng, seed: number): RcRlProblem | string {
  const kind = pick(rng, c.kinds);
  const params = pickParams(c, rng, kind);
  const answer = pick(rng, e12Values(...c.answer[kind]));
  const t = crossingClosed(params, answer);
  if (t === null || !(t > 0)) return 'cevap eşiğe ulaşmıyor';
  const tmin = shown(t * (1 - c.window));
  const tmax = shown(t * (1 + c.window));

  const cards: Omit<RcRlCard, 'id'>[] = [{ r: answer, label: formatOhm(answer) }];
  const add = (r: number | null, mistake?: string) => {
    if (r === null || !(r > 0) || !Number.isFinite(r)) return;
    const e = nearestE12(r);
    if (cards.length < c.binSize && !cards.some((x) => x.r === e)) cards.push({ r: e, label: formatOhm(e), mistake });
  };
  const mid = (tmin + tmax) / 2;
  if (params.kind === 'rc') {
    const { vs, v0, vth } = params;
    add(mid / (params.c * Math.log(vs / (vs - vth))), 'Ön yük unutulmuş: kondansatör 0 V\'tan başlıyor sanılmış (V₀ hesaba katılmalı).');
    add(mid / params.c, 'Ateşleme anı zaman sabitine (t = RC) eşit alınmış; eşiğe varış süresi τ·ln(...) ile bulunur.');
    add(mid / (params.c * Math.log10((vs - v0) / (vs - vth))), 'Doğal logaritma yerine log₁₀ kullanılmış.');
  } else {
    const { vs, l, ith } = params;
    add(solveR((r) => (vs / r > ith ? (l / r) * Math.log(vs / r / (vs / r - ith)) : null), mid), 'Bobindeki ilk akım unutulmuş: akım 0\'dan başlıyor sanılmış (I₀ hesaba katılmalı).');
    add(l / mid, 'Ateşleme anı zaman sabitine (t = L/R) eşit alınmış.');
    add((vs / ith) * 1.6, 'Seri direnç çok büyük: kalıcı akım Vs/R çekme akımının altında kalır, valf hiç ateşlemez.');
  }
  for (const r of shuffle(rng, e12Values(answer / 6, answer * 6))) add(r);
  if (cards.length < c.binSize) return 'kutu doldurulamadı';
  return { seed, kind, params, tmin, tmax, answer, bin: shuffle(rng, cards).map((x, k) => ({ ...x, id: `b${k}` })) };
}

export function generateRcRl(c: RcRlConfig, seed: number): RcRlProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  const reject = (w: string) => reasons.set(w, (reasons.get(w) ?? 0) + 1);
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const cand = candidate(c, rng, seed);
    if (typeof cand === 'string') {
      reject(cand);
      continue;
    }
    const errors = verifyRcRl(c, cand);
    if (!errors.length) return cand;
    reject(errors[0]);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`rc-rl problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}
