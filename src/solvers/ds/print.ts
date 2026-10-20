// IR → C# program metni. Satır numaraları buradan gelir; simülatör aynı deyim nesnelerini kullandığı için
// izlemedeki "Satır" sütunu metinle birebir eşleşir. Değişken kapsamı C# kurallarına göre denetlenir:
// bir değişken bildirildiği bloğun dışında kullanılırsa (C# derlemez) şablon reddedilir.
// `instrument` çıktısı her izlenen deyimden sonra durumu yazdırır (scripts/verify-cs.mjs, oyunda kullanılmaz).

import { isCall, isFor, isIf, isLet, isWhile, type CallStmt, type Cond, type Expr, type LetStmt, type Stmt, type StructDecl, type TraceTemplate } from './ir';

export class TemplateRejected extends Error {}

const CS_TYPE = { stack: 'Stack<int>', queue: 'Queue<int>', list: 'LinkedList<int>' } as const;

/** İfadeyi C# biçiminde yazar; parametreler sayıya dönüşür. */
export function formatExpr(e: Expr, params: Record<string, number>): string {
  const tokens = e.match(/\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/()]|\S/g) ?? [];
  let out = '';
  let prevValue = false;
  for (const t of tokens) {
    if ('+-*/'.includes(t) && t.length === 1) {
      out += prevValue ? ` ${t} ` : t;
      prevValue = false;
    } else if (t === '(') {
      out += '(';
      prevValue = false;
    } else if (t === ')') {
      out += ')';
      prevValue = true;
    } else {
      const v = t in params ? params[t] : undefined;
      out += v === undefined ? t : v < 0 ? `(${v})` : String(v);
      prevValue = true;
    }
  }
  return out;
}

export interface VarColumn {
  name: string;
  /** for döngüsü sayacı (zorlukla gizlenebilir; oyuncu düzenlemez). */
  counter: boolean;
}

export interface PrintedProgram {
  lines: string[];
  /** İzlenen deyim (çağrı ya da atama) → 1 tabanlı satır numarası. */
  lineOf: Map<Stmt, number>;
  /** Değişken sütunları, programda ilk bildirildikleri sırayla. */
  vars: VarColumn[];
  /** Deyim → o noktada görünen sayaç olmayan değişkenler (deyimden önce). */
  scopeAt: Map<Stmt, string[]>;
}

interface Line {
  depth: number;
  text: string;
  traced?: CallStmt | LetStmt;
  /** İzlenen satırda görünen döngü sayaçları. */
  counters?: string[];
}

export function callText(s: CallStmt, params: Record<string, number>): string {
  const arg = s.arg !== undefined ? formatExpr(s.arg, params) : '';
  const call =
    s.call === 'AddAfter' ? `${s.on}.AddAfter(${s.on}.Find(${formatExpr(s.after!, params)}), ${arg})` : `${s.on}.${s.call}(${arg})`;
  return call;
}

function condText(c: Cond, params: Record<string, number>): string {
  return 'count' in c ? `${c.count}.Count ${c.op} ${formatExpr(c.value, params)}` : `${c.var} % ${c.mod} == ${c.eq}`;
}

function initText(d: StructDecl, params: Record<string, number>): string {
  const items = d.init?.length ? `new[] { ${d.init.map((e) => formatExpr(e, params)).join(', ')} }` : '';
  return `var ${d.name} = new ${CS_TYPE[d.kind]}(${items});`;
}

