// Geliştirici betiği (oyunun çalışma zamanına girmez): `node scripts/import-assets.mjs`
// Ham paketlerden (~/oyun-kaynak-assetler) oyunun kullandığı küçük kümeyi public/assets'e üretir.
// Tekrar çalıştırmak güvenlidir (çıktıların üstüne yazar). Gerekenler: ffmpeg, assimp.
// - Quaternius glTF: .gltf + .bin kopyalanır, doku yolları `textures/<ad>` olarak yeniden yazılır.
// - Ultimate Modular Sci-Fi (yalnız FBX/OBJ): OBJ sürümü (Y-yukarı, metre) assimp ile .glb'ye çevrilir;
//   FBX çevirisi santimetre ölçek ve Z-yukarı eksenle bozuk çıktığı için kullanılmaz.
// - Dokular: eksik olanlar kopyalanır; 2048'lik PaddedWall seti 1024'e küçültülür (boyut bütçesi).
// - Sesler: ffmpeg ile kısa, mono ogg'ye çevrilir/kırpılır.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(os.homedir(), 'oyun-kaynak-assetler');
const OUT = path.join(ROOT, 'public/assets');
const MK = path.join(RAW, 'modeller/Modular SciFi MegaKit[Standard]');
const ES = path.join(RAW, 'modeller/Sci-Fi Essentials Kit[Standard]');
const UMSF = path.join(RAW, 'modeller/Ultimate Modular Sci-Fi - Feb 2021');
const SND = path.join(RAW, 'sesler');

/** Quaternius modelleri: [paket, alt klasör, ad]. */
const GLTF_MODELS = [
  ...['Prop_Fan_Small', 'Prop_Vent_Small', 'Prop_Vent_Big', 'Prop_Barrel_Large', 'Prop_Cable_3', 'Prop_Clamp', 'Prop_ItemHolder', 'Prop_Light_Floor', 'Prop_Light_Small', 'Prop_Chest', 'Prop_Crate3', 'Prop_Crate4', 'Prop_PipeHolder'].map((n) => [MK, 'Props', n]),
  ...['Column_Pipes', 'Column_Hollow', 'Column_Round'].map((n) => [MK, 'Columns', n]),
  ...['Prop_Desk_L', 'Prop_Desk_Medium', 'Prop_Desk_Small', 'Prop_Chair', 'Prop_Shelves_WideTall', 'Prop_Shelves_WideShort', 'Prop_Barrel1', 'Prop_Barrel2_Closed', 'Prop_SatelliteDish', 'Prop_Crate_Tarp'].map((n) => [ES, '', n]),
];
/** Doku yeniden adlandırma: tek prop için ayrı 1 MB'lık doku yüklemek yerine aynı trim'in kırmızı varyantı. */
const TEXTURE_ALIAS = { 'T_Trim_01_BaseColor.png': 'T_Trim_01_BaseColor_Red.png' };
const TEXTURE_SOURCES = [path.join(MK, 'Textures'), path.join(ES, 'Textures')];
const DOWNSCALE = new Set(['T_PaddedWall_BaseColor.png', 'T_PaddedWall_Normal.png', 'T_PaddedWall_ORM.png']);

/** Ultimate Modular Sci-Fi detayları (duvar süsleri, borular): OBJ → GLB. */
const OBJ_MODELS = ['Details_Pipes_Long', 'Details_Pipes_Medium', 'Details_Cylinder', 'Details_Cylinder_Long', 'Details_Vent_1', 'Details_Vent_3', 'Details_Output', 'Details_Output_Small', 'Details_Plate_Large', 'Details_Plate_Details', 'Details_Hexagon', 'Details_Triangles'];

/** Sesler: çıktı adı → [kaynak, ffmpeg filtre/kırpma argümanları]. Hepsi mono, ~96 kbps ogg. */
const SOUNDS = {
  steam_1: ['steam-release-sounds/steam hisses - Marker #1.wav', []],
  steam_2: ['steam-release-sounds/steam hisses - Marker #3.wav', []],
  steam_3: ['steam-release-sounds/steam hisses - Marker #5.wav', []],
  gas_leak: ['compressed-gas-leak/compressed_gas_leak.ogg', []],
  drip_loop: ['water-splash-slime-sfx/loop_water_02.ogg', []],
  bubbles_loop: ['water-splash-slime-sfx/loop_bubbles_1.ogg', []],
  splash_1: ['water-splash-slime-sfx/splash_03.ogg', []],
  sonar_ping: ['sonar-ping/sonar_ping.mp3', []],
  creature_roar: ['deep-monster-roar/monster_roar.wav', ['-af', 'lowpass=f=900,afade=t=out:st=6:d=1.2']],
  creature_rumble: ['rumbling-sound-effects/rumbling17.wav', ['-ss', '20', '-t', '8', '-af', 'lowpass=f=260,afade=t=in:d=1.5,afade=t=out:st=6:d=2']],
};

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });

function importGltf([pack, sub, name]) {
  const dir = path.join(pack, 'glTF', sub);
  const g = JSON.parse(fs.readFileSync(path.join(dir, `${name}.gltf`), 'utf8'));
  const outDir = path.join(OUT, 'models/quaternius');
  const needed = new Set();
  for (const img of g.images ?? []) {
    let file = path.basename(img.uri);
    file = TEXTURE_ALIAS[file] ?? file;
    img.uri = `textures/${file}`;
    needed.add(file);
  }
  for (const b of g.buffers) {
    fs.copyFileSync(path.join(dir, b.uri), path.join(outDir, `${name}.bin`));
    b.uri = `${name}.bin`;
  }
  fs.writeFileSync(path.join(outDir, `${name}.gltf`), JSON.stringify(g));
  return needed;
}

function importTexture(file) {
  const out = path.join(OUT, 'models/quaternius/textures', file);
  if (fs.existsSync(out)) return false;
  const src = TEXTURE_SOURCES.map((d) => path.join(d, file)).find((f) => fs.existsSync(f));
  if (!src) throw new Error(`Doku bulunamadı: ${file}`);
  if (DOWNSCALE.has(file)) run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=1024:1024', out]);
  else fs.copyFileSync(src, out);
  return true;
}

function importObj(name) {
  const outDir = path.join(OUT, 'models/umsf');
  mkdir(outDir);
  run('assimp', ['export', path.join(UMSF, 'OBJ', `${name}.obj`), path.join(outDir, `${name}.glb`), '-f', 'glb2']);
}

function importSound(name, [src, extra]) {
  const outDir = path.join(OUT, 'audio/sfx/station');
  mkdir(outDir);
  const pre = extra[0] === '-ss' ? extra.slice(0, 4) : [];
  const post = extra[0] === '-ss' ? extra.slice(4) : extra;
  run('ffmpeg', ['-y', '-v', 'error', ...pre, '-i', path.join(SND, src), ...post, '-ac', '1', '-c:a', 'libvorbis', '-q:a', '3', path.join(outDir, `${name}.ogg`)]);
}

const textures = new Set();
for (const m of GLTF_MODELS) for (const t of importGltf(m)) textures.add(t);
const added = [...textures].filter(importTexture);
for (const n of OBJ_MODELS) importObj(n);
for (const [n, s] of Object.entries(SOUNDS)) importSound(n, s);
console.log(`${GLTF_MODELS.length} glTF, ${OBJ_MODELS.length} OBJ→GLB, ${Object.keys(SOUNDS).length} ses; yeni dokular: ${added.join(', ') || 'yok'}`);
