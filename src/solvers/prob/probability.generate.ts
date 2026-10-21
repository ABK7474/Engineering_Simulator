// Olasılık üretici + doğrulayıcı + sonuç + rapor. Bayes: klasik hatalar (taban oranını yok saymak, tek sensör,
// önsel %50) doğru cevaptan açıkça ayrışmalı; binom/Poisson: en küçük yeterli sayı tek, komşular şarttan
// açık farkla ayrı. Her problem Monte Carlo ile teyit edilir.

import { createRng, pick } from '../../core/rng';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';
import { atLeast, atLeastMonteCarlo, bayesExact, bayesMonteCarlo, mcRng, poissonCdfGamma, poissonCdfSeries, poissonMonteCarlo, type BayesInput, type ProbConfig } from './probability';
import { Frac } from './fraction';

export const MAX_ATTEMPTS = 200;

export interface CountCard {
  id: string;
  n: number;
  label: string;
  sub: string;
}

export type BayesTheme = 'leak' | 'contact';

/** Bayes aşamasının hikâye metinleri; matematik iki temada aynı. */
export const BAYES_TEXT: Record<BayesTheme, {
  ev: string; s1: string; s2: string; both: string; firstOnly: string; prior: string; task: string; field: string; svg: string;
  falseHead: string; falseText: string; ignoredHead: string; ignoredText: string; okText: string;
}> = {
  leak: {
    ev: 'kaçak', s1: 'S1', s2: 'S2',
    both: 'Şu an ikisi de alarm veriyor.', firstOnly: 'Şu an S1 alarm veriyor, S2 sessiz.',
    prior: 'Bölmede kaçak olma olasılığı (bakım kayıtlarından)',
    task: 'Bu gözlem altında bölmede gerçekten kaçak olma olasılığını hesapla; tahliye kararı buna göre verilecek.',
    field: 'P(kaçak | gözlem) (%)', svg: 'bölmede kaçak önsel olasılığı',
    falseHead: 'Boşa tahliye', falseText: 'Kaçak olasılığı abartıldı: bölme boşuna kapatıldı, pompalar boşuna çalıştı.',
    ignoredHead: 'Kaçak göz ardı edildi', ignoredText: 'Kaçak olasılığı küçümsendi: su sızmaya devam etti.',
    okText: 'Bakım ekibi doğru önceliklendirildi.',
  },
  contact: {
    ev: 'canlı', s1: 'sonar', s2: 'hidrofon',
    both: 'Şu an aktif sonar da pasif hidrofon da temas bildiriyor.', firstOnly: 'Şu an aktif sonar temas bildiriyor, pasif hidrofon sessiz.',
    prior: 'Bu derinlikte bir sonar temasının büyük bir canlı olma olasılığı (istasyon kayıtlarından)',
    task: 'Bu gözlem altında temasın gerçekten büyük bir canlı olma olasılığını hesapla; karartma kararı buna göre verilecek.',
    field: 'P(canlı | gözlem) (%)', svg: 'temasın canlı olma önsel olasılığı',
    falseHead: 'Boşa karartma', falseText: 'Olasılık abartıldı: istasyon boşuna karartıldı, ısıtıcılar ve pompalar durdu.',
    ignoredHead: 'Temas küçümsendi', ignoredText: 'Olasılık küçümsendi: hazırlık geç başladı, yaratık istasyona yaklaştı.',
    okText: 'Karartma kararı doğru verildi.',
  },
};

export type ProbProblem =
  | { seed: number; variant: 'bayes'; theme: BayesTheme; input: BayesInput; answer: number; tolerance: number; mistakes: { value: number; text: string }[] }
  | { seed: number; variant: 'binomial'; q: number; need: number; reliability: number; answer: number; bin: CountCard[]; table: { n: number; p: number }[] }
  | { seed: number; variant: 'poisson'; lambda: number; reliability: number; answer: number; bin: CountCard[]; table: { n: number; p: number }[] };

const pctStr = (p: number, d = 2) => `%${(p * 100).toFixed(d).replace('.', ',')}`;
const num = (x: number) => String(x).replace('.', ',');
export const bayesTolerance = (p: number) => Math.max(0.002, 0.02 * p);

