// Kontroller: tek liste; giriş ekranı ve Ayarlar aynı listeyi gösterir (tuş eklenince yalnız burası değişir).

import { esc } from '../puzzles/dom';

export const CONTROLS: [keys: string, action: string][] = [
  ['W A S D / oklar', 'yürü'],
  ['W W (çift dokun)', 'koş'],
  ['C', 'eğil (aç/kapa)'],
  ['Fare', 'bak'],
  ['E', 'etkileşim (panel, kapı, kilit)'],
  ['Q', 'bilek cihazına bak'],
  ['M', 'harita'],
  ['N', 'defter'],
  ['Boşluk', 'altyazıyı geç'],
  ['K', 'sessize al'],
  ['Esc', 'imleci bırak / paneli kapat'],
  ['⋯ menüsü', 'ayarlar, yedek, konu ekle'],
];

export const controlsHtml = (cls = 'controls') =>
  `<dl class="${cls}">${CONTROLS.map(([k, a]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(a)}</dd>`).join('')}</dl>`;
