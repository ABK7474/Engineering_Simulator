// Kapsül finali (yavaş; `npm test`e girmez): `npm run e2e:ending`. Prolog atlanmış bir profille oyunu açar, bütün
// arızaları onarılmış sayar, finalde "Kapsülle ayrıl"ı seçer. Sahneler arasında atlayarak her birinden ekran görüntüsü
// alır (bütçe ≤ 150 çağrı / 150 bin üçgen), derinlik eşiklerinin ve yaratığın durmasının sahneyi ilerlettiğini, yüzeye
// çıkışı ve sezon sonu panelini denetler. İstasyona dönüşte kamera ve odalar yerinde olmalı. 923 finali yeniden açar.
// Konsol hatası ya da tıkanma olursa çıkış kodu 1.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 5215;
fs.mkdirSync(OUT, { recursive: true });
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
async function shot(name) {
  // Karartma/parlama geçişleri duvar saatiyle akar; çekimde gizlenir (sahnenin kendisi görünsün)
  await ev(() => document.querySelectorAll('#ui > .fade').forEach((f) => (f.style.visibility = 'hidden')));
  await frames(8);
  await page.screenshot({ path: path.join(OUT, `final-${name}.png`) });
  await ev(() => document.querySelectorAll('#ui > .fade').forEach((f) => (f.style.visibility = '')));
  const b = await ev(() => window.__dm.hub.debug.breakdown());
  const st = await ev(() => ({ ...window.__dm.hub.ending.status, beat: window.__dm.ending.beat() }));
  console.log(`  ${name.padEnd(10)} çağrı ${b.toplam.calls} üçgen ${Math.round(b.toplam.triangles / 1000)}k  derinlik ${st.depth.toFixed(0)} m  sahne ${st.beat}`);
  if (b.toplam.calls > 150 || b.toplam.triangles > 150_000) fail(`${name}: bütçe aşıldı`);
  return st;
}
const beat = () => ev(() => window.__dm.ending.beat());
async function waitBeat(id, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await beat()) === id) return true;
    await page.keyboard.press('Space');
    await sleep(300);
  }
  fail(`sahne '${id}' gelmedi (şu an: ${await beat()})`);
  return false;
}

try {
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?seed=5&prologue=skip`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForSelector('[data-menu="new"]', { timeout: 600000 });
  await page.click('[data-menu="new"]');
  await page.click('[data-menu="start"]');
  await page.waitForFunction(() => window.__dm.hub.isRoaming(), { timeout: 30000 });
  if (!(await ev(() => window.__dm.solveAll()))) fail('final açılmadı');
  await page.waitForSelector('.finale [data-end="left"]', { timeout: 10000 });
  await page.$eval('.finale [data-end="left"]', (b) => b.click());
  await page.waitForFunction(() => window.__dm.ending.active(), { timeout: 10000 });
  if ((await ev(() => window.__dm.progress().ending)) !== 'left') fail('seçim kaydedilmedi');
  // Sahne kendiliğinden başlar (kararma → kapsülün içi, konsol)
  await waitBeat('launch', 20000);
  if (!(await ev(() => document.body.classList.contains('cinematic')))) fail('sinema kipi yok');
  if (await ev(() => getComputedStyle(document.querySelector('.hud')).visibility !== 'hidden')) fail('HUD sahnede görünüyor');
  await sleep(1500);
  await shot('yuva');
  // Fırlatma: derinlik gerçekten azalır
  await waitBeat('release');
  await frames(40);
  const d1 = await ev(() => window.__dm.hub.ending.status.depth);
  console.log(`  fırlatmadan sonra derinlik ${d1.toFixed(1)} m`);
  if (!(d1 < 221)) fail('kapsül yükselmiyor');
  await shot('firlatma');
  // Eşik olayı akıştan gelmeli: derinliği eşiğin hemen altına taşı, sahne 'lights'a geçsin
  await ev(() => window.__dm.hub.ending.setDepth(204));
  await waitBeat('lights', 10000);
  await sleep(1200);
  await shot('isiklar');
  await ev(() => window.__dm.ending.skipTo('follow'));
  await frames(60);
  const f = await shot('yaratik');
  if (f.sonar !== 'contact') fail(`sonar teması yok (${f.sonar})`);
  // Yaratığın durması bir olay; sahne 'turn'e kendiliğinden geçmeli (takip yazılımla çizimde kare başına en çok 0,05 sn)
  await waitBeat('turn', 240000);
  await shot('donus');
  await ev(() => window.__dm.ending.skipTo('light'));
  await frames(20);
  await shot('yuzey-alti');
  await ev(() => window.__dm.ending.skipTo('surface'));
  await frames(30);
  const s = await shot('yuzey');
  if (!s.surfaced) fail('yüzeye çıkılmadı');
  await ev(() => window.__dm.ending.skipTo('rescued'));
  await frames(12); // son sahne duvar saatiyle 9 sn; bot görünür, sahne bitmeden çekilir
  await shot('kurtarma');
  // Atla → sezon sonu paneli → istasyona dön
  await ev(() => document.querySelector('.ending-skip')?.click());
  await page.waitForSelector('.season-end [data-act="continue"]', { timeout: 20000 });
  const endText = await ev(() => document.querySelector('.season-end .finale-end')?.textContent);
  console.log(`  panel: ${endText}`);
  if (endText !== 'Sezon 1 bitti. Kurtuldun.') fail('sezon sonu yazısı yanlış');
  await page.screenshot({ path: path.join(OUT, 'final-sezon-sonu.png') });
  await page.click('.season-end [data-act="continue"]');
  await sleep(500);
  if (await ev(() => document.body.classList.contains('cinematic'))) fail('sinema kipi kapanmadı');
  if ((await ev(() => window.__dm.hub.debug.rig())) !== 'station') fail('istasyona dönülmedi');
  await page.mouse.click(640, 400);
  await frames(20);
  const back = await ev(() => window.__dm.hub.stats());
  console.log(`  dönüş: oda ${back.room} y ${back.y.toFixed(2)} çağrı ${back.calls}`);
  if (Math.abs(back.y - 1.6) > 0.2) fail('dönüşte göz yüksekliği yanlış');
  await page.screenshot({ path: path.join(OUT, 'final-donus.png') });
  // 923: final yeniden
  await page.keyboard.press('Escape');
  await sleep(300);
  for (const k of ['Digit9', 'Digit2', 'Digit3']) await page.keyboard.press(k);
  try {
    await page.waitForSelector('.finale [data-end="left"]', { timeout: 10000 });
    console.log('  923: final yeniden açıldı');
  } catch {
    fail('923 finali yeniden göstermedi');
  }
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
