// Görsel iç içe geçme taraması: her modelin gerçek sınır kutusu GLTF/GLB dosyasından okunur, yerleşimlerin dünya
// kutuları hesaplanır; yapı elemanları (duvar, zemin, tavan kabloları, kolonlar) dışındaki nesne çiftleri belirgin
// biçimde iç içe giriyorsa (her eksende ≥ 4 cm) listelenir. Dolaptan çıkan süs, terminalin içinden geçen boru,
// fanla çakışan boru rafı gibi hataları yakalar.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODELS, type ModelId } from './catalog';
import { loadWorld } from './content';
import type { Placement } from './layout';

type Box = { min: number[]; max: number[] };
const ROOT = path.resolve(__dirname, '../../public/assets/models');

function readGltf(file: string): { json: any } {
  const p = path.join(ROOT, file);
  if (file.endsWith('.gltf')) return { json: JSON.parse(fs.readFileSync(p, 'utf8')) };
  const b = fs.readFileSync(p);
  const len = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + len).toString('utf8')) };
}

/** Düğüm dönüşümleri (TRS) uygulanmış model kutusu. */
function modelBox(id: ModelId): Box {
  const { json } = readGltf(MODELS[id].file);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (ni: number, m: number[][]) => {
    const n = json.nodes[ni];
    const t = n.translation ?? [0, 0, 0];
    const s = n.scale ?? [1, 1, 1];
    const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
    const r = [
      [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
      [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
      [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ];
    const local = [0, 1, 2].map((i) => [r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]]);
    const mm = [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => m[i][0] * local[0][j] + m[i][1] * local[1][j] + m[i][2] * local[2][j] + (j === 3 ? m[i][3] : 0)));
    if (n.mesh !== undefined)
      for (const prim of json.meshes[n.mesh].primitives) {
        const a = json.accessors[prim.attributes.POSITION];
        for (const cx of [a.min[0], a.max[0]])
          for (const cy of [a.min[1], a.max[1]])
            for (const cz of [a.min[2], a.max[2]])
              for (let i = 0; i < 3; i++) {
                const v = mm[i][0] * cx + mm[i][1] * cy + mm[i][2] * cz + mm[i][3];
                min[i] = Math.min(min[i], v);
                max[i] = Math.max(max[i], v);
              }
      }
    for (const c of n.children ?? []) visit(c, mm);
  };
  const scene = json.scenes[json.scene ?? 0];
  for (const ni of scene.nodes) visit(ni, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]);
  return { min, max };
}

/** Yerleşimin dünya kutusu (Y dönüşü ve tavana asılanlar için X ekseninde 180° çevirme). */
function worldBox(p: Placement, b: Box): Box {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) {
        const [fy, fz] = p.flip ? [-y, -z] : [y, z];
        const v = [p.x + x * c + fz * s, p.y + fy, p.z - x * s + fz * c];
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], v[i]);
          max[i] = Math.max(max[i], v[i]);
        }
      }
  return { min, max };
}

/** Yapı elemanları: birbirine ve eşyalara bilerek değer, taranmaz. */
const STRUCTURE = /^(WallAstra|Platform_|TopCables|BottomMetal|Column_Simple|Door_Frame)/;
/** Bilerek iç içe olanlar: masaya sandalye, kasa üstüne kasa, rafın içindeki varil. */
const ALLOWED: [RegExp, RegExp][] = [
  [/^Prop_Desk/, /^Prop_Chair/],
  [/^Prop_Crate/, /^Prop_Crate/],
];

describe('görsel iç içe geçme', () => {
  it('eşyalar, süsler, tavan ve zemin parçaları birbirinin içine girmiyor', () => {
    const { layout: L } = loadWorld(undefined, undefined, undefined, { verifySeeds: 0 });
    const boxes = new Map<ModelId, Box>();
    const items = L.placements
      .filter((p) => !STRUCTURE.test(p.model))
      .map((p) => {
        if (!boxes.has(p.model)) boxes.set(p.model, modelBox(p.model));
        return { p, b: worldBox(p, boxes.get(p.model)!) };
      });
    const bad: string[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const [a, b] = [items[i], items[j]];
        if (a.p.room !== b.p.room) continue;
        if (ALLOWED.some(([x, y]) => (x.test(a.p.model) && y.test(b.p.model)) || (x.test(b.p.model) && y.test(a.p.model)))) continue;
        const depth = [0, 1, 2].map((k) => Math.min(a.b.max[k], b.b.max[k]) - Math.max(a.b.min[k], b.b.min[k]));
        if (depth.every((d) => d > 0.04)) bad.push(`${a.p.room}: ${a.p.model} ↔ ${b.p.model} @ (${a.p.x.toFixed(1)}, ${a.p.y.toFixed(1)}, ${a.p.z.toFixed(1)})`);
      }
    if (bad.length) console.log(bad.join("\n"));
    expect(bad).toEqual([]);
  });
});
