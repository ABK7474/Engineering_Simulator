// Algoritma izleme türünün varyantları: BFS, DFS (özyinelemeli), ekleme sıralaması, seçme sıralaması, ikili arama
// ağacı (ekleme yolları + dolaşma). Her varyantta:
//  - step(): bir önceki GÖSTERİLEN durumdan sonraki satırı hesaplar (tabloyu onarma denetimi bunu kullanır);
//  - reference(): aynı izlemeyi farklı bir yöntemle bulur (çapraz kontrol);
//  - corrupt(): öğrencinin gerçekten yaptığı bir hatayı (kuyruk yerine yığın, fazla geri dönüş, bir eksik
//    kaydırma...) tek satıra uygular;
//  - code: oyuncunun gördüğü C# kodu. `Kayit(...)` çağrısı izleme satırını yazar; scripts/verify-algo.mjs bu kodu
//    gerçek derleyiciyle çalıştırıp izlemeyi karşılaştırır.

import { pick, shuffle, type Rng } from '../../core/rng';

export type AlgoVariant = 'bfs' | 'dfs' | 'insertion' | 'selection' | 'bst';
export const ALGO_VARIANTS: readonly AlgoVariant[] = ['bfs', 'dfs', 'insertion', 'selection', 'bst'];

export type Cell = number | number[] | null;
export type Cells = Record<string, Cell>;

export interface Column {
  id: string;
  label: string;
  kind: 'num' | 'list';
  /** Liste sütununda okuma yönü (ör. "baş → son"). */
  order?: string;
}

export interface AlgoSizes {
  /** Graf düğüm sayısı aralığı. */
  nodes: [number, number];
  /** Ağacın üstüne eklenen fazla kenar sayısı aralığı. */
  extraEdges: [number, number];
  /** Dizi uzunluğu aralığı. */
  length: [number, number];
  /** Ağaca eklenen anahtar sayısı aralığı. */
  keys: [number, number];
}

export type AlgoInput =
  | { variant: 'bfs' | 'dfs'; n: number; adj: number[][]; start: number }
  | { variant: 'insertion' | 'selection'; array: number[] }
  | { variant: 'bst'; keys: number[]; traversal: 'pre' | 'post' };

export class StepError extends Error {}

export interface VariantImpl {
  story: string;
  code: string[];
  columns: Column[];
  corruptions: Record<string, string>;
  make(rng: Rng, s: AlgoSizes): AlgoInput;
  initial(i: AlgoInput): Cells;
  count(i: AlgoInput): number;
  op(i: AlgoInput, j: number): string;
  step(i: AlgoInput, prev: Cells, j: number): Cells;
  reference(i: AlgoInput): Cells[];
  corrupt(i: AlgoInput, kind: string, prev: Cells, j: number, rng: Rng): Cells | null;
}

const range = (rng: Rng, [lo, hi]: [number, number]) => lo + Math.floor(rng() * (hi - lo + 1));
const L = (c: Cell) => c as number[];
const N = (c: Cell) => c as number;
const same = (a: Cell, b: Cell) => JSON.stringify(a) === JSON.stringify(b);
export const sameCells = (a: Cells, b: Cells) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => same(a[k], b[k]));

// ---------------------------------------------------------------- graf

