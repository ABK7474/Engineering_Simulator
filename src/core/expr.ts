// İçerik JSON'undaki küçük aritmetik ifadeler için güvenli değerlendirici (eval yok).
// Desteklenen: sayılar, değişken adları, + − * /, parantez, tekli eksi.
// Örnek: "Vmeas*Rold/(Vs-Vmeas)"

export type Scope = Record<string, number>;

export function evaluate(src: string, scope: Scope): number {
  const tokens = src.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/()]|\S/g) ?? [];
  let k = 0;
  const peek = () => tokens[k];
  const take = () => tokens[k++];
  const fail = (msg: string): never => {
    throw new Error(`İfade hatası (${msg}): "${src}"`);
  };

  const primary = (): number => {
    const t = take();
    if (t === undefined) return fail('beklenmeyen son');
    if (t === '(') {
      const v = sum();
      if (take() !== ')') fail("')' eksik");
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (/^\d/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) {
      if (!(t in scope)) fail(`bilinmeyen ad '${t}'`);
      return scope[t];
    }
    return fail(`beklenmeyen '${t}'`);
  };
  const product = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') v = take() === '*' ? v * primary() : v / primary();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + product() : v - product();
    return v;
  };

  const v = sum();
  if (k !== tokens.length) fail(`fazla '${peek()}'`);
  return v;
}

/** İfadede geçen değişken adları (doğrulama için). */
export function namesIn(src: string): string[] {
  return [...new Set(src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])];
}
