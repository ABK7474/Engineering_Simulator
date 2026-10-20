// Birimli sayı alanı: yazarken anlaşılan değeri biçimlenmiş olarak gösterir ("= 2,2 kΩ").

import { formatAmp, formatOhm, formatVolt } from '../../core/format';
import { esc } from '../dom';
import { parseQuantity, type QuantityUnit } from './parse';

const FORMAT: Record<QuantityUnit, (x: number) => string> = { V: formatVolt, A: formatAmp, 'Ω': formatOhm };
const HINT: Record<QuantityUnit, string> = { V: 'ör. 12,5 ya da 12.5 V', A: 'ör. 0,25 ya da 250m', 'Ω': 'ör. 2,2k, 2200 ya da 2.2 kΩ' };

export interface QuantityField {
  el: HTMLLabelElement;
  /** Geçerli pozitif değer ya da null. */
  value: () => number | null;
}

export function quantityField(id: string, label: string, unit: QuantityUnit, onChange: () => void): QuantityField {
  const el = document.createElement('label');
  el.className = 'qty';
  el.innerHTML = `<span>${esc(label)}</span><input data-qty="${esc(id)}" inputmode="decimal" autocomplete="off" placeholder="${esc(HINT[unit])}"><small class="qty-preview">&nbsp;</small>`;
  const input = el.querySelector('input')!;
  const preview = el.querySelector<HTMLElement>('.qty-preview')!;
  const value = () => {
    const v = parseQuantity(input.value, unit);
    return v !== null && v > 0 ? v : null;
  };
  input.addEventListener('input', () => {
    const v = value();
    preview.textContent = input.value.trim() === '' ? ' ' : v === null ? 'anlaşılmadı' : `= ${FORMAT[unit](v)}`;
    preview.classList.toggle('bad', input.value.trim() !== '' && v === null);
    onChange();
  });
  return { el, value };
}
