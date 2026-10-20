// İstasyon yapay zekâsının replikleri: alt yazı kutusu, yazı efekti, sıra. Yalnız gösterir;
// hangi replik ne zaman söylenir kararını main.ts verir (replikler content/story/*.json).

import { esc } from '../puzzles/dom';

export function mountSubtitles(root: HTMLElement, speaker: string): { say: (lines: string[]) => void; busy: () => boolean } {
  const el = document.createElement('div');
  el.className = 'subtitle';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  root.appendChild(el);

  const queue: string[] = [];
  let playing = false;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const next = () => {
    const line = queue.shift();
    if (line === undefined) {
      playing = false;
      el.hidden = true;
      return;
    }
    playing = true;
    el.hidden = false;
    el.innerHTML = `<span class="speaker">${esc(speaker)}</span><span class="text"></span>`;
    const text = el.querySelector<HTMLSpanElement>('.text')!;
    let i = reduced ? line.length : 0;
    const tick = () => {
      text.textContent = line.slice(0, i);
      if (i < line.length) {
        i++;
        setTimeout(tick, 28);
      } else {
        setTimeout(next, 2600 + line.length * 35);
      }
    };
    tick();
  };

  return {
    say(lines) {
      queue.push(...lines);
      if (!playing) next();
    },
    busy: () => playing,
  };
}
