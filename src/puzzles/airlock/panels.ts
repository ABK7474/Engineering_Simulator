// Hava kilidi panelleri: basınç sensörü şartlandırma (op-amp, 2–3 yuva) ve valf zamanlayıcı (RC/RL, tek yuva).
// Çizimler programla üretilir (sabit topoloji); yuvalar `data-slot` taşır, etkileşim slot-board'da.

import { formatAmp, formatOhm, formatSec, formatVolt } from '../../core/format';
import { SLOTS, type OpampVariant } from '../../solvers/circuit/opamp';
import type { OpampProblem } from '../../solvers/circuit/opamp.generate';
import type { LaplaceProblem } from '../../solvers/math/laplace.generate';
import type { StabilityProblem } from '../../solvers/math/stability.generate';
import type { DampingProblem } from '../../solvers/ode/damping.generate';
import type { RcRlProblem } from '../../solvers/ode/rc-rl.generate';
import { fmtTime } from '../../solvers/ode/rc-rl.outcomes';
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

const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');

/** Yuva: boşsa kesik çerçeve, doluysa direnç. h: yatay (merkez x±40), v: dikey (y±40). */
function slotSvg(id: string, label: string, x: number, y: number, dir: 'h' | 'v', r: number | undefined, armed: boolean, labelLeft = false): string {
  const h = dir === 'h';
  const hit = h ? `x="${x - 40}" y="${y - 18}" width="80" height="36"` : `x="${x - 18}" y="${y - 40}" width="36" height="80"`;
  const lead = h
    ? `<line x1="${x - 40}" y1="${y}" x2="${x - 26}" y2="${y}" class="wire"/><line x1="${x + 26}" y1="${y}" x2="${x + 40}" y2="${y}" class="wire"/>`
    : `<line x1="${x}" y1="${y - 40}" x2="${x}" y2="${y - 26}" class="wire"/><line x1="${x}" y1="${y + 26}" x2="${x}" y2="${y + 40}" class="wire"/>`;
  const body =
    r === undefined
      ? `${lead}<rect ${h ? `x="${x - 26}" y="${y - 9}" width="52" height="18"` : `x="${x - 9}" y="${y - 26}" width="18" height="52"`} class="slot-empty" rx="3"/>`
      : `<g transform="${h ? `translate(${x - 40},${y - 11})` : `translate(${x + 11},${y - 40}) rotate(90)`}">${resistorSvg(r, 80, 22, true)}</g>`;
  const [lx, ly, anchor] = h ? [x, y - 24, 'middle'] : labelLeft ? [x - 22, y + 4, 'end'] : [x + 22, y + 4, 'start'];
  return (
    `<g class="bslot${armed ? ' armed' : ''}${r === undefined ? '' : ' filled'}" data-slot="${id}" role="button" tabindex="-1" aria-label="${esc(label)} yuvası">` +
    `<rect ${hit} class="slot-hit"/>${body}<text x="${lx}" y="${ly}" class="lbl slot-lbl" text-anchor="${anchor}">${esc(label)} = ${r === undefined ? '?' : esc(formatOhm(r))}</text></g>`
  );
}

function source(x: number, y: number, label: string, lx = x + 26, ly = y + 4): string {
  return `<circle cx="${x}" cy="${y}" r="18" class="sym"/><text x="${x}" y="${y - 5}" class="sign" text-anchor="middle">+</text><text x="${x}" y="${y + 12}" class="sign" text-anchor="middle">−</text><text x="${lx}" y="${ly}" class="lbl">${esc(label)}</text>`;
}

