// Zaman grafiği (SVG, osiloskop görünümü): eğriler, eşik çizgisi ve kabul penceresi.

import type { TimePlot } from '../../core/types';
import { esc } from '../dom';

const W = 560;
const H = 240;
const PAD = { l: 52, r: 14, t: 30, b: 38 };

const fmt = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');

export function plotSvg(p: TimePlot): string {
  const xs = p.series.flatMap((s) => s.points.map(([x]) => x * p.xScale));
  const ys = [...p.series.flatMap((s) => s.points.map(([, y]) => y * p.yScale)), p.threshold * p.yScale];
  const x1 = Math.max(...xs, p.window[1] * p.xScale * 1.1);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(...ys) * 1.08;
  const X = (x: number) => PAD.l + ((x * p.xScale) / x1) * (W - PAD.l - PAD.r);
  const Y = (y: number) => H - PAD.b - ((y * p.yScale - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const parts: string[] = [];
  // pencere bandı
  parts.push(`<rect x="${X(p.window[0])}" y="${PAD.t}" width="${X(p.window[1]) - X(p.window[0])}" height="${H - PAD.t - PAD.b}" class="plot-window"/>`);
  // ızgara ve eksen yazıları
  for (let k = 0; k <= 4; k++) {
    const gx = PAD.l + (k / 4) * (W - PAD.l - PAD.r);
    const gy = PAD.t + (k / 4) * (H - PAD.t - PAD.b);
    parts.push(`<line x1="${gx}" y1="${PAD.t}" x2="${gx}" y2="${H - PAD.b}" class="plot-grid"/><line x1="${PAD.l}" y1="${gy}" x2="${W - PAD.r}" y2="${gy}" class="plot-grid"/>`);
    parts.push(`<text x="${gx}" y="${H - PAD.b + 14}" class="plot-lbl" text-anchor="middle">${fmt((k / 4) * x1)}</text>`);
    parts.push(`<text x="${PAD.l - 6}" y="${gy + 4}" class="plot-lbl" text-anchor="end">${fmt(y1 - (k / 4) * (y1 - y0))}</text>`);
  }
  parts.push(`<text x="${(W + PAD.l) / 2}" y="${H - 6}" class="plot-lbl" text-anchor="middle">${esc(p.xLabel)}</text>`);
  parts.push(`<text x="${PAD.l - 6}" y="${PAD.t - 16}" class="plot-lbl" text-anchor="end">${esc(p.yLabel)}</text>`);
  // eşik
  parts.push(`<line x1="${PAD.l}" y1="${Y(p.threshold)}" x2="${W - PAD.r}" y2="${Y(p.threshold)}" class="plot-th"/>`);
  parts.push(`<text x="${W - PAD.r - 4}" y="${Y(p.threshold) - 5}" class="plot-lbl" text-anchor="end">eşik</text>`);
  for (const s of p.series) {
    const pts = s.points.filter(([x]) => x * p.xScale <= x1).map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
    parts.push(`<polyline points="${pts}" class="plot-line ${s.kind}"><title>${esc(s.label)}</title></polyline>`);
  }
  const legend = p.series.map((s, k) => `<g transform="translate(${PAD.l + 8 + k * 200},${PAD.t - 14})"><line x1="0" y1="0" x2="18" y2="0" class="plot-line ${s.kind}"/><text x="24" y="4" class="plot-lbl">${esc(s.label)}</text></g>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="scope-plot" aria-label="${esc(p.caption)}">${parts.join('')}${legend}</svg>`;
}
