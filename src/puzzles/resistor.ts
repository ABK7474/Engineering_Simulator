// Renk bantlı direnç çizimi (4 bant: iki basamak, çarpan, altın tolerans). Panellerde ortak.

const BAND = ['#000000', '#7a3e10', '#d0261c', '#f07d16', '#f0d020', '#2e9e3a', '#2a5fd0', '#8a3fc0', '#8a8a8a', '#f4f4f4'];
const GOLD = '#c9a43a';

/** 4 bantlı renk kodu: iki basamak, çarpan, tolerans (altın). */
function bands(r: number): string[] {
  const exp = Math.floor(Math.log10(r)) - 1;
  const digits = Math.round(r / 10 ** exp);
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const mult = exp === -1 ? GOLD : BAND[exp];
  return [BAND[d1], BAND[d2], mult, GOLD];
}

export function resistorSvg(r: number, w: number, h: number, inline = false): string {
  const bx = w * 0.25;
  const bw = w * 0.5;
  const cols = bands(r);
  const xs = [0.12, 0.27, 0.42, 0.78].map((f) => bx + bw * f);
  const inner = `
    <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" class="lead"/>
    <rect x="${bx}" y="${h * 0.15}" width="${bw}" height="${h * 0.7}" rx="${h * 0.3}" class="body"/>
    ${xs.map((x, k) => `<rect x="${x}" y="${h * 0.15}" width="${bw * 0.08}" height="${h * 0.7}" fill="${cols[k]}"/>`).join('')}`;
  return inline ? inner : `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${inner}</svg>`;
}
