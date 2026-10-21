// Geliştirici betiği: `npm run gen:cs`. content/cs-output/templates.json'daki elle yazılmış C# şablonlarını açar;
// her örneği ve her yanılgı yamasını GERÇEK derleyiciyle (dotnet) bir kez çalıştırıp çıktıları
// content/generated/cs-output.json'a yazar. Oyun derleyici çalıştırmaz, bu dosyayı okur.
// Elenenler: istisnayla biten, 2–8 satır dışında kalan, bir yanılgısı doğru çıktıyla aynı olan örnekler.
// Kod yalnız elle yazılmış şablonlardan gelir; geçici klasörde, zaman sınırıyla, invariant kültürle çalışır.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PER_TEMPLATE = 24;
const TIMEOUT_MS = 300_000;

const probe = spawnSync('dotnet', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.error('dotnet bulunamadı: C# çıktıları üretilemez. Kayıtlı content/generated/cs-output.json değiştirilmedi.');
  process.exit(1);
}
const version = probe.stdout.trim();

const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  const { expand, render, hashCode } = await server.ssrLoadModule('/src/solvers/cs/cs-output.ts');
  const { templates } = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/cs-output/templates.json'), 'utf8'));

  const jobs = []; // { key, template, params, mis, code }
  for (const t of templates) {
    const all = expand(t);
    const step = Math.max(1, Math.floor(all.length / PER_TEMPLATE));
    const chosen = all.filter((_, k) => k % step === 0).slice(0, PER_TEMPLATE);
    for (const params of chosen) {
      jobs.push({ key: jobs.length, template: t.id, params, mis: null, code: render(t, params) });
      for (const m of t.misconceptions) jobs.push({ key: jobs.length, template: t.id, params, mis: m.id, code: render(t, params, m.id) });
    }
  }

  const ns = jobs.map((j) => `// ${j.template}${j.mis ? ' / ' + j.mis : ''} ${JSON.stringify(j.params)}\nnamespace N${j.key}\n{\n${j.code.map((l) => '    ' + l).join('\n')}\n}`);
  const source = `#nullable disable
using System;
using System.Globalization;
using System.Reflection;

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
var keys = new[] { ${jobs.map((j) => j.key).join(', ')} };
foreach (int k in keys)
{
    Console.WriteLine("@" + k);
    try
    {
        var t = Type.GetType("N" + k + ".Program");
        t.GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public).Invoke(null, null);
    }
    catch (Exception e) { Console.WriteLine("!" + (e.InnerException ?? e).GetType().Name); }
}

${ns.join('\n\n')}
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derin-gen-cs-'));
  const file = path.join(dir, 'gen.cs');
  fs.writeFileSync(file, source);
  console.log(`dotnet ${version} · ${jobs.length} program derleniyor: ${file}`);
  const run = spawnSync('dotnet', ['run', file], { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  if (run.error || run.status !== 0) {
    console.error('dotnet çalıştırılamadı:', run.error?.message ?? '', (run.stderr || run.stdout).slice(0, 4000));
    process.exit(1);
  }
  const out = new Map();
  let cur = null;
  for (const line of run.stdout.split(/\r?\n/)) {
    if (/^@\d+$/.test(line)) out.set((cur = Number(line.slice(1))), []);
    else if (cur !== null) out.get(cur).push(line);
  }
  const trim = (a) => {
    const b = a.map((l) => l.trimEnd());
    while (b.length && b[b.length - 1] === '') b.pop();
    return b;
  };
  const instances = [];
  const rejected = new Map();
  const reject = (why) => rejected.set(why, (rejected.get(why) ?? 0) + 1);
  for (const j of jobs.filter((x) => !x.mis)) {
    const output = trim(out.get(j.key) ?? []);
    if (output.some((l) => l.startsWith('!'))) { reject(`${j.template}: istisna`); continue; }
    if (output.length < 2 || output.length > 8) { reject(`${j.template}: ${output.length} satır`); continue; }
    const mis = jobs.filter((x) => x.mis && x.template === j.template && JSON.stringify(x.params) === JSON.stringify(j.params)).map((x) => ({ id: x.mis, output: trim(out.get(x.key) ?? []) }));
    if (mis.some((m) => m.output.some((l) => l.startsWith('!')))) { reject(`${j.template}: yanılgı istisnayla bitti`); continue; }
    if (mis.some((m) => JSON.stringify(m.output) === JSON.stringify(output))) { reject(`${j.template}: yanılgı aynı çıktıyı veriyor`); continue; }
    instances.push({ template: j.template, params: j.params, hash: hashCode(j.code), output, misconceptions: mis });
  }
  for (const t of templates) {
    const n = instances.filter((i) => i.template === t.id).length;
    console.log(`${t.id}: ${n} örnek`);
    if (!n) { console.error(`HATA: ${t.id} için geçerli örnek yok`); process.exitCode = 1; }
  }
  for (const [why, n] of rejected) console.log(`elendi: ${why} (${n})`);
  if (!process.exitCode) {
    fs.mkdirSync(path.join(ROOT, 'content/generated'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'content/generated/cs-output.json'), JSON.stringify({ dotnet: version, instances }, null, 1) + '\n');
    console.log(`yazıldı: content/generated/cs-output.json (${instances.length} örnek)`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
} finally {
  await server.close();
}
