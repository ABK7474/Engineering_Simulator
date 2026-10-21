// Sensör/sonar odası panelleri. Çizimler programla üretilir; etkileşim slot-board ve sayı panelinde.

import { formatFarad, formatHenry, formatHz, formatOhm } from '../../core/format';
import type { FilterProblem } from '../../solvers/circuit/filter.generate';
import { fmtDb } from '../../solvers/circuit/filter.outcomes';
import type { PhasorProblem } from '../../solvers/math/phasor.generate';
import { BAYES_TEXT, type ProbProblem } from '../../solvers/prob/probability.generate';
import { esc } from '../dom';
import { resistorSvg } from '../resistor';
import { openSlotBoard } from '../slot-board/panel';

interface Common {
  title: string;
  briefing: string;
  onCancel: () => void;
  source?: { label: string; onFlag: () => void };
  onSound?: (s: 'click' | 'switch') => void;
}

/** RC (seri R yuvası, paralel C) ya da RL (seri L, paralel R yuvası) alçak geçiren. */
export function filterSvg(p: FilterProblem, filled: number | undefined, armed: boolean): string {
  const rc = p.parts.kind === 'rc';
  const part = rc ? formatFarad(p.parts.part) : formatHenry(p.parts.part);
  const slotAt = rc ? { x: 170, y: 60, h: true } : { x: 300, y: 140, h: false };
  const body =
    filled === undefined
      ? slotAt.h
        ? `<line x1="130" y1="60" x2="144" y2="60" class="wire"/><line x1="196" y1="60" x2="210" y2="60" class="wire"/><rect x="144" y="51" width="52" height="18" class="slot-empty" rx="3"/>`
        : `<line x1="300" y1="100" x2="300" y2="114" class="wire"/><line x1="300" y1="166" x2="300" y2="180" class="wire"/><rect x="291" y="114" width="18" height="52" class="slot-empty" rx="3"/>`
      : slotAt.h
        ? `<g transform="translate(130,49)">${resistorSvg(filled, 80, 22, true)}</g>`
        : `<g transform="translate(311,100) rotate(90)">${resistorSvg(filled, 80, 22, true)}</g>`;
  const label = `R = ${filled === undefined ? '?' : formatOhm(filled)}`;
  const slot = `<g class="bslot${armed ? ' armed' : ''}${filled === undefined ? '' : ' filled'}" data-slot="R" role="button" tabindex="-1" aria-label="Direnç yuvası">
      <rect ${slotAt.h ? 'x="130" y="42" width="80" height="36"' : 'x="282" y="100" width="36" height="80"'} class="slot-hit"/>${body}
      <text x="${slotAt.h ? 170 : 322}" y="${slotAt.h ? 34 : 144}" class="lbl slot-lbl" text-anchor="${slotAt.h ? 'middle' : 'start'}">${esc(label)}</text></g>`;
  const series = rc
    ? slot
    : `<path d="M130 60 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0" class="sym"/><text x="170" y="34" class="lbl" text-anchor="middle">L = ${esc(part)}</text>`;
  const shunt = rc
    ? `<polyline points="300,60 300,128" class="wire"/><line x1="280" y1="128" x2="320" y2="128" class="sym"/><line x1="280" y1="142" x2="320" y2="142" class="sym"/><polyline points="300,142 300,200" class="wire"/><text x="330" y="140" class="lbl">C = ${esc(part)}</text>`
    : `<polyline points="300,60 300,100" class="wire"/>${slot}<polyline points="300,180 300,200" class="wire"/>`;
  return `<svg viewBox="0 0 480 240" class="circuit board" aria-label="Alçak geçiren filtre">
    <circle cx="60" cy="130" r="18" class="sym"/><path d="M48 130 q6 -10 12 0 t12 0" class="sym-arrow"/>
    <text x="20" y="175" class="lbl">dönüştürücü</text>
    <polyline points="60,112 60,60 130,60" class="wire"/><polyline points="210,60 300,60 420,60" class="wire"/>
    <polyline points="60,148 60,200 420,200" class="wire"/>
    ${series}${shunt}
    <circle cx="300" cy="60" r="3.5" class="dot"/><circle cx="300" cy="200" r="3.5" class="dot"/>
    <g class="probe"><circle cx="420" cy="60" r="7"/><text x="400" y="44">ADC</text></g>
    <g class="ground"><line x1="200" y1="200" x2="200" y2="210"/><line x1="188" y1="210" x2="212" y2="210"/><line x1="193" y1="215" x2="207" y2="215"/><line x1="197" y1="220" x2="203" y2="220"/></g>
  </svg>`;
}

