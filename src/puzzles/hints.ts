// İpuçları: tür başına iki kademe. Birincisi yöntemi hatırlatır; ikincisi (varsa) problemden hesaplanmış bir ara
// değer verir. Hiçbiri cevabın kendisini vermez. Her ipucu kaynak harcatır (content/balance → hintCost).

import type { StageDef } from '../core/types';
import type { AlgoTraceProblem } from '../solvers/algo/algo-trace';
import type { CsProblem } from '../solvers/cs/cs-output';
import type { DsTraceProblem } from '../solvers/ds/ds-trace.generate';
import type { LaplaceProblem } from '../solvers/math/laplace.generate';
import type { PhasorProblem } from '../solvers/math/phasor.generate';
import type { StabilityProblem } from '../solvers/math/stability.generate';
import type { DampingProblem } from '../solvers/ode/damping.generate';
import { tau } from '../solvers/ode/light-decay';
import type { LightDecayProblem } from '../solvers/ode/light-decay.generate';
import type { ProbProblem } from '../solvers/prob/probability.generate';

const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',').replace(/^-/, '−');

const METHOD: Record<StageDef['type'], [string, string]> = {
  'series-led': [
    'Seri devrede akım her yerde aynıdır: I = (Vs − ΣV_f)/R. Önce LED\'lerin toplam ileri gerilimini kaynaktan çıkar.',
    'Hedef akım aralığının ortasından R = (Vs − ΣV_f)/I hesapla; kutudaki en yakın değerin iki uçta da aralıkta kaldığını kontrol et.',
  ],
  'series-parallel': [
    'Gizli direnci önce eski ölçümden bul: gerilim bölücü V = Vs·R₂/(R₁ + R₂) bağıntısını tersinden çöz.',
    'Paralel kolda gerilim ortaktır, akımlar toplanır. Hedef akımlardan düğüm gerilimini, sonra her kolun direncini bul.',
  ],
  'ds-trace': [
    'Her satırı bir öncekinden kodu izleyerek yeniden hesapla. İlk uyuşmayan satır şüphelidir; düzeltince sonraki satırların hepsi tutarlı olmalı.',
    'Yığın tepeden, kuyruk baştan çıkarır; bağlı listede Find ilk eşleşmeyi bulur.',
  ],
  thevenin: [
    'Vth: a–b açıkken (yük yok) uçlar arasındaki gerilim. Rth: gerilim kaynaklarını kısa devre, akım kaynaklarını açık devre yapıp a–b\'den görülen direnç.',
    'Kontrol: Norton akımı In = Vth/Rth, a–b kısa devre edilince akan akımdır; iki yoldan bulduğun değer tutmalı.',
  ],
  'max-power': [
    'İki yük testi iki denklem verir: V₁ = Vth·R₁/(R₁ + Rth), V₂ = Vth·R₂/(R₂ + Rth). İkisini oranlarsan Vth düşer, Rth kalır.',
    'Yüke en çok güç R_yük = Rth iken aktarılır; P = Vth²/(4Rth). Kutuda bu şartı %98 sağlayan tek değeri ara.',
  ],
  opamp: [
    'İki çalışma noktası iki denklem verir: V_out = G·V_s + V_ofs. Önce G = ΔV_out/ΔV_s (aralıkların oranı).',
    'Evirmeyen kazanç 1 + Rf/Rin\'dir, Rf/Rin değil. Ofseti referans bölücüsünün katkısıyla, işaretine dikkat ederek yaz.',
  ],
  'rc-rl': [
    'Eşiğe varış süresi t = τ·ln((V_son − V₀)/(V_son − V_eşik)); τ = RC (RL\'de L/R). Ön yükü (V₀ ya da I₀) unutma.',
    'Pencerenin ortasını hedefle: oradan τ\'yu, sonra R\'yi bul; kutudaki en yakın değerin pencerede kaldığını kontrol et.',
  ],
  superposition: [
    'Kaynakları tek tek bırak: gerilim kaynağını kısa devre, akım kaynağını açık devre yaparak her birinin katkısını bul; katkılar toplanır.',
    'Ölçülen toplam − bilinen kaynağın katkısı = bilinmeyenin katkısı. Bilinmeyenin katkısı değeriyle doğru orantılıdır.',
  ],
  diode: [
    'Shockley: I = I_s·(e^(V/(n·V_T)) − 1). Seri dirençle V_s = I·R + V_D; iki bağıntı birlikte sağlanmalı (yük doğrusu).',
    'Yineleme: V_D tahmin et → I = (V_s − V_D)/R → V_D = n·V_T·ln(I/I_s + 1) → tekrarla. Birkaç turda oturur.',
  ],
  filter: [
    'Birinci mertebe alçak geçiren: |H(f)| = 1/√(1 + (f/f_c)²). Sinyal şartı f_c\'yi alttan, gürültü şartı üstten sınırlar.',
    'dB → oran: |H| = 10^(dB/20). Her şarttan f_c sınırını çöz, sonra R\'yi f_c = 1/(2πRC) (RL\'de R/(2πL)) ile bul.',
  ],
  damping: [
    'Önce serbest periyottan yay sabiti: ω_n = 2π/T₀, k = m·ω_n². Kritik sönüm c = 2·√(m·k); ζ = c/(2√(mk)).',
    '',
  ],
  stability: [
    '2×2 sistemde özdeğerler λ² − iz(A)·λ + det(A) = 0\'dan gelir. İz ve determinantı k cinsinden yaz; Re λ ve ζ = −Re λ/|λ| şartlarını ayrı ayrı dene.',
    '',
  ],
  laplace: [
    'Son değer teoremi: y(∞) = lim s→0 s·Y(s). Basamak girişte Y(s) = G(s)·U/s olduğundan y(∞) = U·G(0). Başlangıç eğimi için s → ∞ limiti.',
    '',
  ],
  phasor: [
    'Her fazörü gerçel ve sanal kısma ayır: A·cos φ + j·A·sin φ. Topla; genlik √(re² + im²), faz atan2(im, re).',
    '',
  ],
  probability: [
    'Bayes: P(K | gözlem) = P(gözlem | K)·P(K) / P(gözlem). Binom: P(X = k) = C(n,k)·qᵏ·(1−q)ⁿ⁻ᵏ. Poisson: P(N = k) = e^(−λ)·λᵏ/k!.',
    '',
  ],
  'algo-trace': [
    'Her satırı bir öncekinden kodu izleyerek yeniden hesapla. Bozuk satırdan sonraki satır da uyuşmuyor görünür; ama onu düzeltmek tabloyu onarmaz.',
    '',
  ],
  'cs-output': [
    'Değer tipleri kopyalanır, referans tipleri paylaşılır; lambda değişkenin kendisini yakalar; LINQ ve yield numaralandırılana kadar çalışmaz; finally her çıkışta çalışır.',
    '',
  ],
  'light-decay': [
    'τ = (R + R_L)·C ve V_L(t) = V₀·R_L/(R + R_L)·e^(−t/τ). R hem başlangıç parlaklığını hem sönüm hızını değiştirir: iki şartı birlikte dene.',
    '',
  ],
};

