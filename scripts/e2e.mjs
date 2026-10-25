// Uçtan uca tur (yavaş; `npm test`e girmez): `npm run e2e`. Geliştirme sunucusunu açar, başsız Chrome ile oyunu
// baştan sona oynar: her arızanın terminaline gider, E ile paneli açar, aşamaları çözücünün cevabıyla gönderir,
// olay raporunu kapatır; tehdit olayını başlatır; finale kadar gider. Bir kapıdan W tuşuyla gerçekten yürür.
// Sonunda her odadan ekran görüntüsü (screenshots/, repoya girmez) ve çizim çağrısı/üçgen sayısı raporlar;
// bütçe görüntü başına ≤ 150 çağrı ve ≤ 150 bin üçgen (DECISIONS.md).
// Chrome yolu: CHROME_PATH (varsayılan /usr/bin/google-chrome). Konsol hatası ya da tıkanma olursa çıkış kodu 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 5211;
fs.mkdirSync(OUT, { recursive: true });

const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' }); // tur sürerken dosya değişirse sayfa tazelenmesin
await server.listen();
const { loadWorld } = await server.ssrLoadModule('/src/world/content.ts');
const { walkTargets } = await server.ssrLoadModule('/src/world/walk.ts');
const { world: W, layout: L } = loadWorld(undefined, undefined, undefined, { verifySeeds: 0 });
const targets = walkTargets(L);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 1_800_000,
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
const log = (...a) => console.log(...a);
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('HATA:', msg);
};

/** Panel/rapor kapandıktan sonra kullanıcı gibi sahneye tıklayıp dolaşmaya dön. */
async function resumeRoaming() {
  for (let k = 0; k < 5 && !(await ev(() => window.__dm.hub.isRoaming())); k++) {
    await page.mouse.click(640, 400);
    await sleep(300);
  }
  if (!(await ev(() => window.__dm.hub.isRoaming()))) fail('tıklamayla dolaşmaya dönülemedi');
}

/** Terminalin önündeki yürüme noktasına git, terminale dön. */
async function goTo(fid) {
  await resumeRoaming();
  const t = targets.find((x) => x.label === `terminal '${fid}'`);
  const term = L.terminals.find((x) => x.fault.id === fid);
  const yaw = Math.atan2(-(term.x - t.x), -(term.z - t.z));
  await ev((a) => window.__dm.hub.debug.teleport(a[0], a[1], a[2]), [t.x, t.z, yaw]);
  await frames(4);
}

async function solveFault(fid) {
  await goTo(fid);
  await page.keyboard.press('KeyE');
  try {
    await page.waitForSelector('.overlay .panel h2', { timeout: 15000 });
  } catch {
    return fail(`${fid}: E ile panel açılmadı`);
  }
  for (let stage = 0; stage < 6; stage++) {
    const title = await ev(() => document.querySelector('.overlay .panel h2')?.textContent);
    const answer = await ev((f) => window.__dm.solution(f), fid);
    await ev((a) => window.__dm.submit(a[0], a[1]), [fid, answer]);
    await page.waitForSelector('[data-act="close"]', { timeout: 180000 });
    const ok = await ev(() => document.querySelector('.report .tag, .panel .tag')?.textContent ?? '');
    log(`  ${title} → ${ok}`);
    const next = await page.$('[data-act="next"]');
    if (next) {
      await next.click();
      await page.waitForSelector('.overlay .panel h2', { timeout: 15000 });
      continue;
    }
    await page.click('[data-act="close"]');
    await sleep(300);
    break;
  }
}

