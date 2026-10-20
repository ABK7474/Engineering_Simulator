// Genel yuva + kutu paneli: bir çizim (yuvaları `data-slot` taşıyan SVG), kayıt/bilgi bölümleri ve direnç kutusu.
// Etkileşim devre kartı paneliyle aynı: kutudan direnç seç, sonra çizimdeki yuvaya tıkla; dolu yuvaya seçim
// yokken tıklamak direnci kutuya geri koyar. Tek yuvalı çizimde seçim doğrudan yuvaya oturur.

import { esc } from '../dom';
import { resistorSvg } from '../resistor';

export interface SlotCard {
  id: string;
  r: number;
  label: string;
}

export interface SlotBoardOptions {
  title: string;
  briefing: string;
  /** Kayıt/bilgi bölümleri (düz metin). */
  info: { heading: string; text: string }[];
  slots: string[];
  bin: SlotCard[];
  /** Yuvalardaki değerlere göre çizim (SVG metni); yuvalar `data-slot` ile işaretli. */
  drawing: (filled: Partial<Record<string, number>>, armed: boolean) => string;
  submitLabel: string;
  onSubmit: (placement: Record<string, string>) => void;
  onCancel: () => void;
  source?: { label: string; onFlag: () => void };
  onSound?: (s: 'click' | 'switch') => void;
}

export function openSlotBoard(root: HTMLElement, opts: SlotBoardOptions): () => void {
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
      ${opts.source ? `<p class="source-line">Konu: ${esc(opts.source.label)} <button class="ghost small" data-act="flag">Bu soru hatalı</button></p>` : ''}
      <details class="briefing" open>
        <summary>Brifing</summary>
        <p>${esc(opts.briefing)}</p>
      </details>
      <div class="panel-body">
        <div class="schematic"></div>
        <div class="task">
          ${opts.info.map((i) => `<div class="logbook"><h3>${esc(i.heading)}</h3><p>${esc(i.text)}</p></div>`).join('')}
          <h3>Direnç kutusu</h3>
          <p class="how">${opts.slots.length === 1 ? 'Bir direnç seç; yuvaya oturur.' : 'Bir direnç seç, sonra çizimdeki yuvaya tıkla.'} Dolu yuvaya tıklamak direnci kutuya geri koyar.</p>
          <div class="bin"></div>
          <button class="primary" data-act="submit" disabled>${esc(opts.submitLabel)}</button>
        </div>
      </div>
    </div>`;
  root.appendChild(el);

  const drawing = el.querySelector<HTMLDivElement>('.schematic')!;
  const bin = el.querySelector<HTMLDivElement>('.bin')!;
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;
  const rOf = (id: string) => opts.bin.find((b) => b.id === id)!.r;

  const render = () => {
    drawing.innerHTML = opts.drawing(Object.fromEntries(Object.entries(placement).map(([s, id]) => [s, rOf(id)])), selected !== null);
    const used = new Set(Object.values(placement));
    bin.innerHTML = '';
    for (const card of opts.bin) {
      if (used.has(card.id)) continue;
      const b = document.createElement('button');
      b.className = `resistor${card.id === selected ? ' selected' : ''}`;
      b.dataset.card = card.id;
      b.innerHTML = `${resistorSvg(card.r, 120, 34)}<span>${esc(card.label)}</span>`;
      bin.appendChild(b);
    }
    submit.disabled = !opts.slots.every((s) => placement[s]);
  };

  bin.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>('.resistor')?.dataset.card;
    if (!id) return;
    opts.onSound?.('click');
    if (opts.slots.length === 1) {
      placement[opts.slots[0]] = id;
      selected = null;
    } else selected = selected === id ? null : id;
    render();
  });
  drawing.addEventListener('click', (e) => {
    const slot = (e.target as Element).closest<SVGGElement>('[data-slot]')?.dataset.slot;
    if (!slot) return;
    if (selected) {
      placement[slot] = selected;
      selected = null;
    } else if (placement[slot]) delete placement[slot];
    else return;
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
  el.querySelector('[data-act="flag"]')?.addEventListener('click', () => {
    if (!confirm('Bu soru hatalı olarak işaretlensin mi?')) return;
    close();
    opts.source?.onFlag();
  });
  el.querySelector('[data-act="cancel"]')!.addEventListener('click', () => {
    close();
    opts.onCancel();
  });
  submit.addEventListener('click', () => {
    if (!opts.slots.every((s) => placement[s])) return;
    opts.onSound?.('switch');
    close();
    opts.onSubmit({ ...placement });
  });
  render();
  return close;
}
