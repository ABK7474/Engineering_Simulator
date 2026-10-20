// "Bölüm kapandı" katmanı: oyun bitmez, bölüm yeniden denenir.

import { esc } from '../puzzles/dom';

export interface EpisodeClosedInfo {
  title: string;
  /** Ne olacağını anlatan paragraf. */
  body: string;
  button: string;
  reason: string;
  episode: number;
  attempts: number;
  worst: string | null;
  onRestart: () => void;
}

export function showEpisodeClosed(root: HTMLElement, info: EpisodeClosedInfo): void {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `
    <div class="panel episode-closed" role="dialog" aria-label="${esc(info.title)}">
      <header class="panel-head">
        <span class="tag">KRİTİK</span>
        <h2>${esc(info.title)}</h2>
      </header>
      <p class="closed-reason">${esc(info.reason)}</p>
      <p>${esc(info.body)}</p>
      <dl>
        <dt>Bölüm</dt><dd>${info.episode}</dd>
        <dt>Bu bölümdeki deneme</dt><dd>${info.attempts}</dd>
        ${info.worst ? `<dt>En çok hasar veren olay</dt><dd>${esc(info.worst)}</dd>` : ''}
      </dl>
      <footer><button class="primary" data-act="restart">${esc(info.button)}</button></footer>
    </div>`;
  root.appendChild(el);
  el.querySelector('[data-act="restart"]')!.addEventListener('click', () => {
    el.remove();
    info.onRestart();
  });
}