export function openFilterPanel(root: HTMLElement, opts: Common & { problem: FilterProblem; onSubmit: (cardId: string) => void }): () => void {
  const p = opts.problem;
  return openSlotBoard(root, {
    title: opts.title,
    briefing: opts.briefing,
    info: [
      { heading: 'Sonar ön katı', text: `Yankı sinyali ${formatHz(p.fs)}: en fazla ${fmtDb(p.gsDb)} zayıflayabilir. Pompa gürültüsü ${formatHz(p.fn)}: en az ${fmtDb(p.gnDb)} bastırılmalı.` },
      { heading: 'Görev', text: `${p.parts.kind === 'rc' ? 'Seri' : 'Paralel'} direnci seç; iki şart birlikte sağlanmalı.` },
    ],
    slots: ['R'],
    bin: p.bin,
    drawing: (filled, armed) => filterSvg(p, filled.R, armed),
    submitLabel: 'Tak ve dinle',
    onSubmit: (pl) => opts.onSubmit(pl.R),
    onCancel: opts.onCancel,
    source: opts.source,
    onSound: opts.onSound,
  });
}

const n3 = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',').replace(/^-/, '−');

/** İki hidrofonun ham sinyali (bir buçuk periyot); toplam çizilmez, o cevap. */
export function phasorWavesSvg(p: PhasorProblem): string {
  const W = 440;
  const H = 200;
  const amax = Math.max(p.w1.a, p.w2.a);
  const path = (a: number, phi: number) => {
    const pts: string[] = [];
    for (let k = 0; k <= 180; k++) {
      const t = (k / 180) * 3 * Math.PI;
      pts.push(`${(40 + (k / 180) * (W - 60)).toFixed(1)},${(H / 2 - ((a / amax) * 72 * Math.cos(t + (phi * Math.PI) / 180))).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  return `<svg viewBox="0 0 ${W} ${H + 30}" class="circuit board" aria-label="Hidrofon sinyalleri">
    <line x1="40" y1="${H / 2}" x2="${W - 20}" y2="${H / 2}" class="wire" stroke-dasharray="3 4"/>
    <line x1="40" y1="20" x2="40" y2="${H - 20}" class="wire"/>
    <polyline points="${path(p.w1.a, p.w1.phi)}" style="fill:none;stroke:var(--accent);stroke-width:2.5"/>
    <polyline points="${path(p.w2.a, p.w2.phi)}" style="fill:none;stroke:var(--warn);stroke-width:2.5;stroke-dasharray:7 4"/>
    <text x="48" y="${H + 12}" class="lbl" style="fill:var(--accent)">H1: ${esc(n3(p.w1.a))} mV ∠ ${esc(n3(p.w1.phi))}°</text>
    <text x="248" y="${H + 12}" class="lbl" style="fill:var(--warn)">H2: ${esc(n3(p.w2.a))} mV ∠ ${esc(n3(p.w2.phi))}°</text>
    <text x="${W - 30}" y="${H / 2 - 6}" class="lbl dim" text-anchor="end">ωt</text>
  </svg>`;
}

/** İki algılayıcı (kaçak sensörleri ya da sonar + hidrofon) ve gözlenen alarm durumları. */
export function bayesSvg(p: Extract<ProbProblem, { variant: 'bayes' }>): string {
  const b = p.input;
  const T = BAYES_TEXT[p.theme];
  const lamp = (x: number, on: boolean, name: string, sens: number, fa: number) => `
    <rect x="${x}" y="24" width="160" height="140" rx="8" class="sym"/>
    <circle cx="${x + 80}" cy="62" r="20" style="fill:${on ? '#ff5040' : '#1d3238'};stroke:#e6f4f5;stroke-width:2"/>
    <text x="${x + 80}" y="106" class="lbl" text-anchor="middle">${esc(name)}: ${on ? 'ALARM' : 'sessiz'}</text>
    <text x="${x + 80}" y="128" class="lbl dim" text-anchor="middle">tespit %${esc(n3(sens))}</text>
    <text x="${x + 80}" y="148" class="lbl dim" text-anchor="middle">yanlış alarm %${esc(n3(fa))}</text>`;
  return `<svg viewBox="0 0 400 200" class="circuit board" aria-label="Algılayıcılar">
    ${lamp(25, true, T.s1, b.sens1, b.fa1)}${lamp(215, b.obs === 'both', T.s2, b.sens2, b.fa2)}
    <text x="200" y="186" class="lbl" text-anchor="middle">${esc(T.svg)} %${esc(n3(b.prior))}</text>
  </svg>`;
}

/** Yedeklilik: seçilen sayı kadar pompa ya da conta seti. */
export function redundancySvg(p: Extract<ProbProblem, { variant: 'binomial' | 'poisson' }>, chosen: number | undefined, armed: boolean): string {
  const isBin = p.variant === 'binomial';
  const count = chosen ?? 0;
  const items = Array.from({ length: Math.min(count, 12) }, (_, k) => {
    const x = 40 + (k % 6) * 60;
    const y = 50 + Math.floor(k / 6) * 64;
    return isBin
      ? `<circle cx="${x + 20}" cy="${y + 20}" r="20" class="sym"/><text x="${x + 20}" y="${y + 26}" class="motor-m" text-anchor="middle">P</text>`
      : `<rect x="${x}" y="${y}" width="40" height="40" rx="5" class="sym"/><circle cx="${x + 20}" cy="${y + 20}" r="10" class="sym"/>`;
  }).join('');
  const label = chosen === undefined ? `${isBin ? 'pompa sayısı' : 'yedek sayısı'}: ?` : `${chosen} ${isBin ? 'pompa' : 'yedek conta seti'}`;
  return `<svg viewBox="0 0 400 200" class="circuit board" aria-label="${isBin ? 'Sintine pompaları' : 'Conta yedekleri'}">
    <g class="bslot${armed ? ' armed' : ''}${chosen === undefined ? '' : ' filled'}" data-slot="N" role="button" tabindex="-1" aria-label="Sayı yuvası">
      <rect x="20" y="36" width="360" height="140" class="slot-hit"/>
      ${chosen === undefined ? '<rect x="30" y="44" width="340" height="124" rx="6" class="slot-empty"/>' : items}
      <text x="200" y="26" class="lbl slot-lbl" text-anchor="middle">${esc(label)}</text>
    </g>
    <text x="200" y="194" class="lbl dim" text-anchor="middle">${isBin ? `her pompa %${esc(n3(p.q))} olasılıkla çalışır · en az ${p.need} gerekir` : `görevde beklenen conta arızası λ = ${esc(n3(p.lambda))}`}</text>
  </svg>`;
}

export function openRedundancyPanel(
  root: HTMLElement,
  opts: Common & { problem: Extract<ProbProblem, { variant: 'binomial' | 'poisson' }>; onSubmit: (cardId: string) => void },
): () => void {
  const p = opts.problem;
  const isBin = p.variant === 'binomial';
  const pct = (x: number) => String(x).replace('.', ',');
  return openSlotBoard(root, {
    title: opts.title,
    briefing: opts.briefing,
    info: isBin
      ? [
          { heading: 'Sintine pompaları', text: `Su baskınında her pompa diğerlerinden bağımsız olarak %${pct(p.q)} olasılıkla çalışır. Bölmeyi boşaltmak için en az ${p.need} pompanın çalışması gerekir.` },
          { heading: 'Şart', text: `Bölmenin boşaltılabilme olasılığı en az %${pct(p.reliability)} olmalı. Her fazla pompa güç ve yer harcar: şartı sağlayan en küçük sayıyı kur.` },
        ]
      : [
          { heading: 'Hava kilidi contaları', text: `Kayıtlara göre bir görev boyunca conta arızaları Poisson dağılır; ortalama λ = ${pct(p.lambda)} arıza. Her arıza bir yedek set harcar.` },
          { heading: 'Şart', text: `Yedeklerin görev sonuna kadar yetme olasılığı en az %${pct(p.reliability)} olmalı. Fazla yedek yük ve yer harcar: şartı sağlayan en küçük sayıyı al.` },
        ],
    slots: ['N'],
    bin: p.bin,
    binTitle: isBin ? 'Kurulacak pompa sayısı' : 'Alınacak yedek sayısı',
    binHow: 'Bir sayı seç; tabloya işlenir. Yeniden tıklamak geri alır.',
    drawing: (_f, armed, chosen) => redundancySvg(p, chosen.N ? p.bin.find((b) => b.id === chosen.N)!.n : undefined, armed),
    submitLabel: isBin ? 'Pompaları kur' : 'Yedekleri yükle',
    onSubmit: (pl) => opts.onSubmit(pl.N),
    onCancel: opts.onCancel,
    source: opts.source,
    onSound: opts.onSound,
  });
}