export function opampSvg(variant: OpampVariant, p: Pick<OpampProblem, 'vref'>, filled: Partial<Record<string, number>>, armed: boolean): string {
  const parts = [
    // toprak rayı
    `<polyline points="${variant === 'offset' ? 40 : 200},270 260,270" class="wire"/>`,
    `<g class="ground"><line x1="230" y1="270" x2="230" y2="280"/><line x1="218" y1="280" x2="242" y2="280"/><line x1="223" y1="285" x2="237" y2="285"/><line x1="227" y1="290" x2="233" y2="290"/></g>`,
    // op-amp
    `<path d="M300 90 L300 210 L390 150 Z" class="sym"/><text x="310" y="125" class="sign">−</text><text x="310" y="185" class="sign">+</text>`,
    // sensör → (+)
    source(260, 230, 'sensör V_s', 286),
    `<polyline points="260,212 260,180 300,180" class="wire"/><polyline points="260,248 260,270" class="wire"/>`,
    // (−) düğümü n, geri besleme ve çıkış
    `<polyline points="200,120 300,120" class="wire"/><circle cx="200" cy="120" r="3.5" class="dot"/>`,
    `<polyline points="200,120 200,50 290,50" class="wire"/><polyline points="370,50 430,50 430,150" class="wire"/>`,
    `<polyline points="390,150 480,150" class="wire"/><circle cx="430" cy="150" r="3.5" class="dot"/>`,
    `<rect x="480" y="125" width="80" height="50" rx="5" class="sym"/><text x="520" y="155" class="lbl" text-anchor="middle">ADC</text>`,
    slotSvg('Rf', 'Rf', 330, 50, 'h', filled.Rf, armed),
    `<polyline points="200,120 200,160" class="wire"/><polyline points="200,240 200,270" class="wire"/>`,
    slotSvg('Rg', 'Rg', 200, 200, 'v', filled.Rg, armed, true),
  ];
  if (variant === 'offset') {
    parts.push(
      `<polyline points="160,120 200,120" class="wire"/>`,
      slotSvg('Rr', 'Rr', 120, 120, 'h', filled.Rr, armed),
      `<polyline points="80,120 40,120 40,177" class="wire"/><polyline points="40,213 40,270" class="wire"/>`,
      source(40, 195, `V_ref = ${formatVolt(p.vref)}`, 50, 252),
    );
  }
  return `<svg viewBox="0 0 580 300" class="circuit board" aria-label="Op-amp sinyal şartlandırma">${parts.join('')}</svg>`;
}

export function openOpampPanel(root: HTMLElement, opts: Common & { problem: OpampProblem; onSubmit: (pl: Record<string, string>) => void }): () => void {
  const p = opts.problem;
  return openSlotBoard(root, {
    title: opts.title,
    briefing: opts.briefing,
    info: [
      { heading: 'Sensör kaydı', text: `Basınç sensörü en düşük basınçta ${formatVolt(p.vlo)}, en yüksekte ${formatVolt(p.vhi)} veriyor.` },
      {
        heading: 'Hedef',
        text: `ADC girişinde bu iki uç ${formatVolt(p.ylo)} ve ${formatVolt(p.yhi)} olmalı (her biri ± aralığın %${Math.round(p.tolerance * 100)}'ü). Op-amp tek beslemeli: çıkış 0 … ${formatVolt(p.vcc)}.${p.variant === 'offset' ? ` Referans V_ref = ${formatVolt(p.vref)}.` : ''}`,
      },
    ],
    slots: SLOTS[p.variant],
    bin: p.bin,
    drawing: (filled, armed) => opampSvg(p.variant, p, filled, armed),
    submitLabel: 'Tak ve kalibre et',
    onSubmit: (pl) => opts.onSubmit(pl),
    onCancel: opts.onCancel,
    source: opts.source,
    onSound: opts.onSound,
  });
}

export function rcRlSvg(p: RcRlProblem, filled: number | undefined, armed: boolean): string {
  const q = p.params;
  const store =
    q.kind === 'rc'
      ? `<polyline points="300,50 300,128" class="wire"/><line x1="280" y1="128" x2="320" y2="128" class="sym"/><line x1="280" y1="142" x2="320" y2="142" class="sym"/><polyline points="300,142 300,220" class="wire"/><text x="330" y="132" class="lbl">C = ${num(q.c * 1e6)} µF</text><text x="330" y="150" class="lbl dim">V₀ = ${esc(formatVolt(q.v0))}</text>`
      : `<polyline points="300,50 300,95" class="wire"/><path d="M300 95 a10 10 0 0 1 0 20 a10 10 0 0 1 0 20 a10 10 0 0 1 0 20 a10 10 0 0 1 0 20" class="sym"/><polyline points="300,175 300,220" class="wire"/><text x="330" y="132" class="lbl">L = ${num(q.l * 1000)} mH</text><text x="330" y="150" class="lbl dim">I₀ = ${esc(formatAmp(q.i0))}</text>`;
  const sense = q.kind === 'rc' ? `eşik ${formatVolt(q.vth)}` : `çekme ${formatAmp(q.ith)}`;
  return `<svg viewBox="0 0 580 260" class="circuit board" aria-label="Valf zamanlayıcı">
    ${source(60, 140, `Vs = ${formatVolt(q.vs)}`)}
    <polyline points="60,122 60,50 120,50" class="wire"/><polyline points="200,50 300,50" class="wire"/>
    <polyline points="60,158 60,220 300,220" class="wire"/>
    <g class="ground"><line x1="180" y1="220" x2="180" y2="230"/><line x1="168" y1="230" x2="192" y2="230"/><line x1="173" y1="235" x2="187" y2="235"/><line x1="177" y1="240" x2="183" y2="240"/></g>
    ${slotSvg('R', 'R', 160, 50, 'h', filled, armed)}
    ${store}
    <circle cx="300" cy="50" r="3.5" class="dot"/><polyline points="300,50 450,50 450,90" class="wire"/>
    <path d="M430 90 L470 90 L450 125 Z" class="sym"/><text x="480" y="112" class="lbl">${esc(sense)}</text>
    <polyline points="450,125 450,160" class="wire"/><rect x="415" y="160" width="70" height="36" rx="5" class="sym"/><text x="450" y="183" class="lbl" text-anchor="middle">valf</text>
  </svg>`;
}

