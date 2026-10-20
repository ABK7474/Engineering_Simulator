// Veri yapıları izleme (trace) türünün ara gösterimi (IR): küçük, kapalı bir C# alt kümesi.
// Program metni (print.ts) ve doğru izleme (simulate.ts) aynı IR'den üretilir; ikisi birebir eşleşir.
// Sınırlama: gerçek derleyici yok. Davranış, C#'taki Stack<int>, Queue<int>, LinkedList<int> sınıflarının
// belgelenmiş davranışının TypeScript taklidi. Yerel çalıştırıcı gelince scripts/verify-cs.mjs aynı IR'den
// enstrümanlı C# üretip derleyerek karşılaştırır.

import { namesIn } from '../../core/expr';

export type Kind = 'stack' | 'queue' | 'list';
/** İfade: + − * / ve parantez (src/core/expr.ts). Parametre adları metinde sayıyla değiştirilir. */
export type Expr = string;

export type Method =
  | 'Push'
  | 'Pop'
  | 'Peek'
  | 'Enqueue'
  | 'Dequeue'
  | 'AddFirst'
  | 'AddLast'
  | 'RemoveFirst'
  | 'RemoveLast'
  | 'AddAfter'
  | 'Remove';

export type CmpOp = '>' | '>=' | '<' | '<=' | '==' | '!=';
export type Cond = { count: string; op: CmpOp; value: Expr } | { var: string; mod: number; eq: number };

export interface CallStmt {
  call: Method;
  on: string;
  arg?: Expr;
  /** Dönen değer bu değişkene atanır (Pop, Peek, Dequeue). İlk atamada `int x = ...` bildirimi olur. */
  into?: string;
  /** AddAfter: list.AddAfter(list.Find(after), arg). */
  after?: Expr;
}
export interface LetStmt {
  let: string;
  value: Expr;
}
export interface ForStmt {
  for: string;
  from: Expr;
  to: Expr;
  body: Stmt[];
}
export interface WhileStmt {
  while: Cond;
  body: Stmt[];
}
export interface IfStmt {
  if: Cond;
  then: Stmt[];
  else?: Stmt[];
}
export type Stmt = CallStmt | LetStmt | ForStmt | WhileStmt | IfStmt;

export interface StructDecl {
  name: string;
  kind: Kind;
  /** Başlangıç içeriği: C#'ta `new Stack<int>(new[] { ... })`. Yığında son eleman tepeye gelir. */
  init?: Expr[];
}

export interface TraceTemplate {
  id: string;
  /** Hikâyedeki karşılığı (panelde programın üstünde). */
  story: string;
  structures: StructDecl[];
  /** Parametre adı → seçilebilir tamsayı değerleri. */
  params: Record<string, number[]>;
  body: Stmt[];
}

export type CorruptionKind = 'order_confusion' | 'skip_effect' | 'off_by_one' | 'wrong_end';
export const CORRUPTION_KINDS: readonly CorruptionKind[] = ['order_confusion', 'skip_effect', 'off_by_one', 'wrong_end'];

export interface DsTraceConfig {
  /** İzleme satırı sayısı aralığı (işlem sayısı). */
  ops: [number, number];
  /** Program satır sayısı aralığı. */
  lines: [number, number];
  structures: Kind[];
  corruptions: CorruptionKind[];
  /** Döngü sayaçlarını (i gibi) tabloda gizle. */
  hideCounters: boolean;
  templates: TraceTemplate[];
}

export const METHODS: Record<Kind, readonly Method[]> = {
  stack: ['Push', 'Pop', 'Peek'],
  queue: ['Enqueue', 'Dequeue', 'Peek'],
  list: ['AddFirst', 'AddLast', 'RemoveFirst', 'RemoveLast', 'AddAfter', 'Remove'],
};
/** Değer döndüren (int) yöntemler: `into` yalnız bunlarda. */
export const RETURNS_VALUE: readonly Method[] = ['Pop', 'Peek', 'Dequeue'];
/** Argüman alan yöntemler. */
export const TAKES_ARG: readonly Method[] = ['Push', 'Enqueue', 'AddFirst', 'AddLast', 'AddAfter', 'Remove'];

export const isCall = (s: Stmt): s is CallStmt => 'call' in s;
export const isLet = (s: Stmt): s is LetStmt => 'let' in s;
export const isFor = (s: Stmt): s is ForStmt => 'for' in s;
export const isWhile = (s: Stmt): s is WhileStmt => 'while' in s;
export const isIf = (s: Stmt): s is IfStmt => 'if' in s;

const NAME = /^[a-z][A-Za-z0-9]*$/;
const PARAM = /^[A-Z][A-Za-z0-9]*$/;
const RESERVED = new Set(['int', 'var', 'new', 'for', 'while', 'if', 'else', 'class', 'static', 'void', 'using', 'null', 'true', 'false']);

