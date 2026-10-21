// Kesin kesirli aritmetik (BigInt). Yüzdelerle verilen olasılıklardan Bayes ve binom hesapları yuvarlamasız.

export class Frac {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error('Kesir: payda sıfır');
    const s = d < 0n ? -1n : 1n;
    const g = gcd(n < 0n ? -n : n, d < 0n ? -d : d) || 1n;
    this.n = (s * n) / g;
    this.d = (s * d) / g;
  }
  /** Ondalık metinden (ör. "0.125", "12.5") kesin kesir. */
  static parse(x: number | string): Frac {
    const t = String(x);
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
    if (!m) throw new Error(`Kesir: sayı değil '${t}'`);
    const frac = m[3] ?? '';
    const n = BigInt(m[2] + frac) * (m[1] ? -1n : 1n);
    return new Frac(n, 10n ** BigInt(frac.length));
  }
  /** Yüzde (ör. 2.5 → 1/40). */
  static pct(p: number): Frac {
    return Frac.parse(p).div(new Frac(100n));
  }
  static readonly ZERO = new Frac(0n);
  static readonly ONE = new Frac(1n);
  add(o: Frac): Frac {
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Frac): Frac {
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Frac): Frac {
    return new Frac(this.n * o.n, this.d * o.d);
  }
  div(o: Frac): Frac {
    return new Frac(this.n * o.d, this.d * o.n);
  }
  pow(k: number): Frac {
    let r = Frac.ONE;
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }
  cmp(o: Frac): number {
    const x = this.n * o.d - o.n * this.d;
    return x < 0n ? -1 : x > 0n ? 1 : 0;
  }
  toNumber(): number {
    // Büyük pay/paydada taşmayı önlemek için ölçekli bölme
    const scale = 10n ** 18n;
    return Number((this.n * scale) / this.d) / 1e18;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Binom katsayısı C(n, k). */
export function choose(n: number, k: number): bigint {
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}
