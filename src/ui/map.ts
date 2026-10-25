// M: sade kat planı (SVG). Keşfedilen odalar, kapı durumları, arıza işaretleri, oyuncu ve hedef.
// Girdiyi kilitlemez (üst katman); oyuncu harita açıkken yürüyebilir. Yalnız gösterir, mantık yok.

import { esc } from '../puzzles/dom';

export interface MapRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapView {
  title: string;
  rooms: { id: string; name: string; rect: MapRect; discovered: boolean; current: boolean }[];
  /** horizontal: kuzey/güney duvarındaki kapı (x boyunca çizilir). */
  doors: { id: string; x: number; z: number; horizontal: boolean; open: boolean; visible: boolean }[];
  faults: { id: string; label: string; why?: string; x: number; z: number; status: 'open' | 'blocked' | 'solved'; visible: boolean }[];
  player: { x: number; z: number; yaw: number } | null;
  /** Gidilmesi gereken arıza (koşul eksikken gösterilir). */
  target: string | null;
  bounds: MapRect;
}

const ICON = { open: '!', blocked: '⚡', solved: '✓' } as const;

export function mountMap(root: HTMLElement): { toggle: (open?: boolean) => void; isOpen: () => boolean; render: (v: MapView) => void } {
  const el = document.createElement('div');
  el.className = 'map-panel';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Kat planı');
  root.appendChild(el);

  return {
    toggle(open) {
      el.hidden = !(open ?? el.hidden);
    },
    isOpen: () => !el.hidden,
    render(v) {
      if (el.hidden) return;
      const pad = 3;
      const vb = [v.bounds.minX - pad, v.bounds.minZ - pad, v.bounds.maxX - v.bounds.minX + 2 * pad, v.bounds.maxZ - v.bounds.minZ + 2 * pad];
      // Önce bütün oda dikdörtgenleri, sonra etiketler: komşu odanın dikdörtgeni etiketin üstünü örtmesin.
      // Eksenler 3B görüntüyle aynı: x sağa, z aşağı (oyuncunun başlangıçta baktığı −z haritada yukarı).
      const known = v.rooms.filter((r) => r.discovered);
      const rooms =
        known
          .map(
            (r) => `<g class="map-room${r.current ? ' current' : ''}">
            <rect x="${r.rect.minX}" y="${r.rect.minZ}" width="${r.rect.maxX - r.rect.minX}" height="${r.rect.maxZ - r.rect.minZ}" rx="0.4"/></g>`,
          )
          .join('') +
        known
          .map((r) => `<g class="map-room${r.current ? ' current' : ''}"><text x="${(r.rect.minX + r.rect.maxX) / 2}" y="${(r.rect.minZ + r.rect.maxZ) / 2}" text-anchor="middle">${esc(r.name)}</text></g>`)
          .join('');
      const doors = v.doors
        .filter((d) => d.visible)
        .map((d) =>
          d.horizontal
            ? `<line class="map-door ${d.open ? 'open' : 'locked'}" x1="${d.x - 1.6}" y1="${d.z}" x2="${d.x + 1.6}" y2="${d.z}"/>`
            : `<line class="map-door ${d.open ? 'open' : 'locked'}" x1="${d.x}" y1="${d.z - 1.6}" x2="${d.x}" y2="${d.z + 1.6}"/>`,
        )
        .join('');
      const faults = v.faults
        .filter((f) => f.visible)
        .map(
          (f) => `<g class="map-fault ${f.status}${f.id === v.target ? ' target' : ''}" transform="translate(${f.x} ${f.z})">
            ${f.id === v.target ? '<circle class="pulse" r="2.2"/>' : ''}
            <circle r="1.05"/><text y="0.42" text-anchor="middle">${ICON[f.status]}</text>
            <title>${esc(f.label)}${f.why ? ` — ${esc(f.why)}` : ''}</title></g>`,
        )
        .join('');
      const p = v.player;
      const player = p
        ? `<g class="map-player" transform="translate(${p.x} ${p.z}) rotate(${(-p.yaw * 180) / Math.PI})">
            <circle r="0.7"/><path d="M0 -2.2 L0.9 -0.4 L-0.9 -0.4 Z"/></g>`
        : '';
      const target = v.faults.find((f) => f.id === v.target);
      el.innerHTML = `
        <header>${esc(v.title)} <span class="muted">M ile kapat</span></header>
        <svg viewBox="${vb.join(' ')}" class="map-svg" aria-hidden="true">${rooms}${doors}${faults}${player}</svg>
        ${target ? `<p class="map-goal">Hedef: <b>${esc(target.label)}</b>${target.why ? `<br><span class="dim">${esc(target.why)}</span>` : ''}</p>` : ''}
        <ul class="map-legend">
          <li><span class="sw open">!</span> çözülmemiş</li><li><span class="sw blocked">⚡</span> koşul eksik</li>
          <li><span class="sw solved">✓</span> çözüldü</li><li><span class="door locked"></span> kilitli</li><li><span class="door open"></span> açık</li>
        </ul>`;
    },
  };
}
