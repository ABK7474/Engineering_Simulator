// Hızlı görsel kontrol (yavaş değil, ~3 dk): `npm run screens [ad-süzgeci]`. Bütün arızaları onarılmış sayar,
// kapıları animasyonsuz açar ve scripts/e2e-views.json'daki bakışlardan screenshots/'a görüntü alır; her bakış
// için çizim çağrısı/üçgen sayısını yazar. Tam oynanış için `npm run e2e`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: 5213, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
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
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`${m.type()}: ${m.text()}`));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const frames = async (n) => {
  for (let i = 0; i < n; i++) await ev(() => new Promise((r) => requestAnimationFrame(() => r())));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const views = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/e2e-views.json'), 'utf8')).filter((v) => !process.argv[2] || v.name.includes(process.argv[2]));
try {
  await page.goto('http://localhost:5213/?seed=11', { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.gate-action')?.textContent === 'Tıkla ve başla', { timeout: 600000 });
  await page.click('.gate');
  await page.waitForFunction(() => window.__dm.hub.isRoaming(), { timeout: 30000 });
  await ev(() => window.__dm.solveAll());
  await sleep(300);
  await page.$eval('.finale [data-act="continue"]', (b) => b.click()).catch(() => {});
  await ev(() => {
    for (const id of Object.keys(window.__dm.hub.debug.doors())) window.__dm.hub.setDoorOpen(id, true, false);
  });
  await page.mouse.click(640, 400);
  for (const v of views) {
    await ev((a) => window.__dm.hub.debug.teleport(a.x, a.z, a.yaw), v);
    await frames(12);
    await page.screenshot({ path: path.join(OUT, `${v.name}.png`) });
    const b = await ev(() => window.__dm.hub.debug.breakdown());
    console.log(`${v.name.padEnd(24)} çağrı ${b.toplam.calls} üçgen ${Math.round(b.toplam.triangles / 1000)}k`);
  }
  console.log('konsol hataları:', errors.length ? errors.join(' | ') : 'yok');
} finally {
  await browser.close();
  await server.close();
}