export function openRcRlPanel(root: HTMLElement, opts: Common & { problem: RcRlProblem; onSubmit: (cardId: string) => void }): () => void {
  const p = opts.problem;
  const q = p.params;
  return openSlotBoard(root, {
    title: opts.title,
    briefing: opts.briefing,
    info: [
      {
        heading: 'Sürücü kaydı',
        text:
          q.kind === 'rc'
            ? `Kondansatör önceki darbeden ${formatVolt(q.v0)} ile dolu kaldı. Gerilimi ${formatVolt(q.vth)} eşiğini geçtiği an valf ateşlenir.`
            : `Bobinde önceki darbeden ${formatAmp(q.i0)} akım var. Akım ${formatAmp(q.ith)} çekme değerini geçtiği an valf ateşlenir.`,
      },
      { heading: 'Pencere', text: `Anahtar kapandıktan sonra ateşleme ${fmtTime(p.tmin)} ile ${fmtTime(p.tmax)} arasında olmalı.` },
    ],
    slots: ['R'],
    bin: p.bin,
    drawing: (filled, armed) => rcRlSvg(p, filled.R, armed),
    submitLabel: 'Tak ve tetikle',
    onSubmit: (pl) => opts.onSubmit(pl.R),
    onCancel: opts.onCancel,
    source: opts.source,
    onSound: opts.onSound,
  });
}

/** Kapı: kütle, yay, amortisör yuvası; seçilen amortisörün değeri yazılır. */
export function damperSvg(label: string | undefined, armed: boolean): string {
  return `<svg viewBox="0 0 520 220" class="circuit board" aria-label="Kapı, yay ve amortisör">
    <rect x="20" y="30" width="16" height="160" class="sym"/><text x="10" y="210" class="lbl">gövde</text>
    <polyline points="36,70 70,70 80,55 95,85 110,55 125,85 140,55 155,85 165,70 220,70" class="sym-arrow"/>
    <text x="110" y="40" class="lbl" text-anchor="middle">yay k (T₀'dan)</text>
    <g class="bslot${armed ? ' armed' : ''}${label ? ' filled' : ''}" data-slot="C" role="button" tabindex="-1" aria-label="Amortisör yuvası">
      <rect x="36" y="120" width="184" height="60" class="slot-hit"/>
      <polyline points="36,150 90,150" class="wire"/><rect x="90" y="132" width="70" height="36" class="${label ? 'sym' : 'slot-empty'}" rx="3"/>
      <polyline points="120,150 220,150" class="wire"/><line x1="120" y1="138" x2="120" y2="162" class="sym"/>
      <text x="128" y="200" class="lbl slot-lbl" text-anchor="middle">${esc(label ? `c = ${label}` : 'c = ?')}</text>
    </g>
    <rect x="220" y="40" width="130" height="140" rx="6" class="sym"/><text x="285" y="115" class="lbl" text-anchor="middle">dış kapı (m)</text>
    <path d="M360 110 h80" class="sym-arrow"/><path d="M430 102 l10 8 l-10 8" class="sym-arrow"/><text x="400" y="96" class="lbl" text-anchor="middle">x</text>
  </svg>`;
}

export function openDampingPanel(root: HTMLElement, opts: Common & { problem: DampingProblem; onSubmit: (cardId: string) => void }): () => void {
  const p = opts.problem;
  const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');
  return openSlotBoard(root, {
    title: opts.title,
    briefing: opts.briefing,
    info: [
      { heading: 'Ölçüm kaydı', text: `Amortisör sökülüyken kapı (${num(p.m)} kg) serbest bırakılınca ${formatSec(p.t0)} periyotla salınmış.` },
      { heading: 'Görev', text: `Kapı salınmadan ve gecikmeden kapanmalı: sönüm oranı ζ = ${num(p.zeta[0])}–${num(p.zeta[1])}. Katalogdan amortisörü seç.` },
    ],
    slots: ['C'],
    bin: p.bin,
    drawing: (_filled, armed, chosen) => damperSvg(chosen.C ? p.bin.find((b) => b.id === chosen.C)!.label : undefined, armed),
    submitLabel: 'Tak ve kapıyı kapat',
    onSubmit: (pl) => opts.onSubmit(pl.C),
    onCancel: opts.onCancel,
    source: opts.source,
    onSound: opts.onSound,
  });
}

