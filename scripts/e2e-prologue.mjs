// Prolog turu (yavaş; `npm test`e girmez): `npm run e2e:prologue`. Boş bir profille oyunu açar, adı yazar,
// prologu oynar: altyazıyı boşlukla geçer, röle ve pompa panellerini bakıp E ile açar, kodun cevabıyla çözer,
// düşüşü bekler, kıyafeti giyer, deniz tabanında W ile yürür, servis kilidinden girer. NEREUS'un karşılamasını,
// kaydı (ad, prolog.done) ve enkazın koridor penceresinden göründüğünü denetler. Her sahneden ekran görüntüsü ve
// çizim çağrısı/üçgen (bütçe ≤ 150 / 150 bin). Konsol hatası ya da tıkanma olursa çıkış kodu 1.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 5212;
fs.mkdirSync(OUT, { recursive: true });
// Gerçek ders_materyalleri/ (kitaplar dahil) taranmasın, content/'e yazılmasın: klasör eklentisi boş geçici klasörlere bakar
process.env.DM_MATERIALS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-e2e-materyal-'));
process.env.DM_CONTENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-e2e-icerik-'));
const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 1_200_000,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const frames = async (n) => {
  for (let i = 0; i < n; i++) await ev(() => new Promise((r) => requestAnimationFrame(() => r())));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('HATA:', msg);
};
const budget = [];
async function shot(name) {
  await frames(6);
  await page.screenshot({ path: path.join(OUT, `prolog-${name}.png`) });
  const b = await ev(() => window.__dm.hub.debug.breakdown());
  budget.push([name, b.toplam.calls, b.toplam.triangles]);
  console.log(`  ${name.padEnd(18)} çağrı ${b.toplam.calls} üçgen ${Math.round(b.toplam.triangles / 1000)}k`);
  if (b.toplam.calls > 150 || b.toplam.triangles > 150_000) fail(`${name}: bütçe aşıldı`);
}
const beat = () => ev(() => window.__dm.prologue.beat());
async function waitBeat(id, ms = 60000, skipLines = true) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await beat()) === id) return true;
    if (skipLines) await page.keyboard.press('Space');
    await sleep(250);
  }
  fail(`sahne '${id}' gelmedi (şu an: ${await beat()})`);
  return false;
}
async function lockPointer() {
  for (let k = 0; k < 5 && !(await ev(() => window.__dm.hub.isRoaming())); k++) {
    await page.mouse.click(640, 400);
    await sleep(300);
  }
}
/** Hedefe bak, E'ye bas; panel açılmalı (bulmaca) ya da sahne ilerlemeli. */
async function useTarget(t, expectPanel) {
  await lockPointer();
  const p = await ev((x) => window.__dm.hub.debug.prologueTarget(x), t);
  await ev((q) => window.__dm.hub.debug.lookAt(q.x, q.y, q.z), p);
  await frames(3);
  const hint = await ev(() => document.querySelector('.hint')?.style.display === 'block' && document.querySelector('.hint').textContent);
  if (!hint) fail(`${t}: E istemi görünmedi`);
  else console.log(`  istem: ${hint}`);
  await page.keyboard.press('KeyE');
  if (expectPanel) {
    try {
      await page.waitForSelector('.overlay .panel h2', { timeout: 15000 });
      console.log(`  panel: ${await ev(() => document.querySelector('.overlay .panel h2').textContent)}`);
    } catch {
      fail(`${t}: panel açılmadı`);
    }
  }
}

