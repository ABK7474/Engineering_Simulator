// Replikler: alt yazı kutusu, yazı efekti, sıra. Satır başına konuşmacı (NEREUS, NEXUS telsizden, MÜREN...).
// Boşluk tuşu: satır yazılıyorsa tamamlar, tamamsa sıradakine geçer (ilk izlenimde bekletmesin).
// Yalnız gösterir; hangi replik ne zaman söylenir kararını main/prolog verir (replikler content/story/*.json).

import { esc } from '../puzzles/dom';
import type { Spoken } from '../story/lines';

export interface Subtitles {
  say: (lines: Spoken[]) => void;
  busy: () => boolean;
  /** Sıradaki satıra geç (yazılıyorsa önce tamamla). */
  skip: () => void;
  /** Kuyruğu boşalt (prolog atlanınca). */
  clear: () => void;
  /** Kuyruk bitince (son satır kapandığında) çağrılır. */
  onIdle: (fn: () => void) => void;
}

/** Konuşmacıya göre görünüm: telsiz (NEXUS), sistem sesi (Müren, kıyafet). */
const STYLE: Record<string, string> = { nexus: 'radio', muren: 'system', suit: 'system' };

export function mountSubtitles(root: HTMLElement): Subtitles {
  const el = document.createElement('div');
  el.className = 'subtitle';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  root.appendChild(el);

  const queue: Spoken[] = [];
  const idle: (() => void)[] = [];
  let playing = false;
  let full = '';
  let shown = 0;
  let typeTimer = 0;
  let holdTimer = 0;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stop = () => {
    clearTimeout(typeTimer);
    clearTimeout(holdTimer);
  };
  const next = () => {
    stop();
    const line = queue.shift();
    if (line === undefined) {
      const was = playing;
      playing = false;
      el.hidden = true;
      if (was) idle.forEach((f) => f());
      return;
    }
    playing = true;
    el.hidden = false;
    el.className = `subtitle ${STYLE[line.who] ?? ''}`;
    el.innerHTML = `<span class="speaker">${esc(line.label)}</span><span class="text"></span><span class="skip" aria-hidden="true">Boşluk ›</span>`;
    const text = el.querySelector<HTMLSpanElement>('.text')!;
    full = line.text;
    shown = reduced ? full.length : 0;
    const tick = () => {
      text.textContent = full.slice(0, shown);
      if (shown < full.length) {
        shown++;
        typeTimer = window.setTimeout(tick, 22);
      } else holdTimer = window.setTimeout(next, 1400 + full.length * 32);
    };
    tick();
  };
  const finishLine = () => {
    stop();
    shown = full.length;
    el.querySelector<HTMLSpanElement>('.text')!.textContent = full;
    holdTimer = window.setTimeout(next, 1400 + full.length * 32);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !playing || e.repeat) return;
    // Panel açıkken ya da yazı alanındayken boşluk kendi işini yapsın
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;
    if (root.querySelector('.overlay')) return;
    e.preventDefault();
    if (shown < full.length) finishLine();
    else next();
  });

  return {
    say(lines) {
      queue.push(...lines);
      if (!playing) next();
    },
    busy: () => playing,
    skip: () => (shown < full.length ? finishLine() : next()),
    clear() {
      queue.length = 0;
      stop();
      playing = false;
      el.hidden = true;
    },
    onIdle: (fn) => idle.push(fn),
  };
}
