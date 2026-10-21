// Genel sayı paneli: çizim + kayıt bölümleri + birimli sayı alanları. Türe özgü panellerin yazılmadığı
// sayısal cevaplı türler (süperpozisyon, Laplace, fazör, olasılık) bunu kullanır.

import { esc } from '../dom';
import { quantityField, type QuantityField } from '../numeric-entry/field';
import type { QuantityUnit } from '../numeric-entry/parse';

export interface NumericField {
  id: string;
  label: string;
  unit: QuantityUnit;
  /** Sıfır/negatif kabul (ör. faz açısı). */
  signed?: boolean;
}

export interface NumericPanelOptions {
  title: string;
  briefing: string;
  info: { heading: string; text: string }[];
  /** İsteğe bağlı çizim (SVG metni). */
  drawing?: string;
  fields: NumericField[];
  /** Kabul toleransı ve yazım ipucu. */
  note: string;
  submitLabel: string;
  onSubmit: (values: Record<string, number>) => void;
  onCancel: () => void;
  onSound?: (s: 'click' | 'switch') => void;
}

export function openNumericPanel(root: HTMLElement, opts: NumericPanelOptions): () => void {
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
      <div class="panel-body${opts.drawing ? '' : ' single'}">
        ${opts.drawing ? `<div class="schematic">${opts.drawing}</div>` : ''}
        <div class="task">
          ${opts.info.map((i) => `<div class="logbook"><h3>${esc(i.heading)}</h3><p>${esc(i.text)}</p></div>`).join('')}
          <p class="how">${esc(opts.note)}</p>
          <div class="qty-fields"></div>
          <button class="primary" data-act="submit" disabled>${esc(opts.submitLabel)}</button>
        </div>
      </div>
    </div>`;
  root.appendChild(el);
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;
  const fields: [string, QuantityField][] = [];
  const check = () => (submit.disabled = !fields.every(([, f]) => f.value() !== null));
  for (const f of opts.fields) {
    const q = quantityField(f.id, f.label, f.unit, check, f.signed);
    fields.push([f.id, q]);
    el.querySelector('.qty-fields')!.append(q.el);
  }
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
    if (!fields.every(([, f]) => f.value() !== null)) return;
    opts.onSound?.('switch');
    close();
    opts.onSubmit(Object.fromEntries(fields.map(([id, f]) => [id, f.value()!])));
  });
  return close;
}
