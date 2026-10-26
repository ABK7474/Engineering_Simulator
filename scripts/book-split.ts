/// <reference types="node" />
// Kitap bölme (`npm run kitap:bol`; dev sunucusu yeni kitap görünce kendiliğinden çağırır). ders_materyalleri/<ders>/kitaplar/
// altındaki uzun PDF'i (40 sayfa ya da 15 MB üstü) yer imlerine (outline) göre bölümlere ayırır; yer imi yoksa 30 sayfalık
// parçalara. Bölümler kitaplar/<kitap>/ altına yazılır (git dışında), orijinal dosyaya dokunulmaz. Kitap değişmediyse
// (_bolumler.json'daki sha256 aynı) yeniden bölünmez. 40 sayfayı aşan bölüm ayrıca 30 sayfalık parçalara ayrılır.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, type PDFObject } from 'pdf-lib';

export const LONG_PAGES = 40;
export const LONG_BYTES = 15 * 1024 * 1024;
export const CHUNK_PAGES = 30;
export const MANIFEST = '_bolumler.json';

export interface OutlineEntry {
  title: string;
  /** 0 tabanlı sayfa. */
  page: number;
}
export interface PartPlan {
  title: string;
  /** 0 tabanlı, ikisi de dahil. */
  from: number;
  to: number;
}
export interface Manifest {
  source: string;
  sha256: string;
  pages: number;
  byOutline: boolean;
  parts: (PartPlan & { file: string })[];
}

export const needsSplit = (pages: number, bytes: number) => pages > LONG_PAGES || bytes > LONG_BYTES;

const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText().trim() : '');

/** Adlandırılmış hedef: eski /Dests sözlüğü ya da /Names → /Dests ad ağacı. */
function namedDest(doc: PDFDocument, name: string): PDFObject | undefined {
  const cat = doc.catalog;
  const old = cat.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (old) {
    const d = old.lookup(PDFName.of(name));
    if (d) return d;
  }
  const tree = cat.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const walk = (node: PDFDict | undefined, depth: number): PDFObject | undefined => {
    if (!node || depth > 32) return undefined;
    const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (names)
      for (let i = 0; i + 1 < names.size(); i += 2) if (text(names.lookup(i)) === name) return names.lookup(i + 1);
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids)
      for (let i = 0; i < kids.size(); i++) {
        const hit = walk(kids.lookupMaybe(i, PDFDict), depth + 1);
        if (hit) return hit;
      }
    return undefined;
  };
  return walk(tree, 0);
}

/** Yer iminin hedef sayfası (0 tabanlı) ya da bulunamazsa -1. */
function destPage(doc: PDFDocument, item: PDFDict, pageIndex: Map<string, number>): number {
  let dest: PDFObject | undefined = item.lookup(PDFName.of('Dest'));
  if (!dest) dest = item.lookupMaybe(PDFName.of('A'), PDFDict)?.lookup(PDFName.of('D'));
  for (let k = 0; k < 3 && dest; k++) {
    if (dest instanceof PDFString || dest instanceof PDFHexString) dest = namedDest(doc, dest.decodeText());
    else if (dest instanceof PDFName) dest = namedDest(doc, dest.decodeText());
    else if (dest instanceof PDFDict) dest = dest.lookup(PDFName.of('D'));
    else break;
  }
  if (!(dest instanceof PDFArray) || dest.size() === 0) return -1;
  const ref = dest.get(0);
  return ref instanceof PDFRef ? (pageIndex.get(ref.toString()) ?? -1) : -1;
}

/** En üst düzey yer imleri (bölümler), sayfa sırasıyla; hedefi bulunamayanlar atlanır. */
export function readOutline(doc: PDFDocument): OutlineEntry[] {
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!outlines) return [];
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const out: OutlineEntry[] = [];
  let item = outlines.lookupMaybe(PDFName.of('First'), PDFDict);
  for (let guard = 0; item && guard < 2000; guard++) {
    const page = destPage(doc, item, pageIndex);
    const title = text(item.lookup(PDFName.of('Title')));
    if (page >= 0 && title) out.push({ title, page });
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return out.sort((a, b) => a.page - b.page);
}

function chunks(title: string, from: number, to: number, size: number): PartPlan[] {
  const n = Math.ceil((to - from + 1) / size);
  if (n <= 1) return [{ title, from, to }];
  return Array.from({ length: n }, (_, k) => ({ title: `${title} (${k + 1}/${n})`, from: from + k * size, to: Math.min(to, from + (k + 1) * size - 1) }));
}

/**
 * Bölüm planı. Yer imleri en az iki farklı sayfayı gösteriyorsa her yer imi bir bölüm (ilk yer iminden önceki sayfalar
 * "Ön kısım"); 40 sayfayı aşan bölüm 30'arlık parçalara. Yoksa düz 30 sayfalık parçalar.
 */
