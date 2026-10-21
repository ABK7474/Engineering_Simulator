// Sezon finali: yapay zekânın son replikleri ve sezon özeti. Oyun bitmez; serbest dolaşmaya dönülür.

import { esc } from '../puzzles/dom';

export interface FinaleInfo {
  speaker: string;
  lines: string[];
  stats: { label: string; value: string }[];
  onContinue: () => void;
}

export function showFinale(root: HTMLElement, info: FinaleInfo): void {
  const el = document.createElement('div');
  el.className = 'overlay finale';
  el.innerHTML = `
    <div class="panel" role="dialog" aria-label="Sezon 1 tamamlandı">
      <header class="panel-head">
        <span class="tag ok">SEZON 1</span>
        <h2>İstasyon ayakta</h2>
      </header>
      <div class="finale-lines">${info.lines.map((l, k) => `<p style="animation-delay:${k * 2.2}s"><b>${esc(info.speaker)}</b> ${esc(l)}</p>`).join('')}</div>
      <dl>${info.stats.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd>`).join('')}</dl>
      <footer><button class="primary" data-act="continue">Serbest dolaş</button></footer>
    </div>`;
  root.appendChild(el);
  el.querySelector('[data-act="continue"]')!.addEventListener('click', () => {
    el.remove();
    info.onContinue();
  });
}