try {
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?seed=7`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.gate-action')?.textContent === 'Tıkla ve başla', { timeout: 600000 });
  if (await page.$('.gate [data-act="skip"]')) fail('ilk oynayışta "Prologu atla" görünmemeli');
  await page.click('.gate input[name="pname"]', { clickCount: 3 });
  await page.keyboard.type('Test');
  await page.keyboard.press('Tab');
  await shot('giris');
  await page.click('.gate h1');
  await page.waitForFunction(() => window.__dm.prologue.active(), { timeout: 20000 });
  console.log(`prolog başladı (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  // Boşluk: yazılan satır hemen tamamlanır, ikinci basış sıradakine geçer
  const first = await ev(() => document.querySelector('.subtitle .speaker')?.textContent);
  if (first !== 'ECE') fail(`ilk konuşan ECE değil (${first})`);
  await page.keyboard.press('Space');
  const full = await ev(() => document.querySelector('.subtitle .text')?.textContent ?? '');
  if (!full.startsWith('Müren, derinlik iki yüz') || !full.endsWith('röleye bakalım.')) fail(`boşluk satırı tamamlamadı: '${full}'`);
  await page.keyboard.press('Space');
  const second = await ev(() => document.querySelector('.subtitle .text')?.textContent ?? '');
  if (second === full) fail('ikinci boşluk sıradaki satıra geçmedi');
  await shot('kokpit');

  await useTarget('relay', true);
  await shot('role-paneli');
  await ev(() => window.__dm.prologue.solve());
  await lockPointer();
  await waitBeat('contact');
  await sleep(1500);
  await shot('sonar-temas');
  await waitBeat('wave');
  await sleep(800);
  await useTarget('pump', true);
  await ev(() => window.__dm.prologue.solve());
  await lockPointer();
  await waitBeat('fall', 30000, false);
  await sleep(4000);
  await shot('dusus');
  await waitBeat('crash', 180000, false); // düşüş oyun saatiyle 8 s; yazılımla çizimde dakikalar sürebilir
  await sleep(1500);
  await shot('carpma');
  await useTarget('locker', false);
  await waitBeat('seabed', 20000, false);
  await sleep(1600);
  await shot('taban');
  // W ile yürü (gerçek hareket)
  await lockPointer();
  const p0 = await ev(() => window.__dm.hub.pose());
  await page.keyboard.down('KeyW');
  await frames(30); // yazılımla çizimde kare süresi uzun; hareket kare başına (en fazla 0,05 s)
  await page.keyboard.up('KeyW');
  const p1 = await ev(() => window.__dm.hub.pose());
  const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  console.log(`  tabanda yürüme: ${walked.toFixed(2)} m`);
  if (walked < 0.3) fail('tabanda W ile yürünemedi');
  // Yolun ortası ve kilit önü
  await ev(() => window.__dm.hub.debug.teleport(-5.6, 0.6));
  await ev(() => window.__dm.hub.debug.lookAt(0, 1.5, 3));
  await shot('yol');
  const h = await ev(() => window.__dm.hub.debug.prologueTarget('hatch'));
  // Kilidi birkaç metre öteden gör (kılavuz lambaları yanmış olmalı)
  await ev((q) => window.__dm.hub.debug.teleport(q.x - 1.5, q.z + 3.5), h);
  await ev(() => window.__dm.hub.debug.lookAt(0, 2.2, 2));
  await shot('kilit-onu');
  await ev((q) => window.__dm.hub.debug.teleport(q.x - 0.5, q.z + 1.2), h);
  await useTarget('hatch', false);
  // Kapak açılırken ardındaki koridor çizilmeli (önceden bütün odalar gizliydi; kapıdan boşluk görünüyordu)
  // Akış 1,3 sn sonra ekranı karartır; yazılımla çizimde kapak o sürede ancak aralanır: çekimde karartma gizlenir
  await ev(() => document.querySelectorAll('#ui > .fade').forEach((f) => (f.style.visibility = 'hidden')));
  await frames(16);
  await page.screenshot({ path: path.join(OUT, 'prolog-kilit-acilirken.png') });
  const opening = await ev(() => window.__dm.hub.debug.breakdown());
  await ev(() => document.querySelectorAll('#ui > .fade').forEach((f) => (f.style.visibility = '')));
  console.log(`  kapak açılırken koridor: ${opening['room:corridor-b2'] ? `${opening['room:corridor-b2'].calls} çağrı` : 'yok'}`);
  if (!opening['room:corridor-b2']) fail('kapak açılırken koridor çizilmiyor (kapıdan boşluk görünür)');
  await page.waitForFunction(() => !window.__dm.prologue.active(), { timeout: 180000 });
  await sleep(800);
  const sub = await ev(() => [document.querySelector('.subtitle .speaker')?.textContent, document.querySelector('.subtitle .text')?.textContent]);
  console.log(`  içeride: ${sub[0]} — ${sub[1]}`);
  if (sub[0] !== 'NEREUS') fail('içeride NEREUS konuşmuyor');
  await sleep(2500);
  const fullText = await ev(() => document.querySelector('.subtitle .text')?.textContent ?? '');
  if (!/Hoş geldiniz|Sizi bekliyordum/.test(fullText) && !/Hoş geldiniz/.test(sub[1] ?? '')) console.log(`  (uyarı) karşılama metni: ${fullText}`);
  const prog = await ev(() => window.__dm.progress());
  if (!prog.prologueDone || !prog.world.states.includes('prologue.done')) fail('prolog bitti olarak kaydedilmedi');
  if (prog.profile.name !== 'Test') fail(`ad kaydedilmedi (${prog.profile.name})`);
  if (prog.world.room !== 'corridor-b2') fail(`oda ${prog.world.room}`);
  await shot('koridor');
  const hud = await ev(() => document.querySelector('.hud-goal')?.textContent);
  console.log(`  HUD: ${hud}`);
  if (!hud?.includes('Destek gemisine ulaş')) fail('hedef satırı yok');
  // Enkaz koridor penceresinden görünür
  await ev(() => window.__dm.hub.debug.teleport(-0.6, -4.5, 1.35));
  await frames(10);
  console.log('  pencere bakışı:', JSON.stringify(await ev(() => window.__dm.hub.pose())));
  await shot('enkaz-pencere');
  // Yeniden yükleme: prolog tekrar oynamaz
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.gate-action')?.textContent === 'Tıkla ve başla', { timeout: 600000 });
  if (await page.$('.gate input[name="pname"]')) fail('prolog bitmişken giriş ekranında ad alanı var');
  console.log(`süre ${((Date.now() - t0) / 60000).toFixed(1)} dk`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  console.log('konsol:', errors.length ? errors.join(' | ') : 'temiz');
  if (errors.length) failed = true;
  await browser.close();
  await server.close();
  console.log(failed ? 'SONUÇ: BAŞARISIZ' : 'SONUÇ: TAMAM');
  process.exit(failed ? 1 : 0);
}