/** Aşama yapılandırmasını doğrular; açıklamalı hata verir. */
export function parseDsTraceConfig(raw: unknown): DsTraceConfig {
  const errors: string[] = [];
  const need = (ok: unknown, msg: string) => {
    if (!ok) errors.push(msg);
    return Boolean(ok);
  };
  const c = raw as Partial<DsTraceConfig> | null;
  if (!c || typeof c !== 'object') throw new Error('ds-trace yapılandırması nesne olmalı');
  const range = (r: unknown, what: string, lo: number, hi: number) =>
    need(
      Array.isArray(r) && r.length === 2 && r.every((x) => Number.isInteger(x)) && lo <= r[0] && r[0] <= r[1] && r[1] <= hi,
      `${what} [min, max] olmalı (${lo}–${hi})`,
    );
  range(c.ops, 'ops', 3, 40);
  if (c.lines === undefined) c.lines = [15, 25];
  range(c.lines, 'lines', 8, 40);
  need(Array.isArray(c.structures) && c.structures.length > 0 && c.structures.every((k) => k in METHODS), 'structures: stack/queue/list listesi olmalı');
  need(
    Array.isArray(c.corruptions) && c.corruptions.length > 0 && c.corruptions.every((k) => CORRUPTION_KINDS.includes(k)),
    `corruptions: ${CORRUPTION_KINDS.join('/')} listesi olmalı`,
  );
  if (c.hideCounters === undefined) c.hideCounters = false;
  need(typeof c.hideCounters === 'boolean', 'hideCounters true/false olmalı');
  need(Array.isArray(c.templates) && c.templates.length > 0, 'templates boş olamaz');
  const ids = new Set<string>();
  for (const t of c.templates ?? []) {
    const where = `şablon '${t?.id}'`;
    if (!need(t && typeof t.id === 'string' && !ids.has(t.id), `şablon kimliği eksik ya da yinelenmiş: ${t?.id}`)) continue;
    ids.add(t.id);
    need(typeof t.story === 'string', `${where}: story eksik`);
    need(Array.isArray(t.structures) && t.structures.length > 0, `${where}: structures boş`);
    const structs = new Map<string, Kind>();
    for (const s of t.structures ?? []) {
      if (!need(NAME.test(s?.name) && !RESERVED.has(s.name) && s.kind in METHODS, `${where}: geçersiz yapı ${JSON.stringify(s)}`)) continue;
      need(!structs.has(s.name), `${where}: yapı adı yinelenmiş '${s.name}'`);
      structs.set(s.name, s.kind);
      need(s.init === undefined || (Array.isArray(s.init) && s.init.every((e) => typeof e === 'string')), `${where}: ${s.name}.init ifade listesi olmalı`);
    }
    const params = t.params ?? {};
    for (const [k, v] of Object.entries(params)) {
      need(PARAM.test(k), `${where}: parametre adı büyük harfle başlamalı '${k}'`);
      need(Array.isArray(v) && v.length > 0 && v.every((x) => Number.isInteger(x)), `${where}: parametre '${k}' tamsayı listesi olmalı`);
    }
    const checkExpr = (e: unknown, what: string) => {
      if (!need(typeof e === 'string' && e.length > 0, `${where}: ${what} ifadesi eksik`)) return;
      try {
        for (const n of namesIn(e as string)) need(PARAM.test(n) ? n in params : NAME.test(n), `${where}: ${what} içinde bilinmeyen parametre '${n}'`);
      } catch (err) {
        errors.push(`${where}: ${what}: ${(err as Error).message}`);
      }
    };
    for (const s of t.structures ?? []) for (const e of s.init ?? []) checkExpr(e, `${s.name}.init`);
    const checkCond = (cd: Cond | undefined, what: string) => {
      if (!need(cd && typeof cd === 'object', `${where}: ${what} koşulu eksik`)) return;
      if ('count' in cd!) {
        need(structs.has(cd.count), `${where}: ${what}: bilinmeyen yapı '${cd.count}'`);
        need(['>', '>=', '<', '<=', '==', '!='].includes(cd.op), `${where}: ${what}: geçersiz karşılaştırma '${cd.op}'`);
        checkExpr(cd.value, what);
      } else {
        need(NAME.test(cd!.var) && Number.isInteger(cd!.mod) && cd!.mod > 1 && Number.isInteger(cd!.eq), `${where}: ${what}: { var, mod, eq } olmalı`);
      }
    };
    const walk = (body: Stmt[] | undefined, what: string) => {
      if (!need(Array.isArray(body) && body.length > 0, `${where}: ${what} boş`)) return;
      for (const s of body!) {
        if (isCall(s)) {
          const kind = structs.get(s.on);
          if (!need(kind, `${where}: bilinmeyen yapı '${s.on}'`)) continue;
          need(METHODS[kind!].includes(s.call), `${where}: ${kind} için '${s.call}' yok`);
          if (TAKES_ARG.includes(s.call)) checkExpr(s.arg, `${s.on}.${s.call}`);
          else need(s.arg === undefined, `${where}: ${s.on}.${s.call} argüman almaz`);
          if (s.call === 'AddAfter') checkExpr(s.after, `${s.on}.AddAfter (Find)`);
          else need(s.after === undefined, `${where}: 'after' yalnız AddAfter'da`);
          need(s.into === undefined || (RETURNS_VALUE.includes(s.call) && NAME.test(s.into) && !RESERVED.has(s.into)), `${where}: ${s.on}.${s.call} sonucu değişkene atanamaz`);
        } else if (isLet(s)) {
          need(NAME.test(s.let) && !RESERVED.has(s.let), `${where}: geçersiz değişken adı '${s.let}'`);
          checkExpr(s.value, `${s.let} ataması`);
        } else if (isFor(s)) {
          need(NAME.test(s.for) && !RESERVED.has(s.for), `${where}: geçersiz sayaç adı '${s.for}'`);
          checkExpr(s.from, 'for başı');
          checkExpr(s.to, 'for sonu');
          walk(s.body, `for (${s.for}) gövdesi`);
        } else if (isWhile(s)) {
          checkCond(s.while, 'while');
          walk(s.body, 'while gövdesi');
        } else if (isIf(s)) {
          checkCond(s.if, 'if');
          walk(s.then, 'if gövdesi');
          if (s.else !== undefined) walk(s.else, 'else gövdesi');
        } else {
          errors.push(`${where}: tanınmayan deyim ${JSON.stringify(s)}`);
        }
      }
    };
    walk(t.body, 'gövde');
  }
  if (errors.length) throw new Error(`ds-trace yapılandırması geçersiz:\n- ${errors.join('\n- ')}`);
  return c as DsTraceConfig;
}