function genBayes(c: ProbConfig, rng: () => number, seed: number): ProbProblem | string {
  const input: BayesInput = {
    prior: pick(rng, c.bayes.prior),
    sens1: pick(rng, c.bayes.sens),
    fa1: pick(rng, c.bayes.falseAlarm),
    sens2: pick(rng, c.bayes.sens),
    fa2: pick(rng, c.bayes.falseAlarm),
    obs: pick(rng, c.bayes.observations),
  };
  const answer = bayesExact(input).toNumber();
  const tol = bayesTolerance(answer);
  if (answer < 0.02 || answer > 0.98) return 'sonuç uçta (anlamsız)';
  const l2 = input.obs === 'both' ? input.sens2 / 100 : 1 - input.sens2 / 100;
  const g2 = input.obs === 'both' ? input.fa2 / 100 : 1 - input.fa2 / 100;
  const s1 = input.sens1 / 100;
  const f1 = input.fa1 / 100;
  const pi = input.prior / 100;
  const mistakes = [
    { value: s1 * l2, text: `Taban oranı yok sayılmış: P(alarm | ${BAYES_TEXT[c.bayes.theme ?? 'leak'].ev}) ile P(${BAYES_TEXT[c.bayes.theme ?? 'leak'].ev} | alarm) karıştırılmış.` },
    { value: (pi * s1) / (pi * s1 + (1 - pi) * f1), text: 'Yalnız birinci sensör hesaba katılmış; ikinci sensörün gözlemi de olabilirliğe çarpılmalı.' },
    { value: (s1 * l2) / (s1 * l2 + f1 * g2), text: 'Önsel olasılık %50 sanılmış; gerçek önsel olasılık çok daha küçük.' },
  ];
  for (const m of mistakes) if (Math.abs(m.value - answer) < 3 * tol) return 'klasik hata doğru cevaba çok yakın';
  const mc = bayesMonteCarlo(input, 400_000, mcRng(seed));
  if (mc.events < 1500) return 'gözlem çok seyrek (Monte Carlo teyidi zayıf)';
  if (Math.abs(mc.estimate - answer) > 4 * Math.sqrt((answer * (1 - answer)) / mc.events) + 0.002) return 'Monte Carlo kesin sonuçla uyuşmuyor';
  return { seed, variant: 'bayes', theme: c.bayes.theme ?? 'leak', input, answer, tolerance: tol, mistakes };
}

const relGap = (p: number, r: number) => (1 - p) / (1 - r);

function genBinomial(c: ProbConfig, rng: () => number, seed: number): ProbProblem | string {
  const q = pick(rng, c.binomial.q);
  const need = pick(rng, c.binomial.need);
  const reliability = pick(rng, c.binomial.reliability);
  const R = Frac.pct(reliability);
  let answer = -1;
  for (let n = need; n <= need + 12; n++)
    if (atLeast(n, need, q).cmp(R) >= 0) {
      answer = n;
      break;
    }
  if (answer < need + 1 || answer > need + 6) return 'yedek sayısı aralık dışında';
  const table = Array.from({ length: 5 }, (_, k) => answer - 2 + k).filter((n) => n >= need).map((n) => ({ n, p: atLeast(n, need, q).toNumber() }));
  const r = reliability / 100;
  const pAns = table.find((t) => t.n === answer)!.p;
  const pPrev = table.find((t) => t.n === answer - 1)?.p ?? 0;
  // Şart sınırından açık fark: başarısızlık olasılıkları en az %15 ayrı
  if (relGap(pAns, r) > 0.85 || relGap(pPrev, r) < 1.15) return 'şart sınırına çok yakın';
  const mc = atLeastMonteCarlo(answer, need, q, 60_000, mcRng(seed));
  if (Math.abs(mc - pAns) > 4 * Math.sqrt((pAns * (1 - pAns)) / 60_000) + 1e-4) return 'Monte Carlo kesin sonuçla uyuşmuyor';
  const bin = table.map((t, k) => ({ id: `n${k}`, n: t.n, label: `${t.n} pompa`, sub: 'kurulacak' }));
  return { seed, variant: 'binomial', q, need, reliability, answer, bin, table };
}