try {
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?seed=11&prologue=skip`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.gate-action')?.textContent === 'Tıkla ve başla', { timeout: 600000 });
  await page.click('.gate');
  await page.waitForFunction(() => window.__dm.hub.isRoaming(), { timeout: 30000 });
  log(`yüklendi (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // Bilek cihazı: Q bakış, M harita (bilekte), N defter (kol kalkar, panel açılır); klasik HUD'da köşe paneli
  const armMode = () => ev(() => window.__dm.hub.arms.mode);
  const waitArm = async (want, what) => {
    for (let k = 0; k < 60 && (await armMode()) !== want; k++) await frames(2);
    if ((await armMode()) !== want) fail(`${what}: kol '${want}' olmadı (${await armMode()})`);
  };
  await page.keyboard.press('KeyQ');
  await waitArm('glance', 'Q');
  await page.keyboard.press('KeyQ');
  await waitArm('rest', 'Q tekrar');
  await page.keyboard.press('KeyM');
  await waitArm('map', 'M');
  if (await ev(() => !document.querySelector('.map-panel').hidden)) fail('bilek kipinde köşe haritası açıldı');
  await page.keyboard.press('KeyM');
  await waitArm('rest', 'M tekrar');
  await page.keyboard.press('KeyN');
  try {
    await page.waitForSelector('.notebook', { timeout: 30000 });
    if ((await armMode()) !== 'notebook') fail('defter açıkken kol kalkık değil');
  } catch {
    fail('N ile defter açılmadı');
  }
  await page.keyboard.press('Escape');
  await waitArm('rest', 'defter kapandı');
  await ev(() => window.__dm.setClassicHud(true));
  if (await ev(() => getComputedStyle(document.querySelector('.hud')).display === 'none')) fail('klasik HUD görünmüyor');
  await page.mouse.click(640, 400);
  await sleep(300);
  await page.keyboard.press('KeyM');
  await sleep(300);
  if (await ev(() => document.querySelector('.map-panel').hidden)) fail('klasik HUD: M köşe haritasını açmadı');
  await page.keyboard.press('KeyM');
  await ev(() => window.__dm.setClassicHud(false));
  if (await ev(() => getComputedStyle(document.querySelector('.hud')).display !== 'none')) fail('bilek kipinde HUD hâlâ ekranda');
  log('bilek cihazı: Q/M/N ve klasik HUD tamam');
  await page.mouse.click(640, 400);

  const order = [];
  let walked = false;
  for (let step = 0; step < 40; step++) {
    const view = await ev(() => window.__dm.map());
    const progress = await ev(() => window.__dm.progress());
    const done = (f) => (progress.faults[f.id]?.stagesDone ?? 0) > 0 && view.faults.find((x) => x.id === f.id).status === 'solved';
    if (W.faults.every(done)) break;
    // Tehdit: sonar kalibre olduysa olayı hemen başlat (oyunda 25 sn dolaşma)
    if (progress.world.states.includes('sensor.calibrated') && !progress.world.states.includes('threat.cleared') && !progress.world.states.includes('threat.active')) {
      await resumeRoaming();
      await ev(() => window.__dm.threat('creature-1', 0.2));
      await page.waitForFunction(() => window.__dm.progress().world.states.includes('threat.active'), { timeout: 30000 });
      log('tehdit başladı: TEMAS sayacı', await ev(() => document.querySelector('.hud-threat')?.textContent ?? 'YOK'));
      continue;
    }
    const open = view.faults.filter((f) => f.status === 'open');
    if (!open.length) {
      fail(`adım ${step}: açık arıza yok (tıkanma). Durumlar: ${progress.world.states.join(', ')}`);
      break;
    }
    const fid = open[0].id;
    log(`${order.length + 1}. ${fid}`);
    await solveFault(fid);
    order.push(fid);
    const after = await ev(() => window.__dm.map());
    if (after.faults.find((x) => x.id === fid).status !== 'solved') {
      fail(`${fid} çözülmüş görünmüyor`);
      break;
    }
    // Bir kapıdan gerçekten yürü: kilit açılınca koridordan kontrol odasına W ile
    if (!walked && after.doors.find((d) => d.id === 'b2-c1')?.open) {
      walked = true;
      await resumeRoaming();
      await ev(() => window.__dm.hub.debug.teleport(0, -21.5, 0));
      await frames(3);
      await page.keyboard.down('KeyW');
      const tw = Date.now();
      while (Date.now() - tw < 60000 && (await ev(() => window.__dm.hub.stats().room)) !== 'lab-c1') await sleep(250);
      await page.keyboard.up('KeyW');
      const room = await ev(() => window.__dm.hub.stats().room);
      if (room !== 'lab-c1') fail(`kapıdan yürünemedi (oda: ${room})`);
      else log('  W ile B-2 → C-1 kapısından yürüyerek geçildi');
    }
  }
  log('sıra:', order.join(' → '));
  const finale = await page.$('.finale');
  if (!finale) fail('final görünmedi');
  else {
    log('final:', await ev(() => document.querySelector('.finale h2')?.textContent));
    await page.screenshot({ path: path.join(OUT, 'finale.png') });
    // Seçim: kapsülle ayrıl (kayda ending.left düşer)
    await page.click('.finale [data-end="left"]');
    await page.waitForSelector('.finale [data-act="continue"]', { timeout: 10000 });
    const ending = await ev(() => window.__dm.progress().ending);
    if (ending !== 'left') fail(`final seçimi kaydedilmedi (${ending})`);
    await page.click('.finale [data-act="continue"]');
    await sleep(500);
    await resumeRoaming();
  }
  const states = await ev(() => window.__dm.progress().world.states);
  const closed = W.doors.filter((d) => !d.opensWhen.every((s) => states.includes(s)));
  if (closed.length) fail(`sonda kapalı kapı: ${closed.map((d) => d.id).join(', ')}`);

  // Kapı animasyonları yalnız dolaşırken ilerler (yazılım çizicide yavaş): hepsi tam açılana kadar bekle
  await resumeRoaming();
  const td = Date.now();
  let amounts = {};
  while (Date.now() - td < 600000) {
    amounts = await ev(() => window.__dm.hub.debug.doors());
    if (Object.values(amounts).every((a) => a >= 0.999)) break;
    await sleep(2000);
  }
  if (!Object.values(amounts).every((a) => a >= 0.999)) fail(`kapılar tam açılmadı: ${JSON.stringify(amounts)}`);
  else log('bütün kapılar tam açık');

  // Oda başına ekran görüntüsü ve çizim istatistikleri
  const VIEWS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/e2e-views.json'), 'utf8'));
  const rows = [];
  for (const v of VIEWS) {
    await ev((a) => window.__dm.hub.debug.teleport(a[0], a[1], a[2]), [v.x, v.z, v.yaw]);
    await frames(14);
    const s = await ev(() => window.__dm.hub.stats());
    const b = await ev(() => window.__dm.hub.debug.breakdown());
    await page.screenshot({ path: path.join(OUT, `${v.name}.png`) });
    rows.push({ görüntü: v.name, oda: s.room, çağrı: b.toplam.calls, üçgen: b.toplam.triangles, dış: s.exterior });
    if (b.toplam.calls > 150 || b.toplam.triangles > 150000) fail(`${v.name}: bütçe aşıldı (${b.toplam.calls} çağrı, ${b.toplam.triangles} üçgen)`);
  }
  console.table(rows);
  fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(rows, null, 2));
  log('konsol hataları:', errors.length ? errors.join(' | ') : 'yok');
  if (errors.length) failed = true;
  log(`süre ${((Date.now() - t0) / 60000).toFixed(1)} dk`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
