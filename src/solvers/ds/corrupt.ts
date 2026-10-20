// Doğru izlemeden tek bir satırı klasik öğrenci hatalarıyla bozar. Bozulan satırın durumu, aynı deyimin
// yanlış anlaşılmış hâliyle hesaplanır (step + Variant); sonraki satırlar doğru izlemeden aynen kalır.

import { type Rng, shuffle } from '../../core/rng';
import { isCall, isLet, type CorruptionKind, type Kind } from './ir';
import { SimError, step, type TraceRow, type TraceState, type Variant } from './simulate';

export interface Corruption {
  kind: CorruptionKind;
  state: TraceState;
  /** Olay raporunda: bu satır nasıl bozulmuştu. */
  explanation: string;
}

export const sameState = (a: TraceState, b: TraceState): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Bu bozma türü bu satıra uygulanabilecek değişkeler ve açıklamaları. */
function variantsFor(kind: CorruptionKind, row: TraceRow, kinds: Record<string, Kind>, rng: Rng): { v: Variant; text: string }[] {
  const s = row.stmt;
  const where = `Satır ${row.line} (${row.text})`;
  const counterNames = Object.keys(row.counters);
  const mentions = (e: string | undefined) => counterNames.filter((c) => e !== undefined && new RegExp(`\\b${c}\\b`).test(e));
  switch (kind) {
    case 'order_confusion': {
      if (!isCall(s)) return [];
      const k = kinds[s.on];
      if (k === 'stack' && ['Push', 'Pop', 'Peek'].includes(s.call))
        return [{ v: { otherEnd: true }, text: `${where}: yığın kuyruk gibi işlenmiş — ${s.call === 'Push' ? 'eleman dibe eklenmiş' : 'eleman dipten alınmış'}. Yığında son giren ilk çıkar; Push ve Pop hep tepede çalışır.` }];
      if (k === 'queue' && ['Enqueue', 'Dequeue', 'Peek'].includes(s.call))
        return [{ v: { otherEnd: true }, text: `${where}: kuyruk yığın gibi işlenmiş — ${s.call === 'Enqueue' ? 'eleman başa eklenmiş' : 'eleman sondan alınmış'}. Kuyrukta ilk giren ilk çıkar; Enqueue sona ekler, Dequeue baştan alır.` }];
      return [];
    }
    case 'skip_effect': {
      if (isLet(s)) return [{ v: { staleVar: true }, text: `${where}: atama yapılmamış gibi; ${s.let} eski değerinde bırakılmış.` }];
      if (s.call === 'Peek') return s.into ? [{ v: { staleVar: true }, text: `${where}: Peek'in döndürdüğü değer ${s.into}'e yazılmamış.` }] : [];
      if (['Pop', 'Dequeue'].includes(s.call))
        return [{ v: { skipEffect: true }, text: `${where}: ${s.call} Peek ile karıştırılmış — değer okunmuş ama eleman yapıdan çıkarılmamış.` }];
      return [{ v: { skipEffect: true }, text: `${where}: işlemin yapıya etkisi atlanmış; ${s.on} değişmemiş gibi yazılmış.` }];
    }
    case 'off_by_one': {
      const out: { v: Variant; text: string }[] = [];
      const expr = isLet(s) ? s.value : s.arg;
      for (const c of mentions(expr))
        for (const delta of shuffle(rng, [-1, 1]))
          out.push({
            v: { counterShift: { name: c, delta } },
            text: `${where}: bir kayma (off-by-one) — ${c} = ${row.counters[c]} yerine ${row.counters[c] + delta} kullanılmış gibi hesaplanmış.`,
          });
      if (isCall(s) && s.call === 'AddAfter')
        for (const d of shuffle(rng, [-1, 1]))
          out.push({
            v: { afterShift: d },
            text: `${where}: bir kayma — yeni düğüm Find'ın bulduğu düğümün ${d < 0 ? 'önüne' : 'bir sonrakinin arkasına'} eklenmiş. AddAfter tam arkasına ekler.`,
          });
      return out;
    }
    case 'wrong_end': {
      if (!isCall(s) || !['AddFirst', 'AddLast', 'RemoveFirst', 'RemoveLast'].includes(s.call)) return [];
      const other = { AddFirst: 'AddLast', AddLast: 'AddFirst', RemoveFirst: 'RemoveLast', RemoveLast: 'RemoveFirst' }[s.call as 'AddFirst'];
      return [{ v: { swapEnds: true }, text: `${where}: ${s.call} yerine ${other} yapılmış gibi — listenin yanlış ucu.` }];
    }
  }
}

/**
 * Satırı verilen türle boz. Uygulanamıyorsa ya da sonuç doğru durumla aynıysa null.
 * `prev` bir önceki satırın (doğru) durumu.
 */
export function corruptRow(
  kind: CorruptionKind,
  row: TraceRow,
  prev: TraceState,
  kinds: Record<string, Kind>,
  params: Record<string, number>,
  rng: Rng,
): Corruption | null {
  for (const { v, text } of variantsFor(kind, row, kinds, rng)) {
    let state: TraceState;
    try {
      state = step(prev, row, kinds, params, v);
    } catch (e) {
      if (e instanceof SimError) continue; // ör. kayma boş yapıya denk geldi
      throw e;
    }
    if (!sameState(state, row.after)) return { kind, state, explanation: text };
  }
  return null;
}
