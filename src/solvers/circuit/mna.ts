// Genel doğrusal DC devre çözücü: Modified Nodal Analysis (MNA).
// Topolojiden bağımsızdır; yeni devre = yeni netlist, çözücüye dokunulmaz.
//
// İşaret kuralları:
// - Her elemanın akımı a → b yönünde, eleman içinden geçen akımdır.
//   Gerilim kaynağında a = (+) uç; kaynak güç verirken akımı negatiftir.
// - Akım kaynağı `amps` akımını a'dan çekip b'ye basar (SPICE: I n+ n−).
// - Güç = (V(a) − V(b)) · akım: pozitif = harcanan, negatif = verilen.
// - İdeal op-amp (OA): a = (+) giriş, b = (−) giriş, out = çıkış (toprağa göre). Girişler akım çekmez,
//   geri besleme varken V(+) = V(−); çıkış akımı ek bilinmeyendir (op-amp'ten düğüme akan). Ray
//   (besleme) sınırı burada yok; kırpma sonuç sınıflandırmasında kontrol edilir.

export const GROUND = '0';

export type Element =
  | { id: string; kind: 'R'; a: string; b: string; ohms: number }
  | { id: string; kind: 'V'; a: string; b: string; volts: number }
  | { id: string; kind: 'I'; a: string; b: string; amps: number }
  | { id: string; kind: 'OA'; a: string; b: string; out: string };

export interface DcSolution {
  voltage: Record<string, number>;
  current: Record<string, number>;
  power: Record<string, number>;
}

export function solveDC(elements: readonly Element[]): DcSolution {
  validate(elements);
  const nodes = [...new Set(elements.flatMap((e) => (e.kind === 'OA' ? [e.a, e.b, e.out] : [e.a, e.b])))].filter((n) => n !== GROUND);
  const floating = unreachableFromGround(elements, nodes);
  if (floating.length) throw new Error(`Devre çözülemez: ${floating.map((n) => `'${n}'`).join(', ')} düğümünün toprağa yolu yok.`);

  const index = new Map(nodes.map((n, k) => [n, k]));
  const sources = elements.filter((e): e is Extract<Element, { kind: 'V' }> => e.kind === 'V');
  const opamps = elements.filter((e): e is Extract<Element, { kind: 'OA' }> => e.kind === 'OA');
  const size = nodes.length + sources.length + opamps.length;
  const A = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const z = new Array<number>(size).fill(0);
  const at = (n: string) => index.get(n); // toprak → undefined

  for (const e of elements) {
    const a = at(e.a);
    const b = at(e.b);
    if (e.kind === 'R') {
      const g = 1 / e.ohms;
      if (a !== undefined) A[a][a] += g;
      if (b !== undefined) A[b][b] += g;
      if (a !== undefined && b !== undefined) {
        A[a][b] -= g;
        A[b][a] -= g;
      }
    } else if (e.kind === 'I') {
      if (a !== undefined) z[a] -= e.amps;
      if (b !== undefined) z[b] += e.amps;
    }
  }
  sources.forEach((s, k) => {
    const row = nodes.length + k;
    const a = at(s.a);
    const b = at(s.b);
    if (a !== undefined) {
      A[a][row] += 1;
      A[row][a] += 1;
    }
    if (b !== undefined) {
      A[b][row] -= 1;
      A[row][b] -= 1;
    }
    z[row] = s.volts;
  });
  opamps.forEach((o, k) => {
    const row = nodes.length + sources.length + k;
    const out = at(o.out);
    if (out !== undefined) A[out][row] -= 1; // çıkış akımı düğüme girer
    const p = at(o.a);
    const n = at(o.b);
    if (p !== undefined) A[row][p] += 1; // V(+) − V(−) = 0
    if (n !== undefined) A[row][n] -= 1;
  });

  const x = gaussSolve(A, z);
  const voltage: Record<string, number> = { [GROUND]: 0 };
  nodes.forEach((n, k) => (voltage[n] = x[k]));
  const current: Record<string, number> = {};
  const power: Record<string, number> = {};
  for (const e of elements) {
    if (e.kind === 'OA') {
      current[e.id] = x[nodes.length + sources.length + opamps.indexOf(e)];
      power[e.id] = -voltage[e.out] * current[e.id]; // çıkış katı beslemeden güç verir
      continue;
    }
    const v = voltage[e.a] - voltage[e.b];
    current[e.id] = e.kind === 'R' ? v / e.ohms : e.kind === 'I' ? e.amps : x[nodes.length + sources.indexOf(e)];
    power[e.id] = v * current[e.id];
  }
  return { voltage, current, power };
}

