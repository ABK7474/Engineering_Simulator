// ders_materyalleri/ uçtan uca (anahtarsız, sahte istemci; `npm test`e girmez): `npm run e2e:materials`.
// Geçici bir materyal klasörü ve geçici content/ ile dev sunucusunu açar (gerçek klasörlere dokunmaz):
//   notlar (biri "kota" adıyla ilk istekte 429 verir), uzun PDF (kendiliğinden gönderilmez), soru PDF'leri, yer imsiz
//   bir kitap (kendiliğinden bölünür), eşleşmeyen bir ders klasörü.
// Denetler: kuyruk 429'da bekler ve "Şimdi dene" ile sürer, hafif model önerilir; taslaklar "onay bekliyor"; ders analizi
// dosya başına yapılıp birleşir ve repoya yazılır; onay → konu repoya yazılır (kitap bölümünde tam .md yok), onaysız
// taslak yazılmaz; formül sayfası defterde (HTML yorumlanmadan); sayfa yenilenince aynı dosyalar yeniden işlenmez;
// değişen dosya yeniden işlenir; silinen soru dosyası analizden çıkar; konsol temiz.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5214;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-e2e-materials-'));
const MAT = path.join(TMP, 'materyal');
const OUT = path.join(TMP, 'content');
process.env.DM_MATERIALS_DIR = MAT;
process.env.DM_CONTENT_DIR = OUT;

async function pdf(file, pages, label = '') {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]).drawText(`${label} s${i + 1}`, { x: 20, y: 100, size: 10 });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await doc.save());
}
const D = path.join(MAT, 'Devre Teorisi 1');
await pdf(path.join(D, 'notlar', 'seri-devreler.pdf'), 3, 'seri');
await pdf(path.join(D, 'notlar', 'kota-thevenin.pdf'), 2, 'kota');
await pdf(path.join(D, 'notlar', 'uzun.pdf'), 45, 'uzun');
await pdf(path.join(D, 'Ornek_Sorular', 'vize.pdf'), 2, 'vize');
await pdf(path.join(D, 'Ornek_Sorular', 'final.pdf'), 2, 'final');
await pdf(path.join(D, 'kitaplar', 'kitap.pdf'), 70, 'kitap');
await pdf(path.join(MAT, 'Kimya', 'notlar', 'asit.pdf'), 1, 'kimya');

const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: PORT, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 1_200_000,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && !/WebGL|GPU stall|swiftshader/i.test(m.text()) && errors.push(`${m.type()}: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('HATA:', msg);
};
const ok = (cond, msg) => (cond ? console.log(`  ✓ ${msg}`) : fail(msg));
async function until(fn, what, ms = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await ev(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) {
      fail(`zaman aşımı: ${what}`);
      return null;
    }
    await sleep(400);
  }
}
const view = () => ev(() => window.__dm.materials.view());
const summary = (v) => v.items.map((i) => `${i.file.path.split('/').slice(1).join('/')}=${i.status}`).join(', ');
const repoFiles = (sub) => (fs.existsSync(path.join(OUT, sub)) ? fs.readdirSync(path.join(OUT, sub), { recursive: true }).filter((f) => String(f).endsWith('.json')) : []);
const closeOverlays = () => ev(() => document.querySelectorAll('#ui .overlay [data-act="close"]').forEach((b) => b.click()));

async function openGame() {
  await page.goto(`http://localhost:${PORT}/?llm=mock&prologue=skip&seed=7`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.waitForFunction(() => document.querySelector('.gate-action')?.textContent === 'Tıkla ve başla', { timeout: 600_000 });
  await page.click('.gate h1');
  await page.waitForFunction(() => window.__dm?.hub.isRoaming() || document.querySelector('.subtitle'), { timeout: 60_000 });
}