export function planParts(pages: number, outline: readonly OutlineEntry[], chunk = CHUNK_PAGES, max = LONG_PAGES): PartPlan[] {
  const starts = outline.filter((e, i) => e.page < pages && (i === 0 || e.page !== outline[i - 1].page));
  if (starts.length < 2) return chunks('Sayfa', 0, pages - 1, chunk).map((p) => ({ ...p, title: `Sayfa ${p.from + 1}–${p.to + 1}` }));
  const sections: PartPlan[] = [];
  if (starts[0].page > 0) sections.push({ title: 'Ön kısım', from: 0, to: starts[0].page - 1 });
  starts.forEach((e, i) => sections.push({ title: e.title, from: e.page, to: (starts[i + 1]?.page ?? pages) - 1 }));
  return mergeShort(sections).flatMap((s) => (s.to - s.from + 1 > max ? chunks(s.title, s.from, s.to, chunk) : [s]));
}

/** Ardışık kısa bölümler (kapak, telif, içindekiler, dizin…) tek parçada: her biri ayrı istek olup kota yemesin. */
export const SHORT_SECTION = 8;
function mergeShort(sections: PartPlan[]): PartPlan[] {
  const out: (PartPlan & { last: string; short: boolean })[] = [];
  for (const s of sections) {
    const short = s.to - s.from + 1 < SHORT_SECTION;
    const prev = out.at(-1);
    if (short && prev?.short && prev.to - prev.from + 1 < LONG_PAGES) Object.assign(prev, { to: s.to, last: s.title });
    else out.push({ ...s, last: s.title, short });
  }
  return out.map(({ title, last, from, to }) => ({ title: last === title ? title : `${title} – ${last}`, from, to }));
}

export const slug = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c]!)
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'bolum';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export type SplitResult = { status: 'split' | 'unchanged' | 'small'; outDir: string; parts: number };

/** Kitabı böler; bölümler kitabın yanındaki aynı adlı klasöre yazılır. */
export async function splitBook(bookPath: string, log: (m: string) => void = () => {}): Promise<SplitResult> {
  const bytes = new Uint8Array(fs.readFileSync(bookPath));
  const outDir = path.join(path.dirname(bookPath), path.basename(bookPath, path.extname(bookPath)));
  const hash = sha256(bytes);
  const manifestPath = path.join(outDir, MANIFEST);
  let old: Manifest | null = null;
  try {
    old = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch {
    old = null;
  }
  if (old?.sha256 === hash && old.parts.every((p) => fs.existsSync(path.join(outDir, p.file)))) return { status: 'unchanged', outDir, parts: old.parts.length };
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = src.getPageCount();
  if (!needsSplit(pages, bytes.byteLength)) return { status: 'small', outDir, parts: 0 };
  const outline = readOutline(src);
  const plan = planParts(pages, outline);
  log(`${path.basename(bookPath)}: ${pages} sayfa, ${outline.length ? `${outline.length} yer imi` : 'yer imi yok'} → ${plan.length} bölüm`);
  fs.mkdirSync(outDir, { recursive: true });
  const width = String(plan.length).length;
  const parts: Manifest['parts'] = [];
  for (const [i, p] of plan.entries()) {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, Array.from({ length: p.to - p.from + 1 }, (_, k) => p.from + k));
    copied.forEach((pg) => doc.addPage(pg));
    doc.setTitle(p.title);
    const file = `${String(i + 1).padStart(width, '0')}-${slug(p.title)}.pdf`;
    fs.writeFileSync(path.join(outDir, file), await doc.save());
    parts.push({ ...p, file });
  }
  // Eski bölümlerden artık plan dışında kalanlar silinir (yalnız bizim yazdıklarımız).
  for (const f of old?.parts ?? []) if (!parts.some((p) => p.file === f.file)) fs.rmSync(path.join(outDir, f.file), { force: true });
  const manifest: Manifest = { source: path.basename(bookPath), sha256: hash, pages, byOutline: outline.length >= 2, parts };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { status: 'split', outDir, parts: parts.length };
}

/** ders_materyalleri/<ders>/kitaplar/*.pdf (bölüm klasörlerinin içi hariç). */
export function findBooks(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  for (const course of fs.readdirSync(root, { withFileTypes: true })) {
    if (!course.isDirectory()) continue;
    for (const sub of fs.readdirSync(path.join(root, course.name), { withFileTypes: true })) {
      if (!sub.isDirectory() || slug(sub.name) !== 'kitaplar') continue;
      const dir = path.join(root, course.name, sub.name);
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) if (f.isFile() && /\.pdf$/i.test(f.name)) out.push(path.join(dir, f.name));
    }
  }
  return out;
}

// Komut satırı: npm run kitap:bol [kitap.pdf ...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(process.env.DM_MATERIALS_DIR ?? 'ders_materyalleri');
  const books = process.argv.length > 2 ? process.argv.slice(2).map((p) => path.resolve(p)) : findBooks(root);
  if (!books.length) console.log(`Kitap yok: ${path.relative(process.cwd(), root)}/<ders>/kitaplar/*.pdf`);
  for (const b of books) {
    const r = await splitBook(b, console.log);
    const where = path.relative(process.cwd(), r.outDir);
    console.log(r.status === 'small' ? `${path.basename(b)}: kısa, bölünmedi (not gibi işlenir)` : r.status === 'unchanged' ? `${path.basename(b)}: değişmemiş, ${r.parts} bölüm ${where}` : `${path.basename(b)}: ${r.parts} bölüm → ${where}`);
  }
}