function genPoisson(c: ProbConfig, rng: () => number, seed: number): ProbProblem | string {
  const lambda = pick(rng, c.poisson.lambda);
  const reliability = pick(rng, c.poisson.reliability);
  const r = reliability / 100;
  let answer = -1;
  for (let s = 0; s <= 20; s++) {
    const a = poissonCdfSeries(s, lambda);
    const b = poissonCdfGamma(s, lambda);
    if (Math.abs(a - b) > 1e-7) return 'seri toplamı gama integraliyle uyuşmuyor';
    if (a >= r) {
      answer = s;
      break;
    }
  }
  if (answer < 1) return 'yedek sayısı aralık dışında';
  const table = Array.from({ length: 5 }, (_, k) => answer - 2 + k).filter((s) => s >= 0).map((s) => ({ n: s, p: poissonCdfSeries(s, lambda) }));
  const pAns = table.find((t) => t.n === answer)!.p;
  const pPrev = table.find((t) => t.n === answer - 1)!.p;
  if (relGap(pAns, r) > 0.85 || relGap(pPrev, r) < 1.15) return 'şart sınırına çok yakın';
  const mc = poissonMonteCarlo(answer, lambda, 60_000, mcRng(seed));
  if (Math.abs(mc - pAns) > 4 * Math.sqrt((pAns * (1 - pAns)) / 60_000) + 1e-4) return 'Monte Carlo seriyle uyuşmuyor';
  const bin = table.map((t, k) => ({ id: `s${k}`, n: t.n, label: `${t.n} yedek`, sub: 'conta seti' }));
  return { seed, variant: 'poisson', lambda, reliability, answer, bin, table };
}

