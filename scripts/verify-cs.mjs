// Geliştirici betiği (oyunun çalışma zamanına girmez, `npm test`i bekletmez): `npm run verify:cs [tohum sayısı]`
// Trace şablonlarından, simülatörün kullandığı IR'nin AYNISINDAN enstrümanlı C# üretir; gerçek derleyiciyle
// (dotnet) derleyip çalıştırır ve her adımı simülatörün izlemesiyle satır satır karşılaştırır.
// dotnet kurulu değilse atlanır (çıkış kodu 0). Kod yalnız elle yazılmış şablonlardan gelir; geçici klasörde,
// zaman sınırıyla çalışır.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = Number(process.argv[2] ?? 100);
const TIMEOUT_MS = 300_000;

const probe = spawnSync('dotnet', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.log('dotnet bulunamadı; C# doğrulaması atlandı.');
  process.exit(0);
}
console.log(`dotnet ${probe.stdout.trim()} · ${SEEDS} tohum`);

const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
let failures = 0;
try {
  const load = (p) => server.ssrLoadModule(p);
  const { parseDsTraceConfig } = await load('/src/solvers/ds/ir.ts');
  const { generateDsTrace } = await load('/src/solvers/ds/ds-trace.generate.ts');
  const { printInstrumented } = await load('/src/solvers/ds/print.ts');
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/faults/computer-core-01.json'), 'utf8'));
  const stage = card.stages.find((s) => s.type === 'ds-trace');
  const cfg = parseDsTraceConfig(structuredClone(stage.config));

  // Simülatörün beklediği çıktı: "satır#yapılar#değişkenler" (görünen değişkenler, sütun sırasıyla)
  const expected = new Map();
  const classes = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const p = generateDsTrace(cfg, seed);
    classes.push(`// tohum ${seed}: ${p.template.id} ${JSON.stringify(p.params)}\n${printInstrumented(p.template, p.params, `P${seed}`)}`);
    expected.set(
      seed,
      p.rows.map((r) => {
        const structs = p.structs.map((s) => `${s.name}=${r.after.structs[s.name].join(',')}`).join('|');
        const vars = p.columns.filter((c) => r.after.vars[c.name] !== null).map((c) => `${c.name}=${r.after.vars[c.name]}`).join('|');
        return `${r.line}#${structs}#${vars}`;
      }),
    );
  }

  const calls = [...expected.keys()].map((n) => `Run(${n}, P${n}.Run);`).join('\n');
  const source = `using System;
using System.Collections.Generic;

${calls}

static void Run(int n, Action a)
{
    Console.WriteLine("@" + n);
    try { a(); } catch (Exception e) { Console.WriteLine("!" + e.GetType().Name); }
}

static class D
{
    public static void Row(int line, string structs, string vars) => Console.WriteLine(line + "#" + structs + "#" + vars);
}

${classes.join('\n\n')}
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derin-verify-cs-'));
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
        console.error(`UYUŞMAZLIK tohum ${seed}, adım ${j + 1}:\n  simülatör: ${want[j] ?? '(yok)'}\n  C#       : ${have[j] ?? '(yok)'}`);
      }
    }
    console.log(failures ? `${failures}/${SEEDS} tohumda uyuşmazlık` : `${SEEDS}/${SEEDS} tohumda C# çıktısı simülatörle birebir aynı`);
    if (failures) process.exitCode = 1;
    fs.rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await server.close();
}