/**
 * Çözümden bağımsız kontrol: her düğümde KCL artığı ve toplam güç dengesi.
 * Doğru çözümde ikisi de ~0 olmalı.
 */
export function checkSolution(elements: readonly Element[], s: DcSolution): { kcl: number; power: number } {
  const net: Record<string, number> = {};
  for (const e of elements) {
    if (e.kind === 'OA') {
      net[e.out] = (net[e.out] ?? 0) + s.current[e.id]; // girişler akım çekmez
      continue;
    }
    const i = e.kind === 'R' ? (s.voltage[e.a] - s.voltage[e.b]) / e.ohms : s.current[e.id];
    net[e.a] = (net[e.a] ?? 0) - i;
    net[e.b] = (net[e.b] ?? 0) + i;
  }
  delete net[GROUND];
  const kcl = Math.max(0, ...Object.values(net).map(Math.abs));
  const powers = elements.map((e) => (e.kind === 'OA' ? -s.voltage[e.out] * s.current[e.id] : (s.voltage[e.a] - s.voltage[e.b]) * s.current[e.id]));
  return { kcl, power: Math.abs(powers.reduce((a, b) => a + b, 0)) };
}

function validate(elements: readonly Element[]): void {
  const ids = new Set<string>();
  for (const e of elements) {
    if (ids.has(e.id)) throw new Error(`Aynı eleman kimliği iki kez: '${e.id}'`);
    ids.add(e.id);
    if (e.a === e.b) throw new Error(`'${e.id}' iki ucu aynı düğüme bağlı`);
    if (e.kind === 'OA') continue;
    const v = e.kind === 'R' ? e.ohms : e.kind === 'V' ? e.volts : e.amps;
    if (!Number.isFinite(v)) throw new Error(`'${e.id}' değeri sayı değil`);
    if (e.kind === 'R' && !(e.ohms > 0)) throw new Error(`'${e.id}' direnci pozitif olmalı`);
  }
  if (!elements.some((e) => e.a === GROUND || e.b === GROUND)) throw new Error('Devrede toprak (0) düğümü yok');
}

/** Toprağa direnç ya da gerilim kaynağı üzerinden ulaşılamayan düğümler (akım kaynağı yol sayılmaz). */
function unreachableFromGround(elements: readonly Element[], nodes: string[]): string[] {
  const seen = new Set([GROUND]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of elements) {
      if (e.kind === 'I') continue;
      if (e.kind === 'OA') {
        if (!seen.has(e.out)) {
          seen.add(e.out); // çıkış toprağa göre sürülür
          grew = true;
        }
        continue;
      }
      if (seen.has(e.a) !== seen.has(e.b)) {
        seen.add(e.a);
        seen.add(e.b);
        grew = true;
      }
    }
  }
  return nodes.filter((n) => !seen.has(n));
}

/** Kısmi pivotlu Gauss eleme. Tekil sistemde açıklamalı hata. */
function gaussSolve(A: number[][], z: number[]): number[] {
  const n = z.length;
  const M = A.map((row, i) => [...row, z[i]]);
  const scale = Math.max(1e-300, ...A.flat().map(Math.abs));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12 * scale) {
      throw new Error('Devre çözülemez: sistem tekil (gerilim kaynakları döngü oluşturuyor ya da kısa devre edilmiş olabilir).');
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}
