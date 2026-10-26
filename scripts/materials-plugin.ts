/// <reference types="node" />
// Dev sunucusu eklentisi (yalnız `npm run dev`; yayın derlemesine girmez): ders_materyalleri/ klasörünü izler, dosyaları
// sınıflandırır (ders, not/soru/kitap, sha256, sayfa sayısı), yeni kitabı kendiliğinden böler ve oyuna sunar. Onaylı
// konuları ve ders analizlerini content/ altına yazar (commit'lenip yayına girsinler). Gemini'yi ÇAĞIRMAZ, anahtar görmez.
//
// Uç noktalar (yalnız localhost; başka kökenden gelen istek reddedilir; yol klasör dışına çıkamaz):
//   GET  /__materials/list            → MaterialsListing
//   GET  /__materials/file?path=…     → listelenmiş dosyanın baytları
//   POST /__materials/approved        → { topic }  onaylı konu → content/library/<ders>/<konu>.json
//   POST /__materials/analysis        → { courseId, analysis | null } → content/analysis/<ders>.json + .md
// Klasör değişince istemciye 'materials:changed' olayı gider.
// src/ modülleri (sınıflandırma, konu ve analiz doğrulaması) çalışma anında Vite'ın kendi yükleyicisiyle alınır; böylece
// yapılandırma dosyası yalnız node ve pdf-lib'e bağlı kalır.

import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { Plugin, ViteDevServer } from 'vite';
import type * as AnalysisMod from '../src/core/analysis.ts';
import type * as LibraryMod from '../src/core/library.ts';
import type * as MatchMod from '../src/pipeline/course-match.ts';
import type { MaterialFile, MaterialsListing } from '../src/pipeline/course-match.ts';
import { MANIFEST, needsSplit, sha256, slug, splitBook, type Manifest } from './book-split.ts';

type Shared = typeof AnalysisMod & typeof LibraryMod & typeof MatchMod;
const MAX_BODY = 5 * 1024 * 1024;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface MaterialsOptions {
  /** Materyal kökü (varsayılan ders_materyalleri; e2e geçici klasör verir). */
  dir?: string;
  /** Onaylı içeriğin yazılacağı content kökü (varsayılan content). */
  contentDir?: string;
}

const posix = (p: string) => p.split(path.sep).join('/');

/** İstek yerel ve aynı kökenden mi (DNS rebinding ve başka sitelerden gelen istekler reddedilir). */
export function isLocalRequest(h: { host?: string; origin?: string; 'sec-fetch-site'?: string }): boolean {
  if (!h.host || !LOCAL.test(h.host)) return false;
  if (h.origin) {
    try {
      if (new URL(h.origin).host !== h.host) return false;
    } catch {
      return false;
    }
  }
  const site = h['sec-fetch-site'];
  return !site || site === 'same-origin' || site === 'none';
}

/** Kökün içinde kalan mutlak yol; dışarı çıkıyorsa null. */
export function inside(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}


