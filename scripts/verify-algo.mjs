// Geliştirici betiği (oyunun çalışma zamanına girmez, `npm test`i bekletmez): `npm run verify:algo [tohum sayısı]`
// algo-trace problemlerinde oyuncuya GÖSTERİLEN C# kodunu olduğu gibi derler; yalnız `Kayit(...)` yöntemlerini ve
// girdiyi kuran `Run()`u ekler. Gerçek derleyicinin (dotnet) izlemesi adım fonksiyonunun izlemesiyle satır satır
// karşılaştırılır. dotnet kurulu değilse atlanır (çıkış kodu 0). Geçici klasörde, zaman sınırıyla çalışır.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = Number(process.argv[2] ?? 200);
const TIMEOUT_MS = 300_000;

const probe = spawnSync('dotnet', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.log('dotnet bulunamadı; C# doğrulaması atlandı.');
  process.exit(0);
}
console.log(`dotnet ${probe.stdout.trim()} · ${SEEDS} tohum`);

const KAYIT = {
  bfs: 'static void Kayit(int u, Queue<int> queue, List<int> visited) => Console.WriteLine($"u={u}|queue={string.Join(",", queue)}|visited={string.Join(",", visited)}");',
  dfs: 'static void Kayit(int u, Stack<int> path, List<int> visited) => Console.WriteLine($"u={u}|path={string.Join(",", path)}|visited={string.Join(",", visited)}");',
  insertion: 'static void Kayit(int key, int[] a, int shifts) => Console.WriteLine($"key={key}|a={string.Join(",", a)}|shifts={shifts}");',
  selection: 'static void Kayit(int min, int[] a) => Console.WriteLine($"min={min}|a={string.Join(",", a)}");',
  bst: [
    'static void Kayit(int key, List<int> path) => Console.WriteLine($"path={string.Join(",", path)}|output=");',
    'static void Kayit(List<int> output) => Console.WriteLine($"path=|output={string.Join(",", output)}");',
  ].join('\n'),
};

function runBody(input) {
  switch (input.variant) {
    case 'bfs':
    case 'dfs': {
      const lists = input.adj.map((l) => `new List<int> { ${l.join(', ')} }`).join(', ');
      const call = input.variant === 'bfs' ? `Bfs(adj, ${input.start});` : `Dfs(adj, ${input.start}, new List<int>(), new Stack<int>());`;
      return `var adj = new List<int>[] { ${lists} };\n        ${call}`;
    }
    case 'insertion':
      return `InsertionSort(new[] { ${input.array.join(', ')} });`;
    case 'selection':
      return `SelectionSort(new[] { ${input.array.join(', ')} });`;
    case 'bst':
      return [
        'Node root = null;',
        `foreach (int key in new[] { ${input.keys.join(', ')} })`,
        '{',
        '    var path = new List<int>();',
        '    root = Insert(root, key, path);',
        '    Kayit(key, path);',
        '}',
        'var output = new List<int>();',
        `${input.traversal === 'pre' ? 'PreOrder' : 'PostOrder'}(root, output);`,
        'Kayit(output);',
      ].join('\n        ');
  }
}

const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
let failures = 0;
try {
  const { generateAlgoTrace, parseAlgoTraceConfig } = await server.ssrLoadModule('/src/solvers/algo/algo-trace.ts');
  const cfg = parseAlgoTraceConfig({ variants: ['bfs', 'dfs', 'insertion', 'selection', 'bst'], nodes: [5, 9], extraEdges: [0, 4], length: [5, 9], keys: [5, 11] });
  const expected = new Map();
  const classes = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const p = generateAlgoTrace(cfg, seed);
    const v = p.input.variant;
    classes.push(`// tohum ${seed}: ${v}
static class P${seed}
{
${p.code.map((l) => '    ' + l).join('\n')}

    ${KAYIT[v].split('\n').join('\n    ')}

    public static void Run()
    {
        ${runBody(p.input)}
    }
}`);
    expected.set(seed, p.rows.map((r) => p.columns.map((c) => `${c.id}=${r[c.id] === null ? '' : Array.isArray(r[c.id]) ? r[c.id].join(',') : r[c.id]}`).join('|')));
  }
  const source = `#nullable disable
using System;
using System.Collections.Generic;

${[...expected.keys()].map((n) => `Run(${n}, P${n}.Run);`).join('\n')}

static void Run(int n, Action a)
{
    Console.WriteLine("@" + n);
    try { a(); } catch (Exception e) { Console.WriteLine("!" + e.GetType().Name); }
}

class Node
{
    public int Key;
    public Node Left, Right;
    public Node(int key) { Key = key; }
}

${classes.join('\n\n')}
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derin-verify-algo-'));
  const file = path.join(dir, 'verify.cs');
  fs.writeFileSync(file, source);
  console.log(`derleniyor ve çalıştırılıyor: ${file}`);
  const run = spawnSync('dotnet', ['run', file], { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  if (run.error || run.status !== 0) {
    console.error('dotnet çalıştırılamadı:', run.error?.message ?? '', run.stderr || run.stdout);
    process.exitCode = 1;
  } else {
    const got = new Map();
    let cur = null;
    for (const line of run.stdout.split(/\r?\n/)) {
      if (line.startsWith('@')) got.set((cur = Number(line.slice(1))), []);
      else if (cur !== null && line) got.get(cur).push(line);
    }
    for (const [seed, want] of expected) {
      const have = got.get(seed) ?? [];
      const k = want.findIndex((w, j) => w !== have[j]);
      if (k >= 0 || have.length !== want.length) {
        failures++;
        const j = k >= 0 ? k : Math.min(want.length, have.length);
        console.error(`UYUŞMAZLIK tohum ${seed}, adım ${j + 1}:\n  adım fonksiyonu: ${want[j] ?? '(yok)'}\n  C#             : ${have[j] ?? '(yok)'}`);
      }
    }
    console.log(failures ? `${failures}/${SEEDS} tohumda uyuşmazlık` : `${SEEDS}/${SEEDS} tohumda C# izlemesi adım fonksiyonuyla birebir aynı`);
    if (failures) process.exitCode = 1;
    fs.rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await server.close();
}