export function generateProb(c: ProbConfig, seed: number): ProbProblem {
  const rng = createRng(seed);
  const reasons = new Map<string, number>();
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    const v = pick(rng, c.variants);
    const p = v === 'bayes' ? genBayes(c, rng, seed) : v === 'binomial' ? genBinomial(c, rng, seed) : genPoisson(c, rng, seed);
    if (typeof p !== 'string') return p;
    reasons.set(p, (reasons.get(p) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} (${n})`);
  throw new Error(`Olasılık problemi üretilemedi: ${MAX_ATTEMPTS} denemede doğrulanabilir problem yok (tohum ${seed}). En sık red nedenleri: ${top.join('; ')}`);
}

// ---------------------------------------------------------------- sonuç

export type ProbOutcomeKind = Extract<OutcomeKind, 'success' | 'false_alarm' | 'leak_ignored' | 'redundancy_lost' | 'power_waste'>;

/** Cevap: Bayes'te olasılık (0..1), diğerlerinde seçilen kartın sayısı. */
export function classifyProb(p: ProbProblem, x: number): ProbOutcomeKind {
  if (p.variant === 'bayes') {
    if (Math.abs(x - p.answer) <= p.tolerance) return 'success';
    return x > p.answer ? 'false_alarm' : 'leak_ignored';
  }
  if (x === p.answer) return 'success';
  return x < p.answer ? 'redundancy_lost' : 'power_waste';
}

export function resolveProbOutcome(p: ProbProblem, x: number): Outcome {
  const kind = classifyProb(p, x);
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : kind === 'power_waste' ? 1 : 2 };
  if (p.variant === 'bayes') {
    const read = `Senin tahminin ${pctStr(x)}, gerçek olasılık ${pctStr(p.answer)}.`;
    const T = BAYES_TEXT[p.theme];
    if (kind === 'success') return { ...base, headline: 'Alarm doğru yorumlandı', explanation: `${read} ${T.okText}` };
    if (kind === 'false_alarm') return { ...base, headline: T.falseHead, explanation: `${read} ${T.falseText}` };
    return { ...base, headline: T.ignoredHead, explanation: `${read} ${T.ignoredText}` };
  }
  const unit = p.variant === 'binomial' ? 'pompa' : 'yedek';
  const pX = p.table.find((t) => t.n === x)?.p ?? NaN;
  const read = `${x} ${unit} ile güvenilirlik ${pctStr(pX, 3)}; şart ≥ %${num(p.reliability)}.`;
  if (kind === 'success') return { ...base, headline: 'Yeterli ve tutumlu', explanation: `${read} Şartı sağlayan en küçük sayı.` };
  if (kind === 'redundancy_lost') return { ...base, headline: p.variant === 'binomial' ? 'Pompalar yetmedi' : 'Yedekler tükendi', explanation: `${read} Şart sağlanmıyor: görevde ${p.variant === 'binomial' ? 'yeterli pompa çalışmadı' : 'conta bitti, kilit sızdırdı'}.` };
  return { ...base, headline: 'Gereğinden fazla', explanation: `${read} Şart daha az ${unit} ile de sağlanıyordu; fazlası enerji ve yer harcadı.` };
}

export function buildProbReport(stageId: string, p: ProbProblem, x: number, outcome: Outcome): StageResult {
  if (p.variant === 'bayes') {
    const b = p.input;
    const second = b.obs === 'both' ? `P(A₂|K) = %${num(b.sens2)}, P(A₂|¬K) = %${num(b.fa2)}` : `P(¬A₂|K) = 1 − %${num(b.sens2)}, P(¬A₂|¬K) = 1 − %${num(b.fa2)}`;
    const steps = [
      `K: ${p.theme === 'leak' ? 'bölmede kaçak var' : 'temas büyük bir canlı'}; A₁, A₂: ${BAYES_TEXT[p.theme].s1} ve ${BAYES_TEXT[p.theme].s2} alarmı.`,
      `Bayes: P(K | gözlem) = P(gözlem | K)·P(K) / [P(gözlem | K)·P(K) + P(gözlem | ¬K)·P(¬K)]; sensörler koşullu bağımsız: olabilirlikler çarpılır.`,
      `P(K) = %${num(b.prior)}; P(A₁|K) = %${num(b.sens1)}, P(A₁|¬K) = %${num(b.fa1)}; ${second}`,
      `Sonuç: P(K | gözlem) = ${pctStr(p.answer)} (kesin kesirli hesap; Monte Carlo benzetimiyle de teyit edildi)`,
    ];
    for (const m of p.mistakes) if (Math.abs(x - m.value) <= p.tolerance) steps.push(`Olası hata: ${m.text}`);
    return {
      stageId,
      success: outcome.kind === 'success',
      chosenLabel: pctStr(x),
      correctLabel: pctStr(p.answer),
      outcome,
      facts: [
        { label: 'Önsel', value: `%${num(b.prior)}` },
        { label: 'Gözlem', value: b.obs === 'both' ? `${BAYES_TEXT[p.theme].s1} ve ${BAYES_TEXT[p.theme].s2} alarm` : `${BAYES_TEXT[p.theme].s1} alarm, ${BAYES_TEXT[p.theme].s2} sessiz` },
        { label: 'Kabul', value: `±${(p.tolerance * 100).toFixed(1).replace('.', ',')} puan` },
      ],
      steps,
    };
  }
  const isBin = p.variant === 'binomial';
  const steps = isBin
    ? [
        `Her pompa bağımsız olarak q = %${num(p.q)} olasılıkla çalışır; X ~ Binom(n, q). En az ${p.need} pompa gerekir: P(X ≥ ${p.need}) = Σₖ C(n,k)·qᵏ·(1−q)ⁿ⁻ᵏ, k = ${p.need}…n`,
        `Şart P(X ≥ ${p.need}) ≥ %${num(p.reliability)}; n'yi ${p.need}'den başlayarak artır (tablo, kesin kesirli hesap)`,
        `İlk sağlayan: n = ${p.answer}. Kontrol: Monte Carlo benzetimi aynı olasılığı verdi.`,
      ]
    : [
        `Görevde arıza sayısı N ~ Poisson(λ = ${num(p.lambda)}): P(N = k) = e^(−λ)·λᵏ/k!`,
        `Şart P(N ≤ s) ≥ %${num(p.reliability)}; s'yi 0'dan artır (tablo; seri toplamı ve tamamlanmamış gama integrali aynı)`,
        `İlk sağlayan: s = ${p.answer}. Kontrol: Monte Carlo benzetimi aynı olasılığı verdi.`,
      ];
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: `${x}`,
    correctLabel: `${p.answer}`,
    outcome,
    facts: isBin
      ? [
          { label: 'Pompa çalışma olasılığı', value: `%${num(p.q)}` },
          { label: 'Gereken', value: `en az ${p.need} pompa` },
          { label: 'Şart', value: `≥ %${num(p.reliability)}` },
        ]
      : [
          { label: 'Beklenen arıza (λ)', value: num(p.lambda) },
          { label: 'Şart', value: `≥ %${num(p.reliability)}` },
        ],
    steps,
    table: {
      caption: isBin ? `P(X ≥ ${p.need})` : 'P(N ≤ s)',
      head: [isBin ? 'n' : 's', 'olasılık', 'şart'],
      rows: p.table.map((t) => [String(t.n), pctStr(t.p, 3), t.p >= p.reliability / 100 ? 'sağlar' : 'sağlamaz']),
      good: p.table.findIndex((t) => t.n === p.answer),
      chosen: p.table.findIndex((t) => t.n === x),
    },
  };
}