export function materialsPlugin(opts: MaterialsOptions = {}): Plugin {
  let root = '';
  let dir = '';
  let contentDir = '';
  const hashCache = new Map<string, { key: string; sha: string; pages: number | null }>();
  const splitting = new Set<string>();
  const warned = new Set<string>();
  let listing: MaterialsListing = { files: [], unmatched: [], ignored: [], splitting: [] };
  let server: ViteDevServer | null = null;
  let courses: { id: string; name: string }[] = [];
  let lib!: Shared;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scanning: Promise<void> | null = null;
  const log = (m: string) => server?.config.logger.info(`[ders_materyalleri] ${m}`, { timestamp: true });

  async function describe(abs: string): Promise<{ sha: string; pages: number | null; bytes: number }> {
    const stat = fs.statSync(abs);
    const key = `${stat.size}:${stat.mtimeMs}`;
    const hit = hashCache.get(abs);
    if (hit?.key === key) return { sha: hit.sha, pages: hit.pages, bytes: stat.size };
    const bytes = new Uint8Array(fs.readFileSync(abs));
    let pages: number | null = null;
    if (/\.pdf$/i.test(abs))
      try {
        pages = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
      } catch {
        pages = null; // bozuk ya da okunamayan PDF: sayfa bilinmiyor (boyut uyarısı devreye girer)
      }
    const sha = sha256(bytes);
    hashCache.set(abs, { key, sha, pages });
    return { sha, pages, bytes: stat.size };
  }

  const walk = (d: string, depth: number, out: string[]) => {
    if (depth > 4 || !fs.existsSync(d)) return out;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs, depth + 1, out);
      else if (e.isFile()) out.push(abs);
    }
    return out;
  };

  async function scan(): Promise<void> {
    const files: MaterialFile[] = [];
    const ignored: string[] = [];
    const unmatched = new Set<string>();
    const manifests = new Map<string, Manifest>();
    for (const abs of walk(dir, 0, [])) {
      const rel = posix(path.relative(dir, abs));
      if (path.basename(abs) === MANIFEST) {
        try {
          manifests.set(posix(path.dirname(rel)), JSON.parse(fs.readFileSync(abs, 'utf8')) as Manifest);
        } catch {
          /* bozuk manifesto: bölümler dosya adıyla listelenir */
        }
        continue;
      }
      const c = lib.classify(rel, courses);
      if (!c) {
        if (!path.basename(abs).startsWith('.')) ignored.push(rel);
        continue;
      }
      if (!c.courseId) unmatched.add(c.courseDir);
      const d = await describe(abs);
      const entry: MaterialFile = { ...c, path: rel, name: lib.topicNameFromFile(rel), bytes: d.bytes, sha256: d.sha, pages: d.pages };
      if (c.kind === 'book') {
        // Kısa kitap not gibi işlenir; uzun kitap bölünür (bölümler not olarak listelenir)
        if (d.pages !== null && !needsSplit(d.pages, d.bytes)) entry.kind = 'notes';
        else void ensureSplit(abs, rel, d.sha);
      }
      files.push(entry);
    }
    // Kitap bölümlerinin adı yer iminin başlığından
    for (const f of files) {
      const m = manifests.get(posix(path.dirname(f.path)));
      const part = m?.parts.find((p) => p.file === path.basename(f.path));
      if (part) f.name = part.title;
    }
    // Eşleşmeyen ama içinde dosya olmayan klasörler de bildirilsin
    if (fs.existsSync(dir))
      for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        if (e.isDirectory() && !e.name.startsWith('.') && !lib.matchCourse(e.name, courses)) unmatched.add(e.name);
    for (const u of unmatched)
      if (!warned.has(u)) {
        warned.add(u);
        server?.config.logger.warn(`[ders_materyalleri] "${u}" klasörü content/courses.json'daki hiçbir dersle eşleşmedi.`);
      }
    files.sort((a, b) => a.path.localeCompare(b.path, 'tr'));
    listing = { files, unmatched: [...unmatched].sort(), ignored: ignored.sort(), splitting: [...splitting].sort() };
  }

  async function ensureSplit(abs: string, rel: string, sha: string): Promise<void> {
    if (splitting.has(rel)) return;
    const outDir = abs.replace(/\.pdf$/i, '');
    try {
      const m = JSON.parse(fs.readFileSync(path.join(outDir, MANIFEST), 'utf8')) as Manifest;
      if (m.sha256 === sha && m.parts.every((p) => fs.existsSync(path.join(outDir, p.file)))) return;
    } catch {
      /* henüz bölünmemiş */
    }
    splitting.add(rel);
    log(`kitap bölünüyor: ${rel}`);
    try {
      const r = await splitBook(abs, log);
      log(`${rel}: ${r.status === 'split' ? `${r.parts} bölüm yazıldı` : r.status === 'small' ? 'kısa, bölünmedi' : 'değişmemiş'}`);
    } catch (e) {
      server?.config.logger.error(`[ders_materyalleri] ${rel} bölünemedi: ${(e as Error).message}`);
    } finally {
      splitting.delete(rel);
      schedule();
    }
  }

  function schedule(): void {
    if (!lib) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh().then(() => server?.ws.send({ type: 'custom', event: 'materials:changed', data: { files: listing.files.length } }));
    }, 400);
  }
  function refresh(): Promise<void> {
    scanning ??= scan().finally(() => (scanning = null));
    return scanning;
  }

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((ok, fail) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          fail(new Error('İstek gövdesi çok büyük.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          fail(new Error('Geçersiz JSON.'));
        }
      });
      req.on('error', fail);
    });

  /** Aynı kaynak dosyanın repo içindeki eski sürümleri (onaylanan yenisiyle değişir). */
  function removeOlder(libDir: string, sourcePath: string, keep: string): void {
    if (!fs.existsSync(libDir)) return;
    for (const f of fs.readdirSync(libDir)) {
      const abs = path.join(libDir, f);
      if (!f.endsWith('.json') || abs === keep) continue;
      try {
        if ((JSON.parse(fs.readFileSync(abs, 'utf8')) as { source?: { path?: string } }).source?.path === sourcePath) fs.rmSync(abs);
      } catch {
        /* okunamayan dosyaya dokunma */
      }
    }
  }

  async function writeApproved(body: unknown): Promise<string> {
    const topic = lib.parseRepoTopic((body as { topic?: unknown })?.topic);
    if (!topic) throw new Error('Geçersiz ya da onaylanmamış konu: onaylanmamış taslak repoya yazılmaz.');
    if (topic.origin !== 'folder' && topic.origin !== 'repo') throw new Error('Yalnız ders_materyalleri/ klasöründen gelen konular repoya yazılır.');
    if (!courses.some((c) => c.id === topic.courseId)) throw new Error(`Bilinmeyen ders: ${topic.courseId}`);
    const libDir = inside(path.join(contentDir, 'library'), topic.courseId);
    if (!libDir) throw new Error('Geçersiz ders kimliği.');
    fs.mkdirSync(libDir, { recursive: true });
    const out = path.join(libDir, `${slug(topic.name)}-${slug(topic.id).slice(-12)}.json`);
    fs.writeFileSync(out, JSON.stringify(lib.toRepoTopic(topic), null, 2) + '\n');
    if (topic.source.path) removeOlder(libDir, topic.source.path, out);
    return posix(path.relative(root, out));
  }

  function writeAnalysis(body: unknown): string | null {
    const b = body as { courseId?: unknown; analysis?: unknown };
    const courseId = typeof b?.courseId === 'string' ? b.courseId : '';
    if (!courses.some((c) => c.id === courseId)) throw new Error(`Bilinmeyen ders: ${courseId}`);
    const base = path.join(contentDir, 'analysis', courseId);
    if (b.analysis === null) {
      fs.rmSync(`${base}.json`, { force: true });
      fs.rmSync(`${base}.md`, { force: true });
      return null;
    }
    const a = lib.parseCourseAnalysis(b.analysis);
    if (!a || a.courseId !== courseId) throw new Error('Geçersiz ders analizi.');
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(`${base}.json`, JSON.stringify(a, null, 2) + '\n');
    fs.writeFileSync(`${base}.md`, lib.analysisMarkdown(a));
    return posix(path.relative(root, `${base}.json`));
  }

  return {
    name: 'derin-muhendis-materials',
    apply: 'serve',
    configResolved(c) {
      root = c.root;
      dir = path.resolve(root, opts.dir ?? process.env.DM_MATERIALS_DIR ?? 'ders_materyalleri');
      contentDir = path.resolve(root, opts.contentDir ?? process.env.DM_CONTENT_DIR ?? 'content');
    },
    configureServer(s) {
      server = s;
      courses = JSON.parse(fs.readFileSync(path.join(root, 'content/courses.json'), 'utf8')) as typeof courses;
      const ready = Promise.all(['/src/core/analysis.ts', '/src/core/library.ts', '/src/pipeline/course-match.ts'].map((m) => s.ssrLoadModule(m))).then((mods) => {
        lib = Object.assign({}, ...mods) as Shared;
      });
      fs.mkdirSync(dir, { recursive: true });
      s.watcher.add(dir);
      s.watcher.on('all', (_ev, file) => {
        if (inside(dir, path.relative(dir, file)) && file !== dir) schedule();
      });
      void ready.then(refresh).then(() => log(`${listing.files.length} dosya izleniyor (${path.relative(root, dir) || '.'})`));
      s.middlewares.use('/__materials', (req, res) => {
        void (async () => {
          await ready;
          if (!isLocalRequest(req.headers as Record<string, string>)) return send(res, 403, { error: 'Yalnız yerel oyun sayfasından.' });
          const url = new URL(req.url ?? '/', 'http://x');
          try {
            if (req.method === 'GET' && url.pathname === '/list') {
              await refresh();
              return send(res, 200, listing);
            }
            if (req.method === 'GET' && url.pathname === '/file') {
              const rel = url.searchParams.get('path') ?? '';
              const f = listing.files.find((x) => x.path === rel);
              const abs = f && inside(dir, rel);
              if (!abs || !fs.existsSync(abs)) return send(res, 404, { error: 'Dosya listede yok.' });
              res.setHeader('content-type', 'application/octet-stream');
              res.setHeader('cache-control', 'no-store');
              return void fs.createReadStream(abs).pipe(res);
            }
            if (req.method === 'POST' && url.pathname === '/approved') return send(res, 200, { written: await writeApproved(await readBody(req)) });
            if (req.method === 'POST' && url.pathname === '/analysis') return send(res, 200, { written: writeAnalysis(await readBody(req)) });
            return send(res, 404, { error: 'Bilinmeyen uç nokta.' });
          } catch (e) {
            return send(res, 400, { error: (e as Error).message });
          }
        })();
      });
    },
  };
}
