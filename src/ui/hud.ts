// Sade kaynak göstergesi. Yalnız gösterir: hesap yapmaz, kaynak modülünü bilmez.

import { esc } from '../puzzles/dom';

export interface HudRow {
  id: string;
  label: string;
  value: number;
  max: number;
  level: 'ok' | 'low' | 'critical';
  /** Onarılmamış hasardan gelen tüketim (/dk); 0 ise gösterilmez. */
  drainPerMinute: number;
}

export interface HudView {
  rows: HudRow[];
  /** Aktif kalıcı hasarların kısa açıklamaları. */
  damages: string[];
  episode: number;
  /** Süren tehdit olayı: saldırıya kalan süre (s) ve oyuncunun gürültüsü. */
  threat?: { remaining: number; noise: 0 | 1 | 2 } | null;
  /** Tekrar zamanı gelmiş konu sayısı. */
  reviewDue?: number;
  /** Sezon hedefinin tek satırı (ör. "Destek gemisine ulaş — Yedek güç panosu"). */
  goal?: string;
}

const fmt = (x: number, digits = 0) => x.toFixed(digits).replace('.', ',');

export function mountHud(root: HTMLElement): { render: (v: HudView) => void } {
  const el = document.createElement('div');
  el.className = 'hud';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'İstasyon kaynakları');
  root.appendChild(el);

  return {
    render(v) {
      el.innerHTML = `
        ${v.rows
          .map(
            (r) => `
          <div class="hud-row ${r.level}" data-res="${esc(r.id)}">
            <span class="hud-label">${esc(r.label)}</span>
            <span class="hud-bar"><span style="width:${Math.max(0, Math.min(100, (r.value / r.max) * 100))}%"></span></span>
            <span class="hud-value">%${fmt(Math.floor(r.value))}</span>
            ${r.drainPerMinute > 0 ? `<span class="hud-drain" title="Onarılmamış hasar">−${fmt(r.drainPerMinute, 1)}/dk</span>` : ''}
          </div>`,
          )
          .join('')}
        ${v.damages.length ? `<ul class="hud-damages">${v.damages.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${
          v.threat
            ? `<div class="hud-threat" title="Koşmak temasın yaklaşmasını hızlandırır"><span>TEMAS ${Math.floor(v.threat.remaining / 60)}:${String(Math.floor(v.threat.remaining % 60)).padStart(2, '0')}</span><span class="hud-noise" aria-label="Gürültü ${v.threat.noise}/2">gürültü ${'●'.repeat(v.threat.noise)}${'○'.repeat(2 - v.threat.noise)}</span></div>`
            : ''
        }
        ${v.goal ? `<div class="hud-goal"><b>Hedef:</b> ${esc(v.goal)}</div>` : ''}
        ${v.reviewDue ? `<div class="hud-review">Tekrar zamanı: ${v.reviewDue} konu (N)</div>` : ''}
        <div class="hud-episode">Bölüm ${v.episode}</div>`;
    },
  };
}
