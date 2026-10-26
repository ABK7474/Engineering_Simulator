/// <reference types="node" />
// Dev sunucusu eklentisinin güvenlik denetimleri ve kitap bölme (gerçek PDF üretip böler; ağ yok).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, type PDFRef } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { MANIFEST, planParts, readOutline, splitBook, type Manifest } from './book-split';
import { inside, isLocalRequest } from './materials-plugin';

describe('eklenti: yalnız yerel ve aynı kökenden istek, klasör dışına çıkılamaz', () => {
  it('yerel istek', () => {
    expect(isLocalRequest({ host: 'localhost:5173' })).toBe(true);
    expect(isLocalRequest({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' })).toBe(true);
    expect(isLocalRequest({ host: 'kotu.example:5173' })).toBe(false); // DNS rebinding
    expect(isLocalRequest({ host: 'localhost:5173', origin: 'https://kotu.example' })).toBe(false);
    expect(isLocalRequest({ host: 'localhost:5173', 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(isLocalRequest({})).toBe(false);
  });
  it('yol denetimi', () => {
    const root = path.resolve('/tmp/dm-kok');
    expect(inside(root, 'Devre/notlar/a.pdf')).toBe(path.join(root, 'Devre/notlar/a.pdf'));
    expect(inside(root, '../content/x.json')).toBeNull();
    expect(inside(root, '/etc/passwd')).toBeNull();
    expect(inside(path.resolve('/tmp/dm-kok'), '../dm-kok-2/a.pdf')).toBeNull();
  });
});

describe('kitap bölme', () => {
  it('plan: yer imleri bölüm; kısa ön bölümler birleşir; 40 sayfayı aşan bölüm 30\'arlık parçalara', () => {
    const outline = [
      { title: 'Kapak', page: 0 },
      { title: 'İçindekiler', page: 2 },
      { title: 'Bölüm 1', page: 6 },
      { title: 'Bölüm 2', page: 30 },
      { title: 'Dizin', page: 100 },
    ];
    expect(planParts(104, outline).map((p) => `${p.from + 1}-${p.to + 1} ${p.title}`)).toEqual([
      '1-6 Kapak – İçindekiler',
      '7-30 Bölüm 1',
      '31-60 Bölüm 2 (1/3)',
      '61-90 Bölüm 2 (2/3)',
      '91-100 Bölüm 2 (3/3)',
      '101-104 Dizin',
    ]);
  });
  it('plan: yer imi yoksa (ya da tek) 30 sayfalık parçalar', () => {
    expect(planParts(65, []).map((p) => p.title)).toEqual(['Sayfa 1–30', 'Sayfa 31–60', 'Sayfa 61–65']);
    expect(planParts(65, [{ title: 'Tek', page: 0 }])).toHaveLength(3);
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-kitap-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  async function makeBook(pages: number, marks: [string, number][]): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([200, 200]).drawText(`s${i + 1}`, { x: 20, y: 100, size: 12 });
    if (marks.length) {
      const ctx = doc.context;
      const outlinesRef = ctx.nextRef();
      const refs = marks.map(() => ctx.nextRef());
      marks.forEach(([title, page], i) => {
        const item = ctx.obj({ Title: PDFHexString.fromText(title), Parent: outlinesRef, Dest: [doc.getPage(page).ref, PDFName.of('Fit')] });
        if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]);
        if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]);
        ctx.assign(refs[i], item);
      });
      ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: refs[0] as PDFRef, Last: refs.at(-1) as PDFRef, Count: PDFNumber.of(marks.length) }));
      doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
    }
    return doc.save();
  }

  it('yer imlerine göre böler, orijinale dokunmaz, değişmeyen kitabı yeniden bölmez', async () => {
    const book = path.join(tmp, 'ders-kitabi.pdf');
    const bytes = await makeBook(75, [
      ['Giriş', 0],
      ['Seri devreler', 10],
      ['Paralel devreler', 50],
    ]);
    fs.writeFileSync(book, bytes);
    const outline = readOutline(await PDFDocument.load(bytes));
    expect(outline.map((o) => o.page)).toEqual([0, 10, 50]);
    const r = await splitBook(book);
    expect(r).toMatchObject({ status: 'split', parts: 3 });
    const m = JSON.parse(fs.readFileSync(path.join(r.outDir, MANIFEST), 'utf8')) as Manifest;
    expect(m.byOutline).toBe(true);
    expect(m.parts.map((p) => p.file)).toEqual(['1-giris.pdf', '2-seri-devreler.pdf', '3-paralel-devreler.pdf']);
    const second = await PDFDocument.load(fs.readFileSync(path.join(r.outDir, m.parts[1].file)));
    expect(second.getPageCount()).toBe(40);
    expect(second.getTitle()).toBe('Seri devreler');
    expect(fs.readFileSync(book)).toEqual(Buffer.from(bytes));
    expect((await splitBook(book)).status).toBe('unchanged');
  });

  it('yer imi yoksa 30 sayfalık parçalar; kısa kitap bölünmez', async () => {
    const plain = path.join(tmp, 'yer-imsiz.pdf');
    fs.writeFileSync(plain, await makeBook(61, []));
    const r = await splitBook(plain);
    expect(r).toMatchObject({ status: 'split', parts: 3 });
    const short = path.join(tmp, 'kisa.pdf');
    fs.writeFileSync(short, await makeBook(12, []));
    expect((await splitBook(short)).status).toBe('small');
    expect(fs.existsSync(short.replace(/\.pdf$/, ''))).toBe(false);
  });
});
