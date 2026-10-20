// Güç barası panelleri: Thevenin/Norton eşdeğer modülü (birimli sayı girişi) ve sonar vericisi
// (kara kutu + tek yuva). Three.js'i bilmez; yalnızca cevabı geri bildirir.

import { formatOhm } from '../../core/format';
import type { MaxPowerProblem } from '../../solvers/circuit/max-power.generate';
import type { TheveninProblem } from '../../solvers/circuit/thevenin.generate';
import type { TheveninAnswer } from '../../solvers/circuit/thevenin.outcomes';
import { schematicSvg } from '../circuit-board/schematic';
import { esc } from '../dom';
import { quantityField } from '../numeric-entry/field';
import { resistorSvg } from '../resistor';
import { openSlotBoard } from '../slot-board/panel';

interface Common {
  title: string;
  briefing: string;
  onCancel: () => void;
  source?: { label: string; onFlag: () => void };
  onSound?: (s: 'click' | 'switch') => void;
}

export function openTheveninPanel(root: HTMLElement, opts: Common & { problem: TheveninProblem; onSubmit: (a: TheveninAnswer) => void }): () => void {
  const p = opts.problem;
  const norton = p.form === 'norton';
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `
    <div class="panel wide" role="dialog" aria-label="${esc(opts.title)}">
      <header class="panel-head">
        <span class="tag">ARIZA</span>
        <h2>${esc(opts.title)}</h2>
        <button class="ghost" data-act="cancel" title="Esc">Geri dön ✕</button>
      </header>
      <details class="briefing" open>
        <summary>Brifing</summary>
        <p>${esc(opts.briefing)}</p>
      </details>
      <div class="panel-body">
        <div class="schematic">${schematicSvg(p.network, { filled: {}, armed: false, visible: p.params })}</div>
        <div class="task">
          <div class="logbook"><h3>Yedek ağ</h3><p>${esc(p.network.story)} Modül a–b uçlarına bağlanacak ve pompa motorunu (R_L = ${esc(formatOhm(p.rl))}) besleyecek.</p></div>
          <h3>${norton ? 'Norton' : 'Thevenin'} eşdeğer modülü</h3>
          <p class="how">a–b uçlarından görülen eşdeğeri gir. Kabul: her değer ±%${Math.round(p.tolerance * 100)}. Virgül ya da nokta, k/m önekleri olur (ör. 2,2k).</p>
          <div class="qty-fields"></div>
          <button class="primary" data-act="submit" disabled>Modülü programla</button>
        </div>
      </div>
    </div>`;
  root.appendChild(el);
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;
  const check = () => (submit.disabled = !(fa.value() !== null && fb.value() !== null));
  const fa = norton ? quantityField('a', 'I_N (Norton akımı)', 'A', check) : quantityField('a', 'V_th (açık devre gerilimi)', 'V', check);
  const fb = quantityField('b', norton ? 'R_N' : 'R_th', 'Ω', check);
  el.querySelector('.qty-fields')!.append(fa.el, fb.el);

  const close = () => {
    window.removeEventListener('keydown', onKey);
    el.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      opts.onCancel();
    }
  };
  window.addEventListener('keydown', onKey);
  el.querySelector('[data-act="cancel"]')!.addEventListener('click', () => {
    close();
    opts.onCancel();
  });
  submit.addEventListener('click', () => {
    const a = fa.value();
    const b = fb.value();
    if (a === null || b === null) return;
    opts.onSound?.('switch');
    close();
    opts.onSubmit({ a, b });
  });
  return close;
}

/** Kara kutu (iç yapı görünmez) + uçlar + yük yuvası + verici. */
export function blackBoxSvg(filled: number | undefined, armed: boolean): string {
  const slot =
    filled === undefined
      ? `<rect x="300" y="101" width="18" height="52" class="slot-empty" rx="3"/><text x="336" y="132" class="lbl slot-lbl">R_yük = ?</text>`
      : `<g transform="translate(320,87) rotate(90)">${resistorSvg(filled, 80, 22, true)}</g><text x="336" y="132" class="lbl slot-lbl">R_yük = ${esc(formatOhm(filled))}</text>`;
  return `<svg viewBox="0 0 580 250" class="circuit board" aria-label="Kara kutu ve yük">
    <rect x="30" y="50" width="170" height="150" rx="8" class="sym"/>
    <text x="115" y="118" class="lbl" text-anchor="middle">KARA KUTU</text>
    <text x="115" y="140" class="lbl dim" text-anchor="middle">V_th = ? · R_th = ?</text>
    <polyline points="200,80 309,80 309,87" class="wire"/>
    <polyline points="200,170 309,170 309,167" class="wire"/>
    <g class="probe"><circle cx="230" cy="80" r="7"/><text x="222" y="66">a</text></g>
    <g class="probe"><circle cx="230" cy="170" r="7"/><text x="222" y="194">b</text></g>
    <g class="bslot${armed ? ' armed' : ''}${filled === undefined ? '' : ' filled'}" data-slot="RL" role="button" tabindex="-1" aria-label="Yük yuvası">
      <rect x="290" y="87" width="38" height="80" class="slot-hit"/>${slot}
    </g>
    <polyline points="309,80 500,80 500,100" class="wire"/><polyline points="309,170 500,170 500,150" class="wire"/>
    <path d="M485 100 h30 l-15 50 z" class="sym"/><text x="525" y="130" class="lbl">verici</text>
  </svg>`;
}

export function openMaxPowerPanel(root: HTMLElement, opts: Common & { problem: MaxPowerProblem; onSubmit: (cardId: string) => void }): () => void {
  const p = opts.problem;
  return openSlotBoard(root, {
    title: opts.title,
    briefing: opts.briefing,
    info: [
      { heading: 'Besleme kaydı', text: p.logText },
      { heading: 'Görev', text: 'Sonar vericisine kara kutudan en büyük gücü aktaracak yük direncini seç.' },
    ],
    slots: ['RL'],
    bin: p.bin,
    drawing: (filled, armed) => blackBoxSvg(filled.RL, armed),
    submitLabel: 'Tak ve yayına geç',
    onSubmit: (pl) => opts.onSubmit(pl.RL),
    onCancel: opts.onCancel,
    source: opts.source,
    onSound: opts.onSound,
  });
}
