// Deterministik izleme simülatörü: IR'yi parametrelerle yürütür, yapıyı değiştiren ya da değişken atayan
// her deyim için bir izleme satırı üretir. Gerçek derleyici değildir (bkz. ir.ts); C# koleksiyonlarının
// belgelenmiş davranışını taklit eder:
// - Stack<int>: Push tepeye, Pop/Peek tepeden; boşsa InvalidOperationException.
// - Queue<int>: Enqueue sona, Dequeue/Peek baştan; boşsa InvalidOperationException.
// - LinkedList<int>: Find ve Remove(değer) İLK eşleşmeyi bulur; Find bulamazsa null döner ve
//   AddAfter(null, …) ArgumentNullException atar; Remove(değer) bulamazsa false döner, liste değişmez.
// İstisna atan, tamsayı dışına çıkan ya da sonsuz döngüye giren şablon havuza girmez (SimError).

import { evaluate } from '../../core/expr';
import { isCall, isFor, isIf, isLet, isWhile, type CallStmt, type Cond, type Kind, type LetStmt, type Stmt, type TraceTemplate } from './ir';
import { printProgram, type PrintedProgram } from './print';

export class SimError extends Error {}

/** Gösterim sırası: yığın tepe → dip, kuyruk baş → son, liste ilk → son. */
export interface TraceState {
  structs: Record<string, number[]>;
  /** Kapsam dışındaki ya da henüz bildirilmemiş değişken null. Sayaçlar dahil. */
  vars: Record<string, number | null>;
}

export interface TraceRow {
  stmt: CallStmt | LetStmt;
  /** Programdaki satır (1 tabanlı). */
  line: number;
  /** Deyimin kod metni. */
  text: string;
  /** Deyim çalışırken döngü sayaçlarının değerleri (kontrol akışı; bozulmaz). */
  counters: Record<string, number>;
  /** Deyimden önce görünen, sayaç olmayan değişkenler. */
  scope: string[];
  after: TraceState;
}

export interface Trace {
  program: PrintedProgram;
  kinds: Record<string, Kind>;
  initial: TraceState;
  rows: TraceRow[];
}

/** Doğru izlemeyi üreten taraf. Bugün tek uygulama TS simülatörü; ileride derleyiciyle çalışan bir uygulama eklenebilir. */
export interface TraceOracle {
  run(t: TraceTemplate, params: Record<string, number>): Trace;
}

const MAX_STEPS = 200;
const MAX_ABS = 100_000;

export function num(e: string, env: Record<string, number>): number {
  let v: number;
  try {
    v = evaluate(e, env);
  } catch (err) {
    throw new SimError((err as Error).message);
  }
  if (!Number.isInteger(v)) throw new SimError(`'${e}' tamsayı değil (${v}); C# tamsayı bölmesi taklit edilmez`);
  if (Math.abs(v) > MAX_ABS) throw new SimError(`'${e}' çok büyük (${v})`);
  return v;
}

/** Deyimin değerlendirilmesi için ortam: parametreler + sayaçlar + kapsamdaki değişkenler (önceki satırdan). */
function envFor(prev: TraceState, row: Pick<TraceRow, 'counters' | 'scope'>, params: Record<string, number>): Record<string, number> {
  const env: Record<string, number> = { ...params, ...row.counters };
  for (const v of row.scope) {
    const x = prev.vars[v];
    if (x === null || x === undefined) throw new SimError(`'${v}' değer almadan kullanıldı`);
    env[v] = x;
  }
  return env;
}

/** Bozma türlerinin (corrupt.ts) yapı işlemini değiştirmesi için seçenekler. Doğru izleme hepsi kapalıyken. */
export interface Variant {
  /** Yığın↔kuyruk karışması: ekleme/çıkarma yanlış uçtan. */
  otherEnd?: boolean;
  /** İşlemin yapı üzerindeki etkisi atlanır (değer yine okunur). */
  skipEffect?: boolean;
  /** Atanan değişken güncellenmez. */
  staleVar?: boolean;
  /** AddFirst↔AddLast, RemoveFirst↔RemoveLast. */
  swapEnds?: boolean;
  /** Argümanı bu sayaç kaymasıyla değerlendir (i yerine i±1). */
  counterShift?: { name: string; delta: number };
  /** AddAfter: bulunan düğümden bu kadar kaymış konuma ekle. */
  afterShift?: number;
}

