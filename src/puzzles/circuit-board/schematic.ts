// Genel devre şeması çizici (SVG). Konumlar içerik JSON'undaki `layout`tan gelir; yeni topoloji
// için kod gerekmez. Semboller IEC: direnç dikdörtgen, DC gerilim kaynağı (+/−), akım kaynağı (ok), motor Ⓜ, toprak.

import { formatUnit, type Drawable } from '../../solvers/circuit/design-core';
import { esc } from '../dom';
import { resistorSvg } from '../resistor';

const HALF = 40; // eleman ucu ile merkez arası

export interface SchematicState {
  /** Yuva → takılı direnç (Ω); boşsa yok. */
  filled: Partial<Record<string, number>>;
  /** Kutudan bir direnç seçili mi (yuvalar vurgulanır). */
  armed: boolean;
  /** Gösterilecek parametre değerleri (gizliler hariç). */
  visible: Record<string, number>;
}

export function schematicSvg(c: Drawable, st: SchematicState): string {
  const L = c.layout;
  const parts: string[] = [];

  for (const w of L.wires) parts.push(`<polyline points="${w.map((p) => p.join(',')).join(' ')}" class="wire"/>`);
  for (const [x, y] of L.dots) parts.push(`<circle cx="${x}" cy="${y}" r="3.5" class="dot"/>`);
  const [gx, gy] = L.ground;
  parts.push(
    `<g class="ground"><line x1="${gx}" y1="${gy}" x2="${gx}" y2="${gy + 10}"/>` +
      `<line x1="${gx - 12}" y1="${gy + 10}" x2="${gx + 12}" y2="${gy + 10}"/>` +
      `<line x1="${gx - 7}" y1="${gy + 15}" x2="${gx + 7}" y2="${gy + 15}"/>` +
      `<line x1="${gx - 3}" y1="${gy + 20}" x2="${gx + 3}" y2="${gy + 20}"/></g>`,
  );

  for (const e of c.elements) {
    const { x, y, dir, flip } = L.elements[e.id];
    const f = flip ? -1 : 1; // a ucu: dikeyde üst (f=1) ya da alt; yatayda sağ (f=1) ya da sol
    const h = dir === 'h';
    // Uçlardan gövdeye uzanan bağlantılar
    const lead = (len: number) =>
      h
        ? `<line x1="${x - HALF}" y1="${y}" x2="${x - len}" y2="${y}" class="wire"/><line x1="${x + len}" y1="${y}" x2="${x + HALF}" y2="${y}" class="wire"/>`
        : `<line x1="${x}" y1="${y - HALF}" x2="${x}" y2="${y - len}" class="wire"/><line x1="${x}" y1="${y + len}" x2="${x}" y2="${y + HALF}" class="wire"/>`;
    const labelAt = h ? { lx: x, ly: y - 26, anchor: 'middle' } : { lx: x + 26, ly: y + 4, anchor: 'start' };
    const label = (text: string, cls = 'lbl') =>
      `<text x="${labelAt.lx}" y="${labelAt.ly}" class="${cls}" text-anchor="${labelAt.anchor}">${esc(text)}</text>`;

    if (e.slot) {
      const r = st.filled[e.id];
      const hit = h ? `x="${x - HALF}" y="${y - 18}" width="${2 * HALF}" height="36"` : `x="${x - 18}" y="${y - HALF}" width="36" height="${2 * HALF}"`;
      const body =
        r === undefined
          ? `<rect ${h ? `x="${x - 26}" y="${y - 9}" width="52" height="18"` : `x="${x - 9}" y="${y - 26}" width="18" height="52"`} class="slot-empty" rx="3"/>`
          : `<g transform="${h ? `translate(${x - HALF},${y - 11})` : `translate(${x + 11},${y - HALF}) rotate(90)`}">${resistorSvg(r, 2 * HALF, 22, true)}</g>`;
      parts.push(
        `<g class="bslot${st.armed ? ' armed' : ''}${r === undefined ? '' : ' filled'}" data-slot="${esc(e.id)}" role="button" tabindex="-1" aria-label="${esc(e.label)} yuvası">` +
          `<rect ${hit} class="slot-hit"/>${r === undefined ? lead(26) : ''}${body}` +
          label(r === undefined ? `${e.label} = ?` : `${e.label} = ${formatUnit(r, 'Ω')}`, 'lbl slot-lbl') +
          `</g>`,
      );
      continue;
    }

    if (e.kind === 'V') {
      const v = st.visible[e.value!];
      parts.push(
        lead(18) +
          `<circle cx="${x}" cy="${y}" r="18" class="sym"/>` +
          `<text x="${h ? x + 8 * f : x}" y="${h ? y + 4 : y + (f > 0 ? -5 : 12)}" class="sign" text-anchor="middle">+</text>` +
          `<text x="${h ? x - 8 * f : x}" y="${h ? y + 4 : y + (f > 0 ? 12 : -5)}" class="sign" text-anchor="middle">−</text>` +
          label(v === undefined ? e.label : `${e.label} = ${formatUnit(v, 'V')}`),
      );
    } else if (e.kind === 'I') {
      // Gerilim kaynağıyla aynı kural: a ucu üstte (dikey) ya da sağda (yatay). Kaynağın içindeki akım
      // a'dan b'ye akar; ok b'yi gösterir.
      const v = st.visible[e.value!];
      const [ax, ay, bx, by] = h ? [x + 10 * f, y, x - 10 * f, y] : [x, y - 10 * f, x, y + 10 * f];
      const head = h ? `M${bx + 5 * f} ${by - 5} L${bx} ${by} L${bx + 5 * f} ${by + 5}` : `M${bx - 5} ${by - 5 * f} L${bx} ${by} L${bx + 5} ${by - 5 * f}`;
      parts.push(
        lead(18) +
          `<circle cx="${x}" cy="${y}" r="18" class="sym"/>` +
          `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="sym-arrow"/>` +
          `<path d="${head}" class="sym-arrow"/>` +
          label(v === undefined ? e.label : `${e.label} = ${formatUnit(v, 'A')}`),
      );
    } else if (e.symbol === 'motor') {
      const v = st.visible[e.value!];
      parts.push(
        lead(20) +
          `<circle cx="${x}" cy="${y}" r="20" class="sym"/>` +
          `<text x="${x}" y="${y + 6}" class="motor-m" text-anchor="middle">M</text>` +
          label(v === undefined ? `${e.label} (R = ?)` : `${e.label} ${formatUnit(v, 'Ω')}`),
      );
    } else {
      const v = st.visible[e.value!];
      parts.push(
        lead(22) +
          `<rect ${h ? `x="${x - 22}" y="${y - 8}" width="44" height="16"` : `x="${x - 8}" y="${y - 22}" width="16" height="44"`} class="sym"/>` +
          label(v === undefined ? `${e.label} = ?` : `${e.label} = ${formatUnit(v, 'Ω')}`),
      );
    }
  }

  for (const lb of L.labels) parts.push(`<text x="${lb.x}" y="${lb.y}" class="lbl node-lbl">${esc(lb.text)}</text>`);
  for (const pr of L.probes) {
    parts.push(`<g class="probe"><circle cx="${pr.x}" cy="${pr.y}" r="7"/><text x="${pr.x + 10}" y="${pr.y - 10}">${esc(pr.text)}</text></g>`);
  }

  const [vx, vy, vw, vh] = L.viewBox;
  return `<svg viewBox="${vx} ${vy} ${vw} ${vh}" class="circuit board" aria-label="Devre şeması">${parts.join('')}</svg>`;
}
