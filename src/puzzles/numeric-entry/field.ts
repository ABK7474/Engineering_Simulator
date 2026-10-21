// Birimli sayı alanı: yazarken anlaşılan değeri biçimlenmiş olarak gösterir ("= 2,2 kΩ").

import { formatAmp, formatFarad, formatHenry, formatHz, formatOhm, formatPct, formatSec, formatVolt } from '../../core/format';
import { esc } from '../dom';
import { parseQuantity, type QuantityUnit } from './parse';

const FORMAT: Record<QuantityUnit, (x: number) => string> = {
  V: formatVolt,
  A: formatAmp,
  'Ω': formatOhm,
  Hz: formatHz,
  s: formatSec,
  F: formatFarad,
  H: formatHenry,
  '%': (p) => formatPct(p, 2),
  '': (x) => String(Number(x.toPrecision(4))).replace('.', ','),
};
const HINT: Record<QuantityUnit, string> = {
  V: 'ör. 12,5 ya da 12.5 V',
  A: 'ör. 0,25 ya da 250m',
  'Ω': 'ör. 2,2k, 2200 ya da 2.2 kΩ',
  Hz: 'ör. 1,5k ya da 1500 Hz',
  s: 'ör. 0,25 ya da 250 ms',
  F: 'ör. 47µ ya da 47 µF',
  H: 'ör. 220m ya da 0,22 H',
  '%': 'ör. 38,2 ya da %38,2',
  '': 'ör. 2,5',
};

export interface QuantityField {
  el: HTMLLabelElement;
  /** Geçerli pozitif değer ya da null. */
  value: () => number | null;
}

/** `allowNonPositive`: sıfır ve negatif değerler de geçerli (ör. faz açısı). */
export function quantityField(id: string, label: string, unit: QuantityUnit, onChange: () => void, allowNonPositive = false): QuantityField {
  const el = document.createElement('label');
  el.className = 'qty';
  el.innerHTML = `<span>${esc(label)}</span><input data-qty="${esc(id)}" inputmode="decimal" autocomplete="off" placeholder="${esc(HINT[unit])}"><small class="qty-preview">&nbsp;</small>`;
  const input = el.querySelector('input')!;
  const preview = el.querySelector<HTMLElement>('.qty-preview')!;
  const value = () => {
    const v = parseQuantity(input.value, unit);
    return v !== null && (allowNonPositive || v > 0) ? v : null;
  };
  input.addEventListener('input', () => {
    const v = value();
    preview.textContent = input.value.trim() === '' ? ' ' : v === null ? 'anlaşılmadı' : `= ${FORMAT[unit](v)}`;
    preview.classList.toggle('bad', input.value.trim() !== '' && v === null);
    onChange();
  });
  return { el, value };
}
