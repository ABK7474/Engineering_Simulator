// Sensör/sonar odası panelleri. Çizimler programla üretilir; etkileşim slot-board ve sayı panelinde.

import { formatFarad, formatHenry, formatHz, formatOhm } from '../../core/format';
import type { FilterProblem } from '../../solvers/circuit/filter.generate';
import { fmtDb } from '../../solvers/circuit/filter.outcomes';
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
