// Sezon finali: destek gemisine (Ece'ye) ulaşılır, NEREUS itiraf eder, oyuncu seçer (kapsülle ayrıl / kal). "Kal": seçimin
// replikleri ve sezon özeti aynı panelde açılır. "Ayrıl": panel kapanır, kapsül sahnesi oynar (ending-flow.ts), sonra
// `showSeasonEnd` özeti gösterir. Oyun bitmez; serbest dolaşmaya dönülür. Yalnız gösterir; kaydı main yapar.

import { esc } from '../puzzles/dom';
import type { Spoken } from '../story/lines';

export type Ending = 'left' | 'stayed';

export interface FinaleInfo {
  lines: Spoken[];
  /** "Kal" seçiminden sonra söylenecek replikler. */
  after: Spoken[];
  stats: { label: string; value: string }[];
  onChoose: (e: Ending) => void;
  /** "Kapsülle ayrıl": panel kapandı, sahne başlasın. */
  onLeave: () => void;
  onContinue: () => void;
}

export interface SeasonEndInfo {
  stats: { label: string; value: string }[];
  onContinue: () => void;
}

const statsHtml = (stats: SeasonEndInfo['stats']) => `<dl>${stats.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd>`).join('')}</dl>`;

/** Kapsül sahnesinden sonra: "Sezon 1 bitti. Kurtuldun." ve sezon özeti. */
export function showSeasonEnd(root: HTMLElement, info: SeasonEndInfo): void {
  const el = document.createElement('div');
  el.className = 'overlay finale season-end';
  el.innerHTML = `
    <div class="panel" role="dialog" aria-label="Sezon 1 bitti">
      <header class="panel-head">
        <span class="tag ok">SEZON 1</span>
        <h2>Yüzeyde</h2>
      </header>
      <div class="finale-tail">
        <p class="finale-end">Sezon 1 bitti. Kurtuldun.</p>
        <p class="season-end-note">İstasyon aşağıda, karanlıkta. NEREUS hâlâ orada; istersen dönüp dolaşabilirsin.</p>
        ${statsHtml(info.stats)}
        <footer><button class="primary" data-act="continue">İstasyona dön (serbest dolaş)</button></footer>
      </div>
    </div>`;
  root.appendChild(el);
  el.querySelector('[data-act="continue"]')!.addEventListener('click', () => {
    el.remove();
    info.onContinue();
  });
}

const DELAY = 1.6;
const lineHtml = (ls: Spoken[]) => ls.map((l, k) => `<p class="${l.who}" style="animation-delay:${k * DELAY}s"><b>${esc(l.label)}</b> ${esc(l.text)}</p>`).join('');

export function showFinale(root: HTMLElement, info: FinaleInfo): void {
  const el = document.createElement('div');
  el.className = 'overlay finale';
  el.innerHTML = `
    <div class="panel" role="dialog" aria-label="Sezon 1 finali">
      <header class="panel-head">
        <span class="tag ok">SEZON 1</span>
        <h2>Yüzeyle bağlantı</h2>
      </header>
      <div class="finale-lines">${lineHtml(info.lines)}</div>
      <footer class="finale-choice" style="animation-delay:${info.lines.length * DELAY}s">
        <button class="primary" data-end="left">Kapsülle ayrıl</button>
        <button class="ghost" data-end="stayed">Kal ve öğren</button>
      </footer>
    </div>`;
  root.appendChild(el);
  el.querySelectorAll<HTMLButtonElement>('[data-end]').forEach((b) =>
    b.addEventListener('click', () => {
      const end = b.dataset.end as Ending;
      info.onChoose(end);
      if (end === 'left') {
        el.remove();
        info.onLeave();
        return;
      }
      const panel = el.querySelector('.panel')!;
      panel.querySelector('h2')!.textContent = 'NEREUS ile';
      panel.querySelector('.finale-choice')!.remove();
      const after = document.createElement('div');
      after.className = 'finale-lines';
      after.innerHTML = lineHtml(info.after);
      panel.append(after);
      const tail = document.createElement('div');
      tail.className = 'finale-tail';
      tail.style.animationDelay = `${info.after.length * DELAY}s`;
      tail.innerHTML = `<p class="finale-end">Sezon 1 bitti. Sezon 2: NEREUS anlatıyor.</p>
        ${statsHtml(info.stats)}
        <footer><button class="primary" data-act="continue">Serbest dolaş</button></footer>`;
      panel.append(tail);
      tail.querySelector('[data-act="continue"]')!.addEventListener('click', () => {
        el.remove();
        info.onContinue();
      });
    }),
  );
}
