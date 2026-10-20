// Olay raporu: ne seçildi, ne oldu, doğrusu neydi, hesap nasıl. Asıl öğrenme burada.

import type { StageResult } from '../../core/types';
import { esc } from '../dom';

export interface IncidentReportOptions {
  /** Yalnızca başarısızlıkta gösterilir: yedek parçayla yeni deneme. */
  onRetry?: () => void;
  onClose: () => void;
  /** Başarıdan sonra arızanın sıradaki aşamasına geç. */
  onNext?: () => void;
  onSound?: (s: 'click') => void;
}

export function showIncidentReport(root: HTMLElement, r: StageResult, opts: IncidentReportOptions): () => void {
  const el = document.createElement('div');
  el.className = 'overlay';
  const status = r.success ? 'ok' : 'fail';
  el.innerHTML = `
    <div class="panel report ${status}" role="dialog" aria-label="Olay raporu">
      <header class="panel-head">
        <span class="tag ${status}">${r.success ? 'ONARILDI' : 'OLAY'}</span>
        <h2>Olay raporu</h2>
      </header>
      <section class="outcome">
        <h3>${esc(r.outcome.headline)}</h3>
        <p>${esc(r.outcome.explanation)}</p>
        ${r.outcome.resistorOverheat && r.outcome.kind !== 'resistor_burnt' ? '<p class="warn">Ek bulgu: direnç anma gücünün üstünde ısındı; panelde yanık izi kaldı.</p>' : ''}
      </section>
      <div class="report-grid">
        <section>
          <h4>Ölçümler</h4>
          <dl>${r.facts.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>
          <p class="verdict">Seçimin: <b>${esc(r.chosenLabel)}</b> · Doğrusu: <b>${esc(r.correctLabel)}</b></p>
        </section>
        <section>
          <h4>Hesap</h4>
          <ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        </section>
      </div>
      ${r.table ? tableHtml(r.table) : ''}
      <footer>
        ${!r.success && opts.onRetry ? '<button class="primary" data-act="retry">Yedek parçayla tekrar dene</button>' : ''}
        ${r.success && opts.onNext ? '<button class="primary" data-act="next">Sonraki aşama →</button>' : ''}
        <button class="${r.success && !opts.onNext ? 'primary' : 'ghost'}" data-act="close">İstasyona dön</button>
      </footer>
    </div>`;
  root.appendChild(el);

  const close = () => el.remove();
  el.querySelector('[data-act="close"]')!.addEventListener('click', () => {
    opts.onSound?.('click');
    close();
    opts.onClose();
  });
  el.querySelector('[data-act="next"]')?.addEventListener('click', () => {
    opts.onSound?.('click');
    close();
    opts.onNext?.();
  });
  el.querySelector('[data-act="retry"]')?.addEventListener('click', () => {
    opts.onSound?.('click');
    close();
    opts.onRetry?.();
  });
  return close;
}

function tableHtml(t: NonNullable<StageResult['table']>): string {
  const cls = (k: number) => [k === t.bad ? 'bad' : '', k === t.chosen ? 'chosen' : ''].join(' ').trim();
  return `<div class="trace-wrap"><h4>${esc(t.caption)}</h4><table class="trace">
    <thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map((r, k) => `<tr class="${cls(k)}">${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