/** Bağlı, yönsüz graf: rastgele yayılan ağaç + fazla kenarlar; komşu listeleri artan sırada. */
function makeGraph(rng: Rng, s: AlgoSizes): { n: number; adj: number[][] } {
  const n = range(rng, s.nodes);
  const edges = new Set<string>();
  const order = shuffle(rng, Array.from({ length: n }, (_, k) => k));
  for (let k = 1; k < n; k++) {
    const a = order[k];
    const b = order[Math.floor(rng() * k)];
    edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  const extra = range(rng, s.extraEdges);
  for (let tries = 0; edges.size < n - 1 + extra && tries < 200; tries++) {
    const a = Math.floor(rng() * n);
    const b = Math.floor(rng() * n);
    if (a !== b) edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const [a, b] = e.split('-').map(Number);
    adj[a].push(b);
    adj[b].push(a);
  }
  adj.forEach((l) => l.sort((x, y) => x - y));
  return { n, adj };
}

type G = Extract<AlgoInput, { variant: 'bfs' | 'dfs' }>;

const BFS: VariantImpl = {
  story: 'Çekirdek, istasyon ağındaki düğümleri yeniden açarken genişlik öncelikli arama yapıyor; kayıttaki kuyruk dökümü bozulmuş.',
  code: [
    'static void Bfs(List<int>[] adj, int start)',
    '{',
    '    var queue = new Queue<int>();',
    '    var visited = new List<int>();',
    '    queue.Enqueue(start);',
    '    visited.Add(start);',
    '    while (queue.Count > 0)',
    '    {',
    '        int u = queue.Dequeue();',
    '        foreach (int v in adj[u])      // komşular artan sırada',
    '        {',
    '            if (!visited.Contains(v))',
    '            {',
    '                visited.Add(v);',
    '                queue.Enqueue(v);',
    '            }',
    '        }',
    '        Kayit(u, queue, visited);',
    '    }',
    '}',
  ],
  columns: [
    { id: 'u', label: 'u', kind: 'num' },
    { id: 'queue', label: 'queue', kind: 'list', order: 'baş → son' },
    { id: 'visited', label: 'visited', kind: 'list', order: 'ekleme sırası' },
  ],
  corruptions: {
    lifo: 'Kuyruk yığın gibi kullanılmış: baştan değil sondan çıkarılmış.',
    duplicate: 'Kuyrukta bekleyen bir komşu yeniden eklenmiş (ziyaret işareti kuyruğa eklerken değil, çıkarırken konmuş gibi).',
    reverse: 'Komşular azalan sırada eklenmiş; foreach listeyi artan sırada dolaşır.',
    skip: 'Ziyaret edilmemiş bir komşu atlanmış.',
  },
  make(rng, s) {
    const { n, adj } = makeGraph(rng, s);
    return { variant: 'bfs', n, adj, start: Math.floor(rng() * n) };
  },
  initial: (i) => ({ u: null, queue: [(i as G).start], visited: [(i as G).start] }),
  count: (i) => (i as G).n,
  op: () => 'Dequeue + komşular',
  step(i, prev) {
    const g = i as G;
    const q = [...L(prev.queue)];
    const vis = [...L(prev.visited)];
    if (!q.length) throw new StepError('kuyruk boş');
    const u = q.shift()!;
    for (const v of g.adj[u])
      if (!vis.includes(v)) {
        vis.push(v);
        q.push(v);
      }
    return { u, queue: q, visited: vis };
  },
  reference(i) {
    // Katman yöntemi: uzaklık + "ebeveynin sırası" + etiket anahtarıyla sıralanmış düğümler BFS sırasıdır.
    const g = i as G;
    const order: number[] = [g.start];
    const parentRank = new Map<number, number>([[g.start, -1]]);
    for (let k = 0; k < order.length; k++) {
      const fresh = g.adj[order[k]].filter((v) => !parentRank.has(v));
      for (const v of fresh) parentRank.set(v, k);
      order.push(...fresh); // komşu listesi zaten artan
    }
    return order.map((u, k) => {
      const enq = order.filter((v) => parentRank.get(v)! <= k).length; // k. çıkarmaya kadar eklenenler
      return { u, queue: order.slice(k + 1, enq), visited: order.slice(0, enq) };
    });
  },
  corrupt(i, kind, prev, _j, rng) {
    const g = i as G;
    const q = [...L(prev.queue)];
    const vis = [...L(prev.visited)];
    if (!q.length) return null;
    if (kind === 'lifo') {
      if (q.length < 2) return null;
      const u = q.pop()!;
      for (const v of g.adj[u]) if (!vis.includes(v)) (vis.push(v), q.push(v));
      return { u, queue: q, visited: vis };
    }
    const u = q.shift()!;
    const fresh = g.adj[u].filter((v) => !vis.includes(v));
    if (kind === 'duplicate') {
      const waiting = g.adj[u].filter((v) => q.includes(v));
      if (!waiting.length) return null;
      const dup = pick(rng, waiting);
      const out = [...q];
      for (const v of g.adj[u]) {
        if (fresh.includes(v)) out.push(v);
        else if (v === dup) out.push(v);
      }
      return { u, queue: out, visited: [...vis, ...fresh] };
    }
    if (kind === 'reverse') {
      if (fresh.length < 2) return null;
      const r = [...fresh].reverse();
      return { u, queue: [...q, ...r], visited: [...vis, ...r] };
    }
    if (kind === 'skip') {
      if (!fresh.length) return null;
      const kept = fresh.slice(0, -1);
      return { u, queue: [...q, ...kept], visited: [...vis, ...kept] };
    }
    return null;
  },
};

const DFS: VariantImpl = {
  story: 'Çekirdek, bozuk sensör ağını derinlik öncelikli arama ile tarıyor; çağrı yığını dökümünde bir kayıt bozulmuş.',
  code: [
    'static void Dfs(List<int>[] adj, int u, List<int> visited, Stack<int> path)',
    '{',
    '    visited.Add(u);',
    '    path.Push(u);',
    '    Kayit(u, path, visited);',
    '    foreach (int v in adj[u])          // komşular artan sırada',
    '    {',
    '        if (!visited.Contains(v))',
    '            Dfs(adj, v, visited, path);',
    '    }',
    '    path.Pop();',
    '}',
  ],
  columns: [
    { id: 'u', label: 'u', kind: 'num' },
    { id: 'path', label: 'path', kind: 'list', order: 'tepe → dip' },
    { id: 'visited', label: 'visited', kind: 'list', order: 'ekleme sırası' },
  ],
  corruptions: {
    largest: 'Ziyaret edilmemiş komşulardan en büyüğü seçilmiş; foreach en küçükten başlar.',
    overBacktrack: 'Fazla geri dönülmüş: komşusu kalan düğüm de yığından atılmış.',
    noPop: 'Biten düğümler yığından çıkarılmamış (path.Pop unutulmuş gibi).',
  },
  make(rng, s) {
    const { n, adj } = makeGraph(rng, s);
    return { variant: 'dfs', n, adj, start: Math.floor(rng() * n) };
  },
  initial: () => ({ u: null, path: [], visited: [] }),
  count: (i) => (i as G).n,
  op: (_i, j) => (j === 0 ? 'Dfs(start)' : 'Dfs çağrısı'),
  step(i, prev) {
    const g = i as G;
    const vis = [...L(prev.visited)];
    const st = [...L(prev.path)];
    if (!vis.length) return { u: g.start, path: [g.start], visited: [g.start] };
    while (st.length) {
      const next = g.adj[st[0]].find((v) => !vis.includes(v));
      if (next !== undefined) return { u: next, path: [next, ...st], visited: [...vis, next] };
      st.shift();
    }
    throw new StepError('gezinme bitti');
  },
  reference(i) {
    const g = i as G;
    const rows: Cells[] = [];
    const seen = new Array<boolean>(g.n).fill(false);
    const order: number[] = [];
    const path: number[] = []; // dip → tepe
    const visit = (u: number) => {
      seen[u] = true;
      order.push(u);
      path.push(u);
      rows.push({ u, path: [...path].reverse(), visited: [...order] });
      for (const v of g.adj[u]) if (!seen[v]) visit(v);
      path.pop();
    };
    visit(g.start);
    return rows;
  },
  corrupt(i, kind, prev) {
    const g = i as G;
    const vis = L(prev.visited);
    const st = L(prev.path);
    if (!vis.length) return null;
    // Doğru geri dönüş noktası
    let t = 0;
    while (t < st.length && !g.adj[st[t]].some((v) => !vis.includes(v))) t++;
    if (t >= st.length) return null;
    const cand = g.adj[st[t]].filter((v) => !vis.includes(v));
    if (kind === 'largest') {
      if (cand.length < 2) return null;
      const v = cand[cand.length - 1];
      return { u: v, path: [v, ...st.slice(t)], visited: [...vis, v] };
    }
    if (kind === 'overBacktrack') {
      for (let a = t + 1; a < st.length; a++) {
        const v = g.adj[st[a]].find((x) => !vis.includes(x));
        if (v !== undefined) return { u: v, path: [v, ...st.slice(a)], visited: [...vis, v] };
      }
      return null;
    }
    if (kind === 'noPop') {
      if (t === 0) return null;
      const v = cand[0];
      return { u: v, path: [v, ...st], visited: [...vis, v] };
    }
    return null;
  },
};

// ---------------------------------------------------------------- sıralama

type A = Extract<AlgoInput, { variant: 'insertion' | 'selection' }>;

/** Farklı değerli dizi (eşitlik belirsizliği olmasın). */
function makeArray(rng: Rng, s: AlgoSizes): number[] {
  const n = range(rng, s.length);
  return shuffle(rng, Array.from({ length: 90 }, (_, k) => k + 10)).slice(0, n);
}

const INSERTION: VariantImpl = {
  story: 'Çekirdek, görev önceliklerini ekleme sıralamasıyla diziyor; geçiş kayıtlarından biri bozulmuş.',
  code: [
    'static void InsertionSort(int[] a)',
    '{',
    '    for (int i = 1; i < a.Length; i++)',
    '    {',
    '        int key = a[i];',
    '        int j = i - 1;',
    '        int shifts = 0;',
    '        while (j >= 0 && a[j] > key)',
    '        {',
    '            a[j + 1] = a[j];',
    '            j--;',
    '            shifts++;',
    '        }',
    '        a[j + 1] = key;',
    '        Kayit(key, a, shifts);',
    '    }',
    '}',
  ],
  columns: [
    { id: 'key', label: 'key', kind: 'num' },
    { id: 'a', label: 'a', kind: 'list', order: 'a[0] → son' },
    { id: 'shifts', label: 'shifts', kind: 'num' },
  ],
  corruptions: {
    offByOne: 'Kaydırma bir adım erken durmuş (j > 0 koşulu): anahtar bir konum sağa yerleşmiş.',
    overShift: 'Bir eleman fazla kaydırılmış: anahtar bir konum sola, kendinden küçük elemanın önüne yerleşmiş.',
    countOff: 'Kaydırma sayısı yanlış sayılmış.',
  },
  make: (rng, s) => ({ variant: 'insertion', array: makeArray(rng, s) }),
  initial: (i) => ({ key: null, a: [...(i as A).array], shifts: null }),
  count: (i) => (i as A).array.length - 1,
  op: (_i, j) => `i = ${j + 1}`,
  step(_i, prev, j) {
    const a = [...L(prev.a)];
    const i = j + 1;
    if (i >= a.length) throw new StepError('dizi bitti');
    const key = a[i];
    let k = i - 1;
    let shifts = 0;
    while (k >= 0 && a[k] > key) {
      a[k + 1] = a[k];
      k--;
      shifts++;
    }
    a[k + 1] = key;
    return { key, a, shifts };
  },
  reference(i) {
    const orig = (i as A).array;
    return orig.slice(1).map((key, k) => {
      const n = k + 2; // sıralanmış önek uzunluğu
      const prefix = orig.slice(0, n).sort((x, y) => x - y);
      return { key, a: [...prefix, ...orig.slice(n)], shifts: orig.slice(0, n - 1).filter((x) => x > key).length };
    });
  },
  corrupt(i, kind, prev, j, rng) {
    const right = INSERTION.step(i, prev, j);
    const a = L(right.a);
    const pos = a.indexOf(N(right.key));
    const s = N(right.shifts);
    if (kind === 'offByOne') {
      if (s < 1) return null;
      const b = [...a];
      [b[pos], b[pos + 1]] = [b[pos + 1], b[pos]];
      return { key: right.key, a: b, shifts: s - 1 };
    }
    if (kind === 'overShift') {
      if (pos < 1) return null;
      const b = [...a];
      [b[pos - 1], b[pos]] = [b[pos], b[pos - 1]];
      return { key: right.key, a: b, shifts: s + 1 };
    }
    if (kind === 'countOff') return { key: right.key, a, shifts: s === 0 ? 1 : s + (rng() < 0.5 ? -1 : 1) };
    return null;
  },
};

const SELECTION: VariantImpl = {
  story: 'Çekirdek, sensör kanallarını seçme sıralamasıyla diziyor; geçiş kayıtlarından biri bozulmuş.',
  code: [
    'static void SelectionSort(int[] a)',
    '{',
    '    for (int i = 0; i < a.Length - 1; i++)',
    '    {',
    '        int min = i;',
    '        for (int j = i + 1; j < a.Length; j++)',
    '        {',
    '            if (a[j] < a[min])',
    '                min = j;',
    '        }',
    '        (a[i], a[min]) = (a[min], a[i]);',
    '        Kayit(min, a);',
    '    }',
    '}',
  ],
  columns: [
    { id: 'min', label: 'min', kind: 'num' },
    { id: 'a', label: 'a', kind: 'list', order: 'a[0] → son' },
  ],
  corruptions: {
    firstSmaller: 'En küçük yerine a[i]\'den küçük İLK eleman seçilmiş (iç döngü ilk bulunca durmuş gibi).',
    innerFromI: 'İç döngü j = i + 1 yerine j = i + 2\'den başlamış: a[i + 1] hiç karşılaştırılmamış.',
    noSwap: 'min doğru bulunmuş ama takas yapılmamış.',
  },
  make: (rng, s) => ({ variant: 'selection', array: makeArray(rng, s) }),
  initial: (i) => ({ min: null, a: [...(i as A).array] }),
  count: (i) => (i as A).array.length - 1,
  op: (_i, j) => `i = ${j}`,
  step(_i, prev, j) {
    const a = [...L(prev.a)];
    if (j >= a.length - 1) throw new StepError('dizi bitti');
    let min = j;
    for (let k = j + 1; k < a.length; k++) if (a[k] < a[min]) min = k;
    [a[j], a[min]] = [a[min], a[j]];
    return { min, a };
  },
  reference(i) {
    const a = [...(i as A).array];
    return a.slice(0, -1).map((_, j) => {
      const rest = a.slice(j);
      const min = j + rest.indexOf(Math.min(...rest));
      const t = a[j];
      a[j] = a[min];
      a[min] = t;
      return { min, a: [...a] };
    });
  },
  corrupt(i, kind, prev, j) {
    const right = SELECTION.step(i, prev, j);
    const before = L(prev.a);
    if (kind === 'firstSmaller') {
      const k = before.findIndex((x, idx) => idx > j && x < before[j]);
      if (k < 0 || k === right.min) return null;
      const b = [...before];
      [b[j], b[k]] = [b[k], b[j]];
      return { min: k, a: b };
    }
    if (kind === 'innerFromI') {
      let min = j;
      for (let k = j + 2; k < before.length; k++) if (before[k] < before[min]) min = k;
      if (min === right.min) return null;
      const b = [...before];
      [b[j], b[min]] = [b[min], b[j]];
      return { min, a: b };
    }
    if (kind === 'noSwap') return right.min === j ? null : { min: right.min, a: [...before] };
    return null;
  },
};

// ---------------------------------------------------------------- ikili arama ağacı

type B = Extract<AlgoInput, { variant: 'bst' }>;

interface Node {
  key: number;
  left: Node | null;
  right: Node | null;
}

/** İşaretçili ağaç: eklerken uğranan anahtarlar (kökten ebeveyne). */
function insertPath(keys: number[], j: number): number[] {
  let root: Node | null = null;
  let path: number[] = [];
  for (let k = 0; k <= j; k++) {
    path = [];
    const node: Node = { key: keys[k], left: null, right: null };
    if (!root) {
      root = node;
      continue;
    }
    let cur: Node = root;
    for (;;) {
      path.push(cur.key);
      const side: 'left' | 'right' = keys[k] < cur.key ? 'left' : 'right';
      if (!cur[side]) {
        cur[side] = node;
        break;
      }
      cur = cur[side]!;
    }
  }
  return path;
}

function traverse(keys: number[], kind: 'pre' | 'post' | 'in'): number[] {
  let root: Node | null = null;
  for (const key of keys) {
    const node: Node = { key, left: null, right: null };
    if (!root) root = node;
    else
      for (let cur: Node = root; ; ) {
        const side: 'left' | 'right' = key < cur.key ? 'left' : 'right';
        if (!cur[side]) {
          cur[side] = node;
          break;
        }
        cur = cur[side]!;
      }
  }
  const out: number[] = [];
  const walk = (n: Node | null) => {
    if (!n) return;
    if (kind === 'pre') out.push(n.key);
    walk(n.left);
    if (kind === 'in') out.push(n.key);
    walk(n.right);
    if (kind === 'post') out.push(n.key);
  };
  walk(root);
  return out;
}

const BST_CODE = (t: 'pre' | 'post') => [
  'static Node Insert(Node node, int key, List<int> path)',
  '{',
  '    if (node == null) return new Node(key);',
  '    path.Add(node.Key);',
  '    if (key < node.Key) node.Left = Insert(node.Left, key, path);',
  '    else node.Right = Insert(node.Right, key, path);',
  '    return node;',
  '}',
  '',
  `static void ${t === 'pre' ? 'PreOrder' : 'PostOrder'}(Node n, List<int> output)`,
  '{',
  '    if (n == null) return;',
  ...(t === 'pre'
    ? ['    output.Add(n.Key);', '    PreOrder(n.Left, output);', '    PreOrder(n.Right, output);']
    : ['    PostOrder(n.Left, output);', '    PostOrder(n.Right, output);', '    output.Add(n.Key);']),
  '}',
  '',
  '// Ana döngü: her anahtar için',
  '//   var path = new List<int>();',
  '//   root = Insert(root, key, path);  Kayit(key, path);',
  `// sonunda: ${t === 'pre' ? 'PreOrder' : 'PostOrder'}(root, output);  Kayit(output);`,
];

const BST: VariantImpl = {
  story: 'Çekirdek, kayıt dizinini ikili arama ağacında tutuyor; ekleme yolu dökümünde bir kayıt bozulmuş.',
  code: [], // anahtar ve dolaşma türüne göre: codeOf()
  columns: [
    { id: 'path', label: 'path', kind: 'list', order: 'kökten ebeveyne' },
    { id: 'output', label: 'output', kind: 'list', order: 'yazılış sırası' },
  ],
  corruptions: {
    wrongTurn: 'Bir karşılaştırmada ters yöne gidilmiş (küçükse sola, büyük-eşitse sağa).',
    stopEarly: 'Yol bir düğüm erken bitirilmiş: son karşılaştırma yazılmamış.',
    inorder: 'Dolaşmada sıra karıştırılmış: kök, sol ve sağ alt ağacın arasında yazılmış (inorder).',
    otherOrder: 'Preorder ile postorder karıştırılmış.',
  },
  make(rng, s) {
    const n = range(rng, s.keys);
    const keys = shuffle(rng, Array.from({ length: 90 }, (_, k) => k + 10)).slice(0, n);
    return { variant: 'bst', keys, traversal: rng() < 0.5 ? 'pre' : 'post' };
  },
  initial: () => ({ path: null, output: null }),
  count: (i) => (i as B).keys.length + 1,
  op: (i, j) => {
    const b = i as B;
    return j < b.keys.length ? `Insert(${b.keys[j]})` : b.traversal === 'pre' ? 'PreOrder(root)' : 'PostOrder(root)';
  },
  step(i, _prev, j) {
    const b = i as B;
    if (j < b.keys.length) return { path: insertPath(b.keys, j), output: null };
    if (j === b.keys.length) return { path: null, output: traverse(b.keys, b.traversal) };
    throw new StepError('kayıt bitti');
  },
  reference(i) {
    // Dizi temelli ağaç (indeks 2k+1 / 2k+2) ve açık yığınla dolaşma
    const b = i as B;
    const slot = new Map<number, number>();
    const rows: Cells[] = [];
    for (const key of b.keys) {
      const path: number[] = [];
      let k = 0;
      while (slot.has(k)) {
        path.push(slot.get(k)!);
        k = key < slot.get(k)! ? 2 * k + 1 : 2 * k + 2;
      }
      slot.set(k, key);
      rows.push({ path, output: null });
    }
    const out: number[] = [];
    if (b.traversal === 'pre') {
      const st = [0];
      while (st.length) {
        const k = st.pop()!;
        if (!slot.has(k)) continue;
        out.push(slot.get(k)!);
        st.push(2 * k + 2, 2 * k + 1);
      }
    } else {
      // postorder = (kök, sağ, sol) önce-sırasının tersi
      const st = [0];
      while (st.length) {
        const k = st.pop()!;
        if (!slot.has(k)) continue;
        out.push(slot.get(k)!);
        st.push(2 * k + 1, 2 * k + 2);
      }
      out.reverse();
    }
    rows.push({ path: null, output: out });
    return rows;
  },
  corrupt(i, kind, _prev, j, rng) {
    const b = i as B;
    if (j < b.keys.length) {
      const path = insertPath(b.keys, j);
      if (kind === 'stopEarly') return path.length >= 2 ? { path: path.slice(0, -1), output: null } : null;
      if (kind !== 'wrongTurn' || path.length < 2) return null;
      // Ters dönüşü yoldaki rastgele bir düğümde yap, sonra o alt ağaçta doğru devam et
      const at = Math.floor(rng() * (path.length - 1));
      const prior = b.keys.slice(0, j);
      const sub = (lo: number, hi: number, after: number[]) => after.filter((x) => x > lo && x < hi);
      // path[at]'ten sonraki gerçek yön yerine diğer alt ağaca in
      let lo = -Infinity;
      let hi = Infinity;
      for (let k = 0; k < at; k++) if (b.keys[j] < path[k]) hi = path[k];
      else lo = path[k];
      const goLeft = !(b.keys[j] < path[at]);
      const nlo = goLeft ? lo : path[at];
      const nhi = goLeft ? path[at] : hi;
      const sideKeys = sub(nlo, nhi, prior);
      const wrong = [...path.slice(0, at + 1)];
      // O alt ağacın ekleme sırası korunarak yerleştirilmiş kökü ilk eklenendir; oradan normal kurala göre in
      let lo2 = nlo;
      let hi2 = nhi;
      for (;;) {
        const root = sideKeys.find((x) => x > lo2 && x < hi2);
        if (root === undefined) break;
        wrong.push(root);
        if (b.keys[j] < root) hi2 = root;
        else lo2 = root;
      }
      return same(wrong, path) ? null : { path: wrong, output: null };
    }
    const right = traverse(b.keys, b.traversal);
    const alt = kind === 'inorder' ? traverse(b.keys, 'in') : kind === 'otherOrder' ? traverse(b.keys, b.traversal === 'pre' ? 'post' : 'pre') : null;
    return alt && !same(alt, right) ? { path: null, output: alt } : null;
  },
};

export const VARIANTS: Record<AlgoVariant, VariantImpl> = { bfs: BFS, dfs: DFS, insertion: INSERTION, selection: SELECTION, bst: BST };

export const codeOf = (i: AlgoInput): string[] => (i.variant === 'bst' ? BST_CODE(i.traversal) : VARIANTS[i.variant].code);
