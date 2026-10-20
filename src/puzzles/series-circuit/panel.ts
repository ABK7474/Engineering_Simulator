// 2D seri devre paneli: şema + direnç kutusu. Three.js'i bilmez; yalnızca seçimi geri bildirir.

import type { ResistorChoice, SeriesLedProblem } from '../../solvers/circuit/series-led.generate';
import { esc } from '../dom';
import { resistorSvg } from '../resistor';

export interface SeriesCircuitPanelOptions {
  title: string;
  briefing: string;
  problem: SeriesLedProblem;
  onSubmit: (choiceId: string) => void;
  onCancel: () => void;
  /** Kullanıcının konusundan üretilmiş şablonsa: kaynak ve "bu soru hatalı". */
  source?: { label: string; onFlag: () => void };
  /** Arayüz sesi isteği (ses katmanını bilmeden). */
  onSound?: (s: 'click' | 'switch') => void;
}

const LED_HEX: Record<string, string> = {
  kırmızı: '#ff4040',
  sarı: '#ffd23f',
  yeşil: '#3fff7a',
  mavi: '#4aa3ff',
};

/** Paneli açar; dönen fonksiyon paneli kapatır. */
export function openSeriesCircuitPanel(root: HTMLElement, opts: SeriesCircuitPanelOptions): () => void {
  const { problem } = opts;
  let selected: ResistorChoice | null = null;

  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `
    <div class="panel" role="dialog" aria-label="${esc(opts.title)}">
      <header class="panel-head">
        <span class="tag">ARIZA</span>
        <h2>${esc(opts.title)}</h2>
        <button class="ghost" data-act="cancel" title="Esc">Geri dön ✕</button>
      </header>
      ${opts.source ? `<p class="source-line">Konu: ${esc(opts.source.label)} <button class="ghost small" data-act="flag" title="Bu soruyu havuzdan çıkar">Bu soru hatalı</button></p>` : ''}
      <details class="briefing" open>
        <summary>Brifing</summary>
        <p>${esc(opts.briefing)}</p>
      </details>
      <div class="panel-body">
        <div class="schematic"></div>
        <div class="task">
          <p class="prompt">${esc(problem.prompt)}</p>
          <h3>Direnç kutusu</h3>
          <div class="bin"></div>
          <button class="primary" data-act="submit" disabled>Tak ve çalıştır</button>
        </div>
      </div>
    </div>`;
  root.appendChild(el);

  const schematic = el.querySelector<HTMLDivElement>('.schematic')!;
  const bin = el.querySelector<HTMLDivElement>('.bin')!;
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;

  const renderSchematic = () => {
    schematic.innerHTML = schematicSvg(problem, selected);
  };

  for (const c of problem.choices) {
    const b = document.createElement('button');
    b.className = 'resistor';
    b.innerHTML = `${resistorSvg(c.r, 120, 34)}<span>${esc(c.label)}</span>`;
    b.addEventListener('click', () => {
      opts.onSound?.('click');
      selected = c;
      bin.querySelectorAll('.resistor').forEach((x) => x.classList.toggle('selected', x === b));
      submit.disabled = false;
      renderSchematic();
    });
    bin.appendChild(b);
  }
  renderSchematic();

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

  el.querySelector('[data-act="flag"]')?.addEventListener('click', () => {
    if (!confirm('Bu soru hatalı olarak işaretlensin mi? Şablon oyun havuzundan çıkarılır (kütüphanede kalır).')) return;
    close();
    opts.source?.onFlag();
  });
  el.querySelector('[data-act="cancel"]')!.addEventListener('click', () => {
    close();
    opts.onCancel();
  });
  submit.addEventListener('click', () => {
    if (!selected) return;
    opts.onSound?.('switch');
    close();
    opts.onSubmit(selected.id);
  });

  return close;
}

function schematicSvg(p: SeriesLedProblem, sel: ResistorChoice | null): string {
  const led = LED_HEX[p.spec.led.color] ?? '#ffffff';
  const vs = String(p.spec.vs).replace('.', ',');
  const vf = String(p.spec.led.model.vf).replace('.', ',');
  const slot = sel
    ? `<g transform="translate(130,22)">${resistorSvg(sel.r, 100, 30, true)}</g>
       <text x="180" y="78" class="lbl" text-anchor="middle">R = ${esc(sel.label)}</text>`
    : `<rect x="130" y="22" width="100" height="30" rx="4" class="slot"/>
       <text x="180" y="42" class="lbl dim" text-anchor="middle">R = ?</text>`;
  return `
  <svg viewBox="0 0 340 230" class="circuit" aria-label="Seri devre şeması">
    <!-- teller -->
    <path d="M60 37 H130 M230 37 H290 V95 M290 140 V193 H60 V130 M60 105 V37" class="wire"/>
    <!-- pil -->
    <line x1="42" y1="105" x2="78" y2="105" class="cell"/>
    <line x1="50" y1="118" x2="70" y2="118" class="cell thick"/>
    <line x1="60" y1="118" x2="60" y2="130" class="wire"/>
    <text x="34" y="100" class="lbl">+</text>
    <text x="86" y="117" class="lbl">Vs = ${vs} V</text>
    ${slot}
    <!-- LED (anot üstte, akım aşağı) -->
    <polygon points="276,95 304,95 290,120" fill="${led}" fill-opacity="0.25" stroke="${led}" stroke-width="2"/>
    <line x1="274" y1="120" x2="306" y2="120" stroke="${led}" stroke-width="3"/>
    <line x1="290" y1="120" x2="290" y2="140" class="wire"/>
    <path d="M308 100 l12 -8 M312 108 l12 -8" stroke="${led}" stroke-width="1.5"/>
    <text x="332" y="165" class="lbl" text-anchor="end">LED · Vf = ${vf} V</text>
    <!-- akım yönü -->
    <path d="M95 30 l8 7 l-8 7" class="arrow"/>
    <text x="92" y="22" class="lbl dim">I</text>
  </svg>`;
}
