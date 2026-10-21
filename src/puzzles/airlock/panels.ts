// Hava kilidi panelleri: basınç sensörü şartlandırma (op-amp, 2–3 yuva) ve valf zamanlayıcı (RC/RL, tek yuva).
// Çizimler programla üretilir (sabit topoloji); yuvalar `data-slot` taşır, etkileşim slot-board'da.

import { formatAmp, formatOhm, formatVolt } from '../../core/format';
import { SLOTS, type OpampVariant } from '../../solvers/circuit/opamp';
import type { OpampProblem } from '../../solvers/circuit/opamp.generate';
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