const half = (bad: number, n: number) => {
  const h = Math.ceil(n / 2);
  return bad < h ? `Bozuk adım ilk yarıda (adım 1–${h}).` : `Bozuk adım ikinci yarıda (adım ${h + 1}–${n}).`;
};

/** Problemden hesaplanan ikinci kademe (cevabı vermeyen bir ara değer); yoksa yöntem ipucunun ikincisi. */
function computed(type: StageDef['type'], problem: unknown): string {
  switch (type) {
    case 'ds-trace': {
      const p = problem as DsTraceProblem;
      return half(p.bad, p.rows.length);
    }
    case 'algo-trace': {
      const p = problem as AlgoTraceProblem;
      return half(p.bad, p.rows.length);
    }
    case 'damping': {
      const p = problem as DampingProblem;
      return `Ara değer: ω_n = 2π/T₀ = ${num(p.hand.wn)} rad/s, yani k = m·ω_n² = ${num(p.hand.k)} N/m.`;
    }
    case 'stability': {
      const { a, b, c } = (problem as StabilityProblem).plant;
      return `Ara değer: kökler k = (a + c)²/(4b) = ${num((a + c) ** 2 / (4 * b))} değerinde çakışır (ζ = 1); bunun üstünde kökler karmaşık olur.`;
    }
    case 'laplace': {
      const { K, z, p1, p2 } = (problem as LaplaceProblem).g;
      return `Ara değer: G(0) = K·z/(p₁·p₂) = ${num((K * z) / (p1 * p2))}.`;
    }
    case 'phasor': {
      const w = (problem as PhasorProblem).w1;
      const r = (w.phi * Math.PI) / 180;
      return `Ara değer: A₁∠φ₁ = ${num(w.a * Math.cos(r))} + ${num(w.a * Math.sin(r))}j mV.`;
    }
    case 'probability': {
      const p = problem as ProbProblem;
      if (p.variant === 'bayes') {
        const b = p.input;
        const l2 = b.obs === 'both' ? b.sens2 / 100 : 1 - b.sens2 / 100;
        return `Ara değer: pay P(gözlem | K)·P(K) = ${num((b.sens1 / 100) * l2 * (b.prior / 100))}.`;
      }
      if (p.variant === 'binomial') return `Ara değer: n = ${p.need} pompa ile hepsi çalışmalı: P = q^${p.need} = ${num((p.q / 100) ** p.need)}.`;
      return `Ara değer: hiç arıza olmama olasılığı P(N = 0) = e^(−λ) = ${num(Math.exp(-p.lambda))}.`;
    }
    case 'cs-output': {
      const p = problem as CsProblem;
      return `Konu: ${p.template.title}. İlk satır: "${p.instance.output[0]}".`;
    }
    case 'light-decay': {
      const p = problem as LightDecayProblem;
      const other = p.bin.find((b) => b.r !== p.answer)!;
      return `Örnek: R = ${num(other.r)} Ω için τ = ${num(tau(p.params, other.r))} s ve V_L(0) = ${num((p.params.v0 * p.params.rl) / (other.r + p.params.rl))} V.`;
    }
    default:
      return METHOD[type][1];
  }
}

export function hintsFor(type: StageDef['type'], problem: unknown): string[] {
  return [METHOD[type][0], computed(type, problem)].filter((h) => h.length > 0);
}