/** Tek bir izleme satırının sonucu, bir önceki satırdan. Hem simülatör hem doğrulayıcı bunu kullanır. */
export function step(
  prev: TraceState,
  row: Pick<TraceRow, 'stmt' | 'counters' | 'scope'>,
  kinds: Record<string, Kind>,
  params: Record<string, number>,
  variant: Variant = {},
): TraceState {
  const env = envFor(prev, row, params);
  const argEnv = variant.counterShift ? { ...env, [variant.counterShift.name]: env[variant.counterShift.name] + variant.counterShift.delta } : env;
  const structs: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(prev.structs)) structs[k] = [...v];
  const vars: Record<string, number | null> = {};
  for (const k of Object.keys(prev.vars)) vars[k] = null;
  for (const v of row.scope) vars[v] = prev.vars[v];
  for (const [k, v] of Object.entries(row.counters)) vars[k] = v;

  const s = row.stmt;
  let assigned: { name: string; value: number } | null = null;
  if (isLet(s)) {
    assigned = { name: s.let, value: num(s.value, argEnv) };
  } else {
    const a = structs[s.on];
    const kind = kinds[s.on];
    const empty = () => {
      if (a.length === 0) throw new SimError(`${s.on}.${s.call}() boş yapıda: InvalidOperationException`);
    };
    const arg = s.arg !== undefined ? num(s.arg, argEnv) : 0;
    const flip = Boolean(variant.otherEnd);
    const apply = !variant.skipEffect;
    switch (s.call) {
      case 'Push': // tepe = baş
        if (apply) flip ? a.push(arg) : a.unshift(arg);
        break;
      case 'Enqueue':
        if (apply) flip ? a.unshift(arg) : a.push(arg);
        break;
      case 'Pop':
      case 'Dequeue':
      case 'Peek': {
        empty();
        const fromBack = kind === 'stack' || kind === 'queue' ? flip : false;
        const value = fromBack ? a[a.length - 1] : a[0];
        if (s.call !== 'Peek' && apply) fromBack ? a.pop() : a.shift();
        if (s.into) assigned = { name: s.into, value };
        break;
      }
      case 'AddFirst':
      case 'AddLast': {
        const first = (s.call === 'AddFirst') !== Boolean(variant.swapEnds);
        if (apply) first ? a.unshift(arg) : a.push(arg);
        break;
      }
      case 'RemoveFirst':
      case 'RemoveLast': {
        empty();
        const first = (s.call === 'RemoveFirst') !== Boolean(variant.swapEnds);
        if (apply) first ? a.shift() : a.pop();
        break;
      }
      case 'AddAfter': {
        const key = num(s.after!, env);
        const idx = a.indexOf(key); // Find: ilk eşleşme
        if (idx < 0) throw new SimError(`${s.on}.Find(${key}) null döndü: AddAfter(null, …) ArgumentNullException`);
        const at = Math.min(a.length, Math.max(0, idx + 1 + (variant.afterShift ?? 0)));
        if (apply) a.splice(at, 0, arg);
        break;
      }
      case 'Remove': {
        const idx = a.indexOf(arg); // ilk eşleşme; yoksa false döner, liste değişmez
        if (idx >= 0 && apply) a.splice(idx, 1);
        break;
      }
    }
  }
  if (assigned) {
    if (Math.abs(assigned.value) > MAX_ABS) throw new SimError(`${assigned.name} çok büyük`);
    vars[assigned.name] = variant.staleVar ? (prev.vars[assigned.name] ?? null) : assigned.value;
  }
  return { structs, vars };
}

function holds(c: Cond, state: TraceState, env: Record<string, number>): boolean {
  if ('count' in c) {
    const n = state.structs[c.count].length;
    const v = num(c.value, env);
    switch (c.op) {
      case '>':
        return n > v;
      case '>=':
        return n >= v;
      case '<':
        return n < v;
      case '<=':
        return n <= v;
      case '==':
        return n === v;
      case '!=':
        return n !== v;
    }
  }
  const x = env[c.var];
  if (x === undefined) throw new SimError(`'${c.var}' kapsam dışında`);
  return x % c.mod === c.eq; // JS % de C# gibi kesip atar: -3 % 2 == -1
}

/** Yapıların başlangıç durumu: init C#'taki kurucu sırasıyla (Stack: son eleman tepede). */
export function initialState(t: TraceTemplate, params: Record<string, number>, varNames: string[]): TraceState {
  const structs: Record<string, number[]> = {};
  for (const d of t.structures) {
    const vals = (d.init ?? []).map((e) => num(e, params));
    structs[d.name] = d.kind === 'stack' ? vals.reverse() : vals;
  }
  return { structs, vars: Object.fromEntries(varNames.map((n) => [n, null])) };
}

export function simulate(t: TraceTemplate, params: Record<string, number>): Trace {
  const program = printProgram(t, params);
  const kinds = Object.fromEntries(t.structures.map((d) => [d.name, d.kind]));
  const initial = initialState(t, params, program.vars.map((v) => v.name));
  const rows: TraceRow[] = [];
  let state = initial;
  let steps = 0;

  const envNow = (scope: string[], counters: Record<string, number>) => envFor(state, { scope, counters }, params);
  const exec = (body: Stmt[], scope: string[], counters: Record<string, number>) => {
    const local = [...scope];
    for (const s of body) {
      if (++steps > MAX_STEPS) throw new SimError(`${MAX_STEPS} adımı aştı (sonsuz döngü?)`);
      if (isCall(s) || isLet(s)) {
        const row = { stmt: s, counters: { ...counters }, scope: [...local] };
        const after = step(state, row, kinds, params);
        const line = program.lineOf.get(s)!;
        rows.push({ ...row, line, text: program.lines[line - 1].trim().replace(/;$/, ''), after });
        state = after;
        const target = isLet(s) ? s.let : s.into;
        if (target && !local.includes(target)) local.push(target);
      } else if (isFor(s)) {
        // C# gibi: koşul (i <= son) her turda yeniden değerlendirilir
        const from = num(s.from, envNow(local, counters));
        for (let i = from; i <= num(s.to, envNow(local, { ...counters, [s.for]: i })); i++) {
          if (++steps > MAX_STEPS) throw new SimError(`${MAX_STEPS} adımı aştı`);
          exec(s.body, local, { ...counters, [s.for]: i });
        }
      } else if (isWhile(s)) {
        while (holds(s.while, state, envNow(local, counters))) {
          if (++steps > MAX_STEPS) throw new SimError(`${MAX_STEPS} adımı aştı (sonsuz döngü)`);
          exec(s.body, local, counters);
        }
      } else if (isIf(s)) {
        if (holds(s.if, state, envNow(local, counters))) exec(s.then, local, counters);
        else if (s.else) exec(s.else, local, counters);
      }
    }
  };
  exec(t.body, [], {});
  return { program, kinds, initial, rows };
}

export const simulatorOracle: TraceOracle = { run: simulate };
