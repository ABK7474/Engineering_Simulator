// Bağımsız ikinci yürütücü (çapraz kontrol): simulate.ts'teki step()'i kullanmaz, yapıları farklı
// temsil eder (yığının tepesi dizinin SONUNDA). Aynı IR'den aynı izlemeyi bulmalı; bulamazsa doğrulayıcı
// şablonu reddeder. Bağlı listede Find/Remove ilk eşleşme; Find bulamazsa null, AddAfter(null) istisna.

import { evaluate } from '../../core/expr';
import { isCall, isFor, isIf, isLet, isWhile, type Cond, type Stmt, type TraceTemplate } from './ir';
import { printProgram } from './print';

export interface RefRow {
  line: number;
  /** Gösterim sırasıyla (yığın tepe → dip, kuyruk baş → son, liste ilk → son). */
  structs: Record<string, number[]>;
  /** Yalnız görünen değişkenler (sayaçlar dahil). */
  vars: Record<string, number>;
}

class RefError extends Error {}

export function referenceRun(t: TraceTemplate, params: Record<string, number>): RefRow[] {
  const { lineOf } = printProgram(t, params);
  const kind: Record<string, string> = {};
  const data: Record<string, number[]> = {};
  const calc = (e: string, env: Map<string, number>) => {
    const scope: Record<string, number> = { ...params };
    env.forEach((v, k) => (scope[k] = v));
    const v = evaluate(e, scope);
    if (Math.trunc(v) !== v) throw new RefError('tamsayı değil');
    return v;
  };
  for (const d of t.structures) {
    kind[d.name] = d.kind;
    data[d.name] = (d.init ?? []).map((e) => calc(e, new Map())); // yığında da kurucu sırası: son eleman tepe (sonda)
  }
  const shown = (name: string) => (kind[name] === 'stack' ? [...data[name]].reverse() : [...data[name]]);
  const rows: RefRow[] = [];
  let budget = 200;

  const test = (c: Cond, env: Map<string, number>) => {
    if ('var' in c) return env.get(c.var)! % c.mod === c.eq;
    const n = data[c.count].length;
    const v = calc(c.value, env);
    return { '>': n > v, '>=': n >= v, '<': n < v, '<=': n <= v, '==': n === v, '!=': n !== v }[c.op];
  };
  const run = (body: Stmt[], outer: Map<string, number>) => {
    const env = new Map(outer); // blok kapsamı: bloktan çıkınca içeride bildirilenler kaybolur
    const writeBack = () => outer.forEach((_, k) => outer.set(k, env.get(k)!));
    for (const s of body) {
      if (--budget < 0) throw new RefError('adım bütçesi aşıldı');
      if (isCall(s)) {
        const d = data[s.on];
        const k = kind[s.on];
        let out: number | undefined;
        const need = () => {
          if (d.length === 0) throw new RefError('boş yapı');
        };
        switch (s.call) {
          case 'Push':
            d.push(calc(s.arg!, env));
            break;
          case 'Pop':
            need();
            out = d.pop();
            break;
          case 'Peek':
            need();
            out = k === 'stack' ? d[d.length - 1] : d[0];
            break;
          case 'Enqueue':
          case 'AddLast':
            d.push(calc(s.arg!, env));
            break;
          case 'Dequeue':
          case 'RemoveFirst':
            need();
            out = d.shift();
            break;
          case 'AddFirst':
            d.unshift(calc(s.arg!, env));
            break;
          case 'RemoveLast':
            need();
            d.pop();
            break;
          case 'AddAfter': {
            const key = calc(s.after!, env);
            let at = -1;
            for (let i = 0; i < d.length && at < 0; i++) if (d[i] === key) at = i;
            if (at < 0) throw new RefError('Find null');
            d.splice(at + 1, 0, calc(s.arg!, env));
            break;
          }
          case 'Remove': {
            const v = calc(s.arg!, env);
            for (let i = 0; i < d.length; i++)
              if (d[i] === v) {
                d.splice(i, 1);
                break;
              }
            break;
          }
        }
        if (s.into) env.set(s.into, out!);
        rows.push({ line: lineOf.get(s)!, structs: Object.fromEntries(Object.keys(data).map((n) => [n, shown(n)])), vars: Object.fromEntries(env) });
      } else if (isLet(s)) {
        env.set(s.let, calc(s.value, env));
        rows.push({ line: lineOf.get(s)!, structs: Object.fromEntries(Object.keys(data).map((n) => [n, shown(n)])), vars: Object.fromEntries(env) });
      } else if (isFor(s)) {
        for (let i = calc(s.from, env); ; i++) {
          const inner = new Map(env);
          inner.set(s.for, i);
          if (!(i <= calc(s.to, inner))) break;
          run(s.body, inner);
          env.forEach((_, k) => env.set(k, inner.get(k)!));
        }
      } else if (isWhile(s)) {
        while (test(s.while, env)) {
          if (--budget < 0) throw new RefError('sonsuz döngü');
          run(s.body, env);
        }
      } else if (isIf(s)) {
        if (test(s.if, env)) run(s.then, env);
        else if (s.else) run(s.else, env);
      }
    }
    writeBack();
  };
  run(t.body, new Map());
  return rows;
}