/** Basınç denetleyicisinin A matrisi; k yuvası. */
export function matrixSvg(p: StabilityProblem, label: string | undefined, armed: boolean): string {
  const n = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');
  return `<svg viewBox="0 0 520 220" class="circuit board" aria-label="Sistem matrisi">
    <text x="30" y="118" class="lbl" style="font-size:22px">ẋ = </text>
    <path d="M110 40 h-12 v140 h12" class="sym-arrow"/><path d="M380 40 h12 v140 h-12" class="sym-arrow"/>
    <text x="170" y="90" class="lbl" text-anchor="middle" style="font-size:22px">${esc(n(p.plant.a))}</text>
    <text x="310" y="90" class="lbl" text-anchor="middle" style="font-size:22px">${esc(n(p.plant.b))}</text>
    <g class="bslot${armed ? ' armed' : ''}${label ? ' filled' : ''}" data-slot="K" role="button" tabindex="-1" aria-label="Kazanç yuvası">
      <rect x="120" y="125" width="100" height="44" class="slot-hit"/>
      <rect x="128" y="130" width="84" height="34" rx="4" class="${label ? 'sym' : 'slot-empty'}"/>
      <text x="170" y="154" class="lbl slot-lbl" text-anchor="middle" style="font-size:18px">${esc(label ? `−${label.replace('k = ', '')}` : '−k')}</text>
    </g>
    <text x="310" y="155" class="lbl" text-anchor="middle" style="font-size:22px">−${esc(n(p.plant.c))}</text>
    <text x="410" y="118" class="lbl" style="font-size:22px">· x</text>
    <text x="40" y="205" class="lbl dim">x₁: basınç sapması, x₂: valf konumu</text>
  </svg>`;
}

export function openStabilityPanel(root: HTMLElement, opts: Common & { problem: StabilityProblem; onSubmit: (cardId: string) => void }): () => void {
  const p = opts.problem;
  const n = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');
  return openSlotBoard(root, {
    title: opts.title,
    briefing: opts.briefing,
    info: [
      { heading: 'Denetleyici modeli', text: `Basınç sapması kendiliğinden a = ${n(p.plant.a)} 1/s hızla büyür; valf b = ${n(p.plant.b)} ile basıncı düzeltir, c = ${n(p.plant.c)} 1/s ile söner. Geri besleme kazancı k seçilecek.` },
      { heading: 'Şartlar', text: `Her mod en az σ = ${n(p.sigmaMin)} 1/s hızla sönmeli (Re λ ≤ −σ) ve sönüm oranı ζ ≥ ${n(p.zetaMin)} olmalı.` },
    ],
    slots: ['K'],
    bin: p.bin,
    binTitle: 'Kazanç seçenekleri',
    binHow: 'Bir kazanç kartı seç; denetleyiciye yüklenir. Yeniden tıklamak geri alır.',
    drawing: (_f, armed, chosen) => matrixSvg(p, chosen.K ? p.bin.find((b) => b.id === chosen.K)!.label : undefined, armed),
    submitLabel: 'Kazancı yükle',
    onSubmit: (pl) => opts.onSubmit(pl.K),
    onCancel: opts.onCancel,
    source: opts.source,
    onSound: opts.onSound,
  });
}

/** Dolum pompası blok şeması: basamak komutu → G(s) → kilit basıncı. */
export function laplaceSvg(p: LaplaceProblem): string {
  const { K, z, p1, p2 } = p.g;
  return `<svg viewBox="0 0 460 200" class="circuit board" aria-label="Dolum pompası blok şeması">
    <polyline points="30,140 60,140 60,70 100,70" class="sym"/>
    <text x="40" y="170" class="lbl">U = ${esc(num(p.u))}</text>
    <line x1="100" y1="100" x2="150" y2="100" class="wire"/>
    <polygon points="150,100 140,95 140,105" style="fill:#9cc6cc"/>
    <rect x="150" y="60" width="180" height="80" rx="6" class="sym"/>
    <text x="240" y="92" class="lbl" text-anchor="middle">${esc(num(K))}(s + ${esc(num(z))})</text>
    <line x1="170" y1="100" x2="310" y2="100" class="wire"/>
    <text x="240" y="122" class="lbl" text-anchor="middle">(s + ${esc(num(p1))})(s + ${esc(num(p2))})</text>
    <line x1="330" y1="100" x2="410" y2="100" class="wire"/>
    <polygon points="410,100 400,95 400,105" style="fill:#9cc6cc"/>
    <text x="420" y="104" class="lbl">y</text>
    <text x="240" y="48" class="lbl dim" text-anchor="middle">dolum pompası + kilit hacmi, G(s)</text>
    <text x="370" y="170" class="lbl dim" text-anchor="middle">y: kilit basıncı (bar)</text>
  </svg>`;
}