try {
  console.log('1) Açılış: kuyruk kendiliğinden işler; 429 bekletir');
  await openGame();
  const quota = await until(() => window.__dm.materials.view().phase === 'quota' && window.__dm.materials.view(), 'kota beklemesi');
  if (quota) {
    ok(/Kota doldu: \d+ dosya bekliyor/.test(quota.message), `kota mesajı: ${quota.message.slice(0, 60)}…`);
    ok(quota.suggestModel === 'gemini-3.5-flash-lite', 'hafif model önerisi: gemini-3.5-flash-lite');
    ok(quota.resumeAt - Date.now() > 30_000, 'ilk bekleme ~60 sn');
    const status = await ev(() => document.querySelector('.materials-status')?.textContent ?? '');
    ok(/kota doldu/.test(status), `durum satırı: ${status}`);
    await ev(() => window.__dm.materials.openLibrary('folder'));
    await page.waitForSelector('.library [data-act="retry"]');
    const modelBtn = await ev(() => document.querySelector('.library [data-model]')?.textContent ?? '');
    ok(modelBtn.includes('gemini-3.5-flash-lite'), `Klasör sekmesinde model düğmesi: ${modelBtn}`);
    await ev(() => document.querySelector('.library [data-act="retry"]').click());
  }
  const settled = await until(() => {
    const v = window.__dm.materials.view();
    return v.phase === 'idle' && v.listing.splitting.length === 0 && v.items.some((i) => i.file.path.includes('/kitap/')) && !v.items.some((i) => ['pending', 'working'].includes(i.status)) && v;
  }, 'kuyruk bitişi');
  if (settled) {
    console.log(`  durum: ${summary(settled)}`);
    const st = Object.fromEntries(settled.items.map((i) => [i.file.path, i.status]));
    ok(st['Devre Teorisi 1/notlar/uzun.pdf'] === 'long', 'uzun PDF kendiliğinden gönderilmedi');
    ok(st['Kimya/notlar/asit.pdf'] === 'no-course' && settled.listing.unmatched.includes('Kimya'), 'eşleşmeyen klasör bildirildi');
    ok(st['Devre Teorisi 1/kitaplar/kitap.pdf'] === 'book', 'kitabın kendisi işlenmedi');
    ok(settled.items.filter((i) => i.file.path.includes('/kitaplar/kitap/') && i.status === 'done').length === 3, 'kitap 3 bölüme ayrıldı, bölümler not olarak işlendi');
    ok(fs.existsSync(path.join(D, 'kitaplar', 'kitap.pdf')), 'orijinal kitap yerinde');
  }
  const folderText = await ev(() => document.querySelector('.library')?.textContent ?? '');
  ok(folderText.includes('"Kimya" klasörü hiçbir dersle eşleşmedi'), 'Klasör sekmesinde eşleşmeyen klasör uyarısı');

  console.log('2) Taslaklar ve ders analizi');
  const lib = await ev(() => window.__dm.library());
  const drafts = lib.topics.filter((t) => t.origin === 'folder' && t.status === 'draft');
  ok(drafts.length === 5, `5 taslak onay bekliyor (${drafts.map((t) => t.name).join(', ')})`);
  ok(repoFiles('library').length === 0, 'onaylanmamış taslak repoya yazılmadı');
  const an = (await ev(() => window.__dm.materials.analyses())).find((a) => a.courseId === 'devre-teorisi-1');
  ok(an?.files.length === 2 && an.merged.questionCount === 7, `analiz: ${an?.files.length} dosya, ${an?.merged.questionCount} soru`);
  ok(an?.merged.recommendations[0]?.name === 'Bağımlı kaynak türü', `ilk öneri: ${an?.merged.recommendations[0]?.name}`);
  ok(fs.existsSync(path.join(OUT, 'analysis', 'devre-teorisi-1.json')) && fs.readFileSync(path.join(OUT, 'analysis', 'devre-teorisi-1.md'), 'utf8').includes('# Ders analizi: Devre Teorisi 1'), 'analiz repoya .json ve .md yazıldı');
  const calls = await ev(() => window.__dm.materials.calls());
  ok(calls.filter((c) => c.kind === 'analysis').length === 2, 'soru dosyaları ayrı ayrı analiz edildi (2 istek)');
  await ev(() => document.querySelector('.library [data-tab="analysis"]').click());
  const anHtml = await ev(() => document.querySelector('.library .lib-body').innerHTML);
  ok(anHtml.includes('Bağımlı kaynak türü') && anHtml.includes('&lt;b&gt;Süper düğüm&lt;/b&gt;'), 'Ders analizi sayfası; LLM metni HTML olarak yorumlanmadı');

  console.log('3) Onay: repoya yazılır; formül sayfası defterde');
  await ev(() => document.querySelector('.library [data-tab="topics"]').click());
  const listText = await ev(() => document.querySelector('.library .topic-list').textContent);
  ok(listText.includes('Yeni taslak: onay bekliyor'), 'kütüphanede "Yeni taslak: onay bekliyor"');
  const approve = async (name, generate) => {
    const id = (await ev(() => window.__dm.library())).topics.find((t) => t.name === name && t.status === 'draft').id;
    await ev((x) => document.querySelector(`.library [data-review="${x}"]`).click(), id);
    await page.waitForSelector('.topic-flow [data-act="approve"]');
    const formulas = await ev(() => document.querySelector('.topic-flow [name="formulas"]').value);
    ok(formulas.includes('$R_{eş} = R_1 + R_2$'), `${name}: formül sayfası taslağı incelemede`);
    await ev(() => document.querySelector('.topic-flow [data-act="approve"]').click());
    if (generate) {
      await page.waitForSelector('.topic-flow [data-act="gen"]');
      await ev(() => document.querySelector('.topic-flow [data-act="gen"]').click());
      await page.waitForFunction(() => document.querySelector('.topic-flow .report-total'), { timeout: 60_000 });
    }
    await page.waitForSelector('.topic-flow [data-act="close"]');
    await ev(() => document.querySelector('.topic-flow [data-act="close"]').click());
    await sleep(300);
  };
  await approve('Seri devreler', true);
  await approve('Sayfa 1–30', false);
  const written = repoFiles('library');
  ok(written.length === 2, `repoya 2 onaylı konu yazıldı (${written.join(', ')})`);
  const repoT = written.map((f) => JSON.parse(fs.readFileSync(path.join(OUT, 'library', f), 'utf8')));
  const seri = repoT.find((t) => t.name === 'Seri devreler');
  const part = repoT.find((t) => t.name === 'Sayfa 1–30');
  ok(seri?.status === 'approved' && seri.templates.length === 3 && seri.markdown.length > 0, 'not: onaylı, şablonlarıyla, tam .md');
  ok(part?.markdown === '' && part.formulaSheet.length > 0, 'kitap bölümü: tam .md repoya yazılmadı, formül sayfası var');
  ok(!JSON.stringify(repoT).match(/apiKey|AIza/), 'repo dosyasında anahtar yok');
  await closeOverlays();
  await sleep(500);
  await ev(() => window.__dm.setClassicHud(true));
  await ev(() => [...document.querySelectorAll('.backup-menu [data-item]')].find((b) => b.textContent.startsWith('Defter')).click());
  await page.waitForSelector('.notebook');
  await ev(() => document.querySelector('.notebook [data-tab="formulas"]').click());
  const sheet = await ev(() => ({ text: [...document.querySelectorAll('.notebook .nb-sheet')].map((x) => x.textContent).join(' | '), img: !!document.querySelector('.notebook .nb-sheet img') }));
  ok(sheet.text.includes('Seri devreler') && sheet.text.includes('Sayfa 1–30') && sheet.text.includes('konu sayfası'), 'defter → Formüller: onaylı iki konunun sayfası');
  ok(!sheet.img, 'formül sayfasındaki HTML yorumlanmadı');
  await closeOverlays();

  console.log('4) Yeniden açılış: aynı dosyalar yeniden işlenmez');
  await openGame();
  await sleep(4000);
  await until(() => window.__dm.materials.view().items.length > 0 && !window.__dm.materials.view().items.some((i) => ['pending', 'working'].includes(i.status)), 'liste');
  const again = await ev(() => window.__dm.materials.calls());
  ok(again.length === 0, `yeniden açılışta LLM isteği yok (${again.length})`);

  console.log('5) Değişen dosya yeniden işlenir; silinen soru dosyası analizden çıkar');
  await pdf(path.join(D, 'notlar', 'seri-devreler.pdf'), 4, 'seri-v2');
  fs.rmSync(path.join(D, 'Ornek_Sorular', 'final.pdf'));
  await until(() => window.__dm.materials.calls().some((c) => c.kind === 'markdown' && c.name === 'Seri devreler'), 'değişen dosyanın yeniden işlenmesi', 60_000);
  await until(() => window.__dm.materials.analyses().find((a) => a.courseId === 'devre-teorisi-1')?.files.length === 1, 'analizin yeniden birleşmesi', 60_000);
  const lib2 = await ev(() => window.__dm.library());
  const seriAll = lib2.topics.filter((t) => t.source.path === 'Devre Teorisi 1/notlar/seri-devreler.pdf').map((t) => t.status).sort();
  ok(JSON.stringify(seriAll) === '["approved","draft"]', `onaylı sürüm kalır, yeni taslak gelir (${seriAll})`);
  const anFile = JSON.parse(fs.readFileSync(path.join(OUT, 'analysis', 'devre-teorisi-1.json'), 'utf8'));
  ok(anFile.files.length === 1, 'repodaki analiz de güncellendi');
  const again2 = await ev(() => window.__dm.materials.calls());
  ok(again2.filter((c) => c.kind === 'analysis').length === 0, 'kalan soru dosyası yeniden analiz edilmedi (birleşim kodla)');

  const errs = errors.filter((e) => !/favicon/.test(e));
  ok(errs.length === 0, `konsol temiz${errs.length ? `: ${errs.slice(0, 5).join(' | ')}` : ''}`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(failed ? 'e2e:materials BAŞARISIZ' : 'e2e:materials tamam');
process.exit(failed ? 1 : 0);
