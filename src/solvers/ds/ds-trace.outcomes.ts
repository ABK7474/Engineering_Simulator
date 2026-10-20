// Hata sonucu havuzu: cevabın türü sonucu belirler, rastgelelik yalnız havuz içinde.
// - yanlış satır (sağlam kaydın üstüne yazıldı) → bellek hatası: core_reboot (komşu) / core_crash (uzak; uzaklaştıkça olası)
// - doğru satır, eleman sayısı ya da değer yanlış → sınır hatası: sensor_misread
// - doğru satır, elemanlar doğru ama sıra ters → core_freeze (komutlar ters işlendi, panel donar)

import { weightedPick, type Rng } from '../../core/rng';
import type { Outcome, OutcomeKind } from '../../core/types';
import type { DsTraceProblem } from './ds-trace.generate';
import type { Kind } from './ir';
import type { TraceState } from './simulate';

export type TraceOutcomeKind = Extract<OutcomeKind, 'success' | 'core_reboot' | 'core_crash' | 'sensor_misread' | 'core_freeze'>;

export interface TraceAnswer {
  /** Seçilen izleme satırı (rows dizini, 0 tabanlı). */
  row: number;
  structs: Record<string, number[]>;
  /** Yalnız sayaç olmayan değişkenler. */
  vars: Record<string, number | null>;
}

export const ORDER_LABEL: Record<Kind, string> = { stack: 'tepe → dip', queue: 'baş → son', list: 'ilk → son' };
export const fmtList = (a: readonly number[]) => `[${a.join(', ')}]`;

/** Oyuncunun düzenleyebildiği değişkenler (sayaçlar hariç). */
export const editableVars = (p: DsTraceProblem) => p.columns.filter((c) => !c.counter).map((c) => c.name);

/** Cevabı doğru durumla karşılaştırır. */
export function compareState(p: DsTraceProblem, a: TraceAnswer, correct: TraceState) {
  const wrongCount: string[] = [];
  const wrongOrder: string[] = [];
  const wrongValues: string[] = [];
  for (const { name, kind } of p.structs) {
    const want = correct.structs[name];
    const got = a.structs[name] ?? [];
    if (JSON.stringify(want) === JSON.stringify(got)) continue;
    if (want.length !== got.length) wrongCount.push(`${name} ${want.length} eleman olmalı (girdiğin: ${got.length})`);
    else if (JSON.stringify([...want].sort((x, y) => x - y)) === JSON.stringify([...got].sort((x, y) => x - y)))
      wrongOrder.push(`${name} sırası ${fmtList(want)} olmalı (${ORDER_LABEL[kind]}), girdiğin ${fmtList(got)}`);
    else wrongValues.push(`${name} ${fmtList(want)} olmalı, girdiğin ${fmtList(got)}`);
  }
  for (const v of editableVars(p)) {
    const want = correct.vars[v] ?? null;
    const got = a.vars[v] ?? null;
    if (want !== got) wrongValues.push(`${v} ${want ?? '—'} olmalı (girdiğin: ${got ?? '—'})`);
  }
  return { wrongCount, wrongOrder, wrongValues, equal: !wrongCount.length && !wrongOrder.length && !wrongValues.length };
}

export function outcomePool(p: DsTraceProblem, a: TraceAnswer): { value: TraceOutcomeKind; weight: number }[] {
  if (a.row !== p.bad) {
    const d = Math.abs(a.row - p.bad);
    const crash = Math.min(1, (d - 1) / 3); // komşu satırda yalnız yeniden başlatma; uzaklaştıkça çökme
    return [
      { value: 'core_reboot', weight: 1 - crash },
      { value: 'core_crash', weight: crash },
    ];
  }
  const c = compareState(p, a, p.rows[p.bad].after);
  if (c.equal) return [{ value: 'success', weight: 1 }];
  if (c.wrongCount.length || c.wrongValues.length) return [{ value: 'sensor_misread', weight: 1 }];
  return [{ value: 'core_freeze', weight: 1 }];
}

export function resolveTraceOutcome(p: DsTraceProblem, a: TraceAnswer, rng: Rng): Outcome {
  if (!Number.isInteger(a.row) || a.row < 0 || a.row >= p.rows.length) throw new Error(`Geçersiz satır: ${a.row}`);
  const kind = weightedPick(rng, outcomePool(p, a));
  const bad = p.rows[p.bad];
  const at = (j: number) => `adım ${j + 1} (satır ${p.rows[j].line})`;
  const c = compareState(p, a, bad.after);
  const severity = kind === 'success' ? 0 : a.row !== p.bad ? Math.abs(a.row - p.bad) / 2 : 1;
  const base = { kind, severity, resistorOverheat: false };
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Kayıt düzeltildi, zamanlayıcı ayağa kalktı', explanation: `Bozuk olan ${at(p.bad)} idi ve doğru durumu girdin. Çekirdek görev sırasını yeniden kurdu.` };
    case 'core_reboot':
      return {
        ...base,
        headline: 'Yanlış kayıt düzeltildi, çekirdek yeniden başladı',
        explanation: `${cap(at(a.row))} sağlamdı; bozuk olan komşusu, ${at(p.bad)} idi. Sağlam kaydın üstüne yazılınca çekirdek tutarsızlığı fark edip yeniden başladı.`,
      };
    case 'core_crash':
      return {
        ...base,
        headline: 'Bellek bozuldu, AI çekirdeği çöktü',
        explanation: `${cap(at(a.row))} sağlamdı; üstüne yazılan durum çekirdeğin belleğini bozdu. Bozuk olan ${at(p.bad)} idi. Yaşam desteği bir süre korumasız kaldı.`,
      };
    case 'sensor_misread':
      return {
        ...base,
        headline: 'Kayıt yanlış düzeltildi, sensör yanlış okuyor',
        explanation: `Doğru adımı (${at(p.bad)}) buldun ama girdiğin durum yanlış: ${[...c.wrongCount, ...c.wrongValues, ...c.wrongOrder].join('; ')}. Sınır hatası: sensör tablosu kaymış okunuyor.`,
      };
    case 'core_freeze':
      return {
        ...base,
        headline: 'Sıra ters, zamanlayıcı dondu',
        explanation: `Doğru adımı (${at(p.bad)}) buldun ve elemanlar doğru, ama sıra yanlış: ${c.wrongOrder.join('; ')}. Komutlar ters sırada işlendi, panel dondu.`,
      };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
