// Seri-paralel aşama paneli: şema + ölçüm kaydı + hedefler + direnç kutusu.
// Etkileşim: kutudan direnç seç (tıkla), sonra şemadaki yuvaya tıkla. Dolu yuvaya seçim
// yokken tıklamak direnci kutuya geri koyar. Three.js'i ve kaynakları bilmez.

import { formatUnit, slotIds, type SeriesParallelConfig } from '../../solvers/circuit/series-parallel';
import type { SpProblem } from '../../solvers/circuit/series-parallel.generate';
import { esc } from '../dom';
import { resistorSvg } from '../resistor';
import { schematicSvg } from './schematic';

export interface CircuitBoardOptions {
  title: string;
  briefing: string;
  config: SeriesParallelConfig;
  problem: SpProblem;
  onSubmit: (placement: Record<string, string>) => void;
  onCancel: () => void;
  onSound?: (s: 'click' | 'switch') => void;
}

export function openCircuitBoardPanel(root: HTMLElement, opts: CircuitBoardOptions): () => void {
  const { config: c, problem: p } = opts;
  const slots = slotIds(c);
  const placement: Record<string, string> = {};
  let selected: string | null = null;

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
        <div class="schematic"></div>
        <div class="task">
          <div class="logbook"><h3>Ölçüm kaydı</h3><p>${esc(p.measurementText)}</p></div>
          <h3>Hedefler</h3>
          <ul class="targets">${c.targets
            .map((t) => `<li><span>${esc(t.label)}</span><b>${formatUnit(p.targets[t.id], t.unit)} ± %${Math.round(t.tolerance * 100)}</b></li>`)
            .join('')}</ul>
          <p class="limits">Yuva dirençleri ${formatUnit(c.limits.slotRating_W, 'W')} anma gücünde.</p>
          <h3>Direnç kutusu</h3>
          <p class="how">Bir direnç seç, sonra şemadaki yuvaya tıkla. Dolu yuvaya tıklamak direnci kutuya geri koyar.</p>
          <div class="bin"></div>
          <button class="primary" data-act="submit" disabled>Tak ve çalıştır</button>
        </div>
      </div>
    </div>`;
  root.appendChild(el);

  const schematic = el.querySelector<HTMLDivElement>('.schematic')!;
  const bin = el.querySelector<HTMLDivElement>('.bin')!;
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;
  const rOf = (id: string) => p.bin.find((b) => b.id === id)!.r;

  const render = () => {
    const filled = Object.fromEntries(Object.entries(placement).map(([s, id]) => [s, rOf(id)]));
    schematic.innerHTML = schematicSvg(c, { filled, armed: selected !== null, visible: p.visible });
    const used = new Set(Object.values(placement));
    bin.innerHTML = '';
    for (const card of p.bin) {
      if (used.has(card.id)) continue;
      const b = document.createElement('button');
      b.className = `resistor${card.id === selected ? ' selected' : ''}`;
      b.dataset.card = card.id;
      b.innerHTML = `${resistorSvg(card.r, 120, 34)}<span>${esc(card.label)}</span>`;
      bin.appendChild(b);
    }
    submit.disabled = !slots.every((s) => placement[s]);
  };

  bin.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>('.resistor')?.dataset.card;
    if (!id) return;
    opts.onSound?.('click');
    selected = selected === id ? null : id;
    render();
  });

  schematic.addEventListener('click', (e) => {
    const slot = (e.target as Element).closest<SVGGElement>('[data-slot]')?.dataset.slot;
    if (!slot) return;
    if (selected) {
      placement[slot] = selected; // dolu yuvadaki eski direnç kendiliğinden kutuya döner
      selected = null;
    } else if (placement[slot]) {
      delete placement[slot];
    } else {
      return;
    }
    opts.onSound?.('click');
    render();
  });

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
    if (!slots.every((s) => placement[s])) return;
    opts.onSound?.('switch');
    close();
    opts.onSubmit({ ...placement });
  });

  render();
  return close;
}