/** Gövdeyi satırlara çevirir ve kapsamı denetler. */
function bodyLines(t: TraceTemplate, params: Record<string, number>) {
  const structs = new Set(t.structures.map((s) => s.name));
  const declared = new Set<string>(); // yöntem boyunca bir ad yalnız bir kez bildirilir (CS0136'ya karşı tutucu)
  const vars: VarColumn[] = [];
  const scopeAt = new Map<Stmt, string[]>();
  const out: Line[] = [];
  const reject = (msg: string): never => {
    throw new TemplateRejected(`şablon '${t.id}': ${msg}`);
  };

  const uses = (e: Expr, visible: string[], what: string) => {
    for (const n of e.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      if (n in params) continue;
      if (structs.has(n)) reject(`${what}: yapı adı ifadede kullanılamaz (${n})`);
      if (!visible.includes(n)) reject(`${what}: '${n}' bu noktada kapsam dışında ya da bildirilmemiş (C# derlemez)`);
    }
  };
  const declare = (name: string, visible: string[], counter: boolean) => {
    if (structs.has(name) || name in params) reject(`'${name}' adı yapı/parametreyle çakışıyor`);
    if (declared.has(name)) reject(`'${name}' daha önce bildirildi; kapsam dışından yeniden bildirmek yerine dışarıda bildirin`);
    declared.add(name);
    vars.push({ name, counter });
    visible.push(name);
  };

  const block = (body: Stmt[], depth: number, visible: string[], counters: string[]) => {
    const local = [...visible];
    for (const s of body) {
      const all = [...local, ...counters];
      if (isCall(s)) {
        if (s.arg !== undefined) uses(s.arg, all, `${s.on}.${s.call}`);
        if (s.after !== undefined) uses(s.after, all, `${s.on}.AddAfter`);
        scopeAt.set(s, [...local]);
        let text = `${callText(s, params)};`;
        if (s.into !== undefined) {
          if (counters.includes(s.into)) reject(`döngü sayacı '${s.into}' atanamaz`);
          if (local.includes(s.into)) text = `${s.into} = ${text}`;
          else {
            declare(s.into, local, false);
            text = `int ${s.into} = ${text}`;
          }
        }
        out.push({ depth, text, traced: s, counters: [...counters] });
      } else if (isLet(s)) {
        uses(s.value, all, `${s.let} ataması`);
        scopeAt.set(s, [...local]);
        if (counters.includes(s.let)) reject(`döngü sayacı '${s.let}' atanamaz`);
        let text = `${s.let} = ${formatExpr(s.value, params)};`;
        if (!local.includes(s.let)) {
          declare(s.let, local, false);
          text = `int ${text}`;
        }
        out.push({ depth, text, traced: s, counters: [...counters] });
      } else if (isFor(s)) {
        uses(s.from, all, 'for başı');
        uses(s.to, all, 'for sonu');
        const inner = [...counters];
        declare(s.for, inner, true); // sayaçlar görünen değişkenlerden ayrı listede
        out.push({ depth, text: `for (int ${s.for} = ${formatExpr(s.from, params)}; ${s.for} <= ${formatExpr(s.to, params)}; ${s.for}++)` });
        out.push({ depth, text: '{' });
        block(s.body, depth + 1, local, inner);
        out.push({ depth, text: '}' });
      } else if (isWhile(s)) {
        if ('var' in s.while && !all.includes(s.while.var)) reject(`while: '${s.while.var}' kapsam dışında`);
        if ('count' in s.while) uses(s.while.value, all, 'while koşulu');
        out.push({ depth, text: `while (${condText(s.while, params)})` });
        out.push({ depth, text: '{' });
        block(s.body, depth + 1, local, counters);
        out.push({ depth, text: '}' });
      } else if (isIf(s)) {
        if ('var' in s.if && !all.includes(s.if.var)) reject(`if: '${s.if.var}' kapsam dışında`);
        if ('count' in s.if) uses(s.if.value, all, 'if koşulu');
        out.push({ depth, text: `if (${condText(s.if, params)})` });
        out.push({ depth, text: '{' });
        block(s.then, depth + 1, local, counters);
        out.push({ depth, text: '}' });
        if (s.else) {
          out.push({ depth, text: 'else' });
          out.push({ depth, text: '{' });
          block(s.else, depth + 1, local, counters);
          out.push({ depth, text: '}' });
        }
      }
    }
  };
  block(t.body, 0, [], []);
  return { body: out, vars, scopeAt };
}

const pad = (depth: number) => '    '.repeat(depth);

/** Oyuncuya gösterilen program. */
export function printProgram(t: TraceTemplate, params: Record<string, number>): PrintedProgram {
  const { body, vars, scopeAt } = bodyLines(t, params);
  const lines = ['using System;', 'using System.Collections.Generic;', '', 'class Program', '{', '    static void Main()', '    {'];
  for (const d of t.structures) lines.push(pad(2) + initText(d, params));
  const lineOf = new Map<Stmt, number>();
  for (const l of body) {
    lines.push(pad(l.depth + 2) + l.text);
    if (l.traced) lineOf.set(l.traced, lines.length);
  }
  lines.push('    }', '}');
  return { lines, lineOf, vars, scopeAt };
}

/**
 * Enstrümanlı sürüm: her izlenen deyimden sonra `D.Row(satır, yapılar, değişkenler)` çağrılır.
 * Satır numarası oyuncunun gördüğü programdakidir. Yapılar C# numaralandırma sırasıyla yazılır
 * (Stack: tepe → dip, Queue: baş → son, LinkedList: ilk → son); bu, tablodaki gösterim sırasıyla aynıdır.
 */
export function printInstrumented(t: TraceTemplate, params: Record<string, number>, className: string): string {
  const shown = printProgram(t, params);
  const { body, scopeAt } = bodyLines(t, params);
  const structs = t.structures.map((d) => `"${d.name}=" + string.Join(",", ${d.name})`).join(' + "|" + ');
  const out = [`static class ${className}`, '{', '    public static void Run()', '    {'];
  for (const d of t.structures) out.push(pad(2) + initText(d, params));
  // Sayaçlar dahil görünen değişkenler, sütun sırasıyla
  const visibleAfter = (s: CallStmt | LetStmt, counters: string[]) => {
    const vis = new Set([...(scopeAt.get(s) ?? []), ...counters]);
    if (isCall(s) && s.into) vis.add(s.into);
    if (isLet(s)) vis.add(s.let);
    return shown.vars.filter((v) => vis.has(v.name)).map((v) => v.name);
  };
  for (const l of body) {
    out.push(pad(l.depth + 2) + l.text);
    if (l.traced) {
      const names = visibleAfter(l.traced, l.counters ?? []);
      const vars = names.length ? names.map((n) => `"${n}=" + ${n}`).join(' + "|" + ') : '""';
      out.push(pad(l.depth + 2) + `D.Row(${shown.lineOf.get(l.traced)}, ${structs}, ${vars});`);
    }
  }
  out.push('    }', '}');
  return out.join('\n');
}
