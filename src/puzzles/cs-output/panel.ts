// C# çıktı tahmini paneli: program + satır satır çıktı alanları. Satır sayısı verilir; oyuncu her satırı yazar.

import type { CsProblem } from '../../solvers/cs/cs-output';
import { esc } from '../dom';

export interface CsPanelOptions {
  title: string;
  briefing: string;
  problem: CsProblem;
  onSubmit: (lines: string[]) => void;
  onCancel: () => void;
  source?: { label: string; onFlag: () => void };
  onSound?: (s: 'click' | 'switch') => void;
}

export function openCsOutputPanel(root: HTMLElement, opts: CsPanelOptions): () => void {
  const p = opts.problem;
  const n = p.instance.output.length;
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `
    <div class="panel trace-panel" role="dialog" aria-label="${esc(opts.title)}">
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
      <p class="prompt">Çekirdek bu modülü yüklemeden önce çıktısının öngörülmesini istiyor. Program konsola <b>${n} satır</b> yazar. Derleyici yok: kodu kafanda çalıştır ve her satırı yaz.</p>
      <div class="trace-body">
        <pre class="code" aria-label="C# programı">${p.code.map((l, i) => `<span class="ln"><i>${i + 1}</i>${esc(l) || ' '}</span>`).join('')}</pre>
        <div class="task">
          <h3>Konsol çıktısı</h3>
          <div class="cs-lines">
            ${Array.from({ length: n }, (_, k) => `<label class="cs-line"><i>${k + 1}</i><input data-line="${k}" autocomplete="off" spellcheck="false"></label>`).join('')}
          </div>
          <p class="how">Her satırı Console.WriteLine'ın yazacağı gibi yaz (büyük/küçük harf önemli; baştaki ve sondaki boşluk önemsiz).</p>
          <button class="primary" data-act="submit" disabled>Modülü yükle</button>
        </div>
      </div>
    </div>`;
  root.appendChild(el);
  const inputs = [...el.querySelectorAll<HTMLInputElement>('input[data-line]')];
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;
  const check = () => (submit.disabled = inputs.some((i) => i.value.trim() === ''));
  inputs.forEach((i, k) => {
    i.addEventListener('input', check);
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (inputs[k + 1] ?? submit).focus();
    });
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
    if (submit.disabled) return;
    opts.onSound?.('switch');
    close();
    opts.onSubmit(inputs.map((i) => i.value));
  });
  inputs[0]?.focus();
  return close;
}
