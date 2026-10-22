// Model/doku yükleme, instancing ve kutu izdüşümü UV. Yalnızca hub kullanır.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_IDS, MODELS, type ModelId } from '../world/catalog';
import type { Placement } from '../world/layout';

export type LoadedModelId = ModelId;

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** AO (R) + pürüzlülük (G) + metaliklik (B) tek dokuda. */
  arm: THREE.Texture;
}

export interface Assets {
  models: Record<LoadedModelId, THREE.Group>;
  metalPlate: PbrSet;
  rustyMetal: PbrSet;
}

export async function loadAssets(base: string, renderer: THREE.WebGLRenderer): Promise<Assets> {
  const gltf = new GLTFLoader();
  const tex = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const pbr = async (dir: string, name: string): Promise<PbrSet> => {
    const load = async (suffix: string, srgb: boolean) => {
      const t = await tex.loadAsync(`${base}textures/${dir}/${name}_${suffix}_1k.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      return t;
    };
    const [map, normalMap, arm] = await Promise.all([load('diff', true), load('nor_gl', false), load('arm', false)]);
    return { map, normalMap, arm };
  };

  // Aynı PNG'yi kullanan modeller (trim dokuları onlarca modelde ortak) tek görüntü ve tek doku nesnesi paylaşsın:
  // önbellek aynı URL için aynı görüntüyü döndürür, aşağıda aynı görüntüye bağlı dokular tekilleştirilir.
  THREE.Cache.enabled = true;
  const entries = await Promise.all(MODEL_IDS.map(async (id) => [id, (await gltf.loadAsync(`${base}models/${MODELS[id].file}`)).scene] as const));
  shareTextures(entries.map(([, scene]) => scene));
  const [metalPlate, rustyMetal] = await Promise.all([
    pbr('metal_plate_02', 'metal_plate_02'),
    pbr('rusty_metal_04', 'rusty_metal_04'),
  ]);
  return { models: Object.fromEntries(entries) as Assets['models'], metalPlate, rustyMetal };
}

/** Poly Haven ARM dokusundan malzeme; `repeat` doku tekrarı. */
export function pbrMaterial(set: PbrSet, repeat: THREE.Vector2, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const clone = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.copy(repeat);
    c.needsUpdate = true;
    return c;
  };
  const arm = clone(set.arm);
  return new THREE.MeshStandardMaterial({
    map: clone(set.map),
    normalMap: clone(set.normalMap),
    aoMap: arm,
    roughnessMap: arm,
    metalnessMap: arm,
    roughness: 1,
    metalness: 1,
    ...extra,
  });
}

const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function placementMatrix(p: Placement, out: THREE.Matrix4): THREE.Matrix4 {
  // Yatık duvara yaslanan süsler: yerel X'te −tilt (üst kenar odadan uzaklaşır)
  tmpEuler.set((p.flip ? Math.PI : 0) - (p.tilt ?? 0), p.rotY, 0, 'YXZ');
  tmpQuat.setFromEuler(tmpEuler);
  return out.compose(tmpPos.set(p.x, p.y, p.z), tmpQuat, ONE);
}

/** Görsel olarak birebir aynı malzemeler aynı imzayı verir (dokular, renkler, sayısal özellikler). */
export function materialSignature(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  const tex = (t: THREE.Texture | null | undefined) => (t ? `${t.source.uuid}:${t.repeat.x},${t.repeat.y}:${t.offset.x},${t.offset.y}` : '-');
  return [
    m.type, tex(s.map), tex(s.normalMap), tex(s.roughnessMap), tex(s.metalnessMap), tex(s.aoMap), tex(s.emissiveMap), tex(s.alphaMap),
    s.color?.getHexString(), s.emissive?.getHexString(), s.emissiveIntensity, s.roughness, s.metalness, s.normalScale?.x,
    m.opacity, m.transparent, m.side, m.alphaTest, m.vertexColors, s.flatShading, m.depthWrite,
  ].join('|');
}

/**
 * Bir odanın sabit modellerini malzeme başına TEK çizim çağrısında çizer (BatchedMesh: farklı geometriler,
 * örnek başına dönüşüm ve örnek başına görüş alanı ayıklaması). Görsel olarak aynı malzemeler birleştirilir.
 * `material` parçanın malzemesini değiştirmeye (ör. cam), `castShadow` gölge kararına izin verir.
 */
export function batchAll(
  models: Assets['models'],
  placements: readonly Placement[],
  opts: { material?: (m: THREE.Material, modelId: ModelId) => THREE.Material; castShadow?: (modelId: ModelId, m: THREE.Material) => boolean } = {},
): THREE.Group {
  const group = new THREE.Group();
  type Part = { geo: THREE.BufferGeometry; matrices: THREE.Matrix4[]; model: ModelId };
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; parts: Map<THREE.BufferGeometry, Part> }>();
  const byModel = new Map<ModelId, Placement[]>();
  for (const p of placements) byModel.set(p.model, [...(byModel.get(p.model) ?? []), p]);
  for (const [id, list] of byModel) {
    const root = models[id];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const material = opts.material ? opts.material(o.material as THREE.Material, id) : (o.material as THREE.Material);
      const cast = opts.castShadow ? opts.castShadow(id, material) : true;
      const g = o.geometry as THREE.BufferGeometry;
      const layout = Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}`).join(',');
      const key = `${materialSignature(material)}#${cast}#${layout}#${g.index ? 'i' : 'n'}`;
      const b = buckets.get(key) ?? { material, cast, parts: new Map() };
      buckets.set(key, b);
      const part = b.parts.get(g) ?? { geo: g, matrices: [], model: id };
      b.parts.set(g, part);
      for (const p of list) part.matrices.push(placementMatrix(p, new THREE.Matrix4()).multiply(o.matrixWorld));
    });
  }
  for (const b of buckets.values()) {
    const parts = [...b.parts.values()];
    const instances = parts.reduce((a, p) => a + p.matrices.length, 0);
    const verts = parts.reduce((a, p) => a + p.geo.getAttribute('position').count, 0);
    const indices = parts.reduce((a, p) => a + (p.geo.index?.count ?? 0), 0);
    const mesh = new THREE.BatchedMesh(instances, verts, indices || undefined, b.material);
    for (const p of parts) {
      const gid = mesh.addGeometry(p.geo);
      for (const m of p.matrices) mesh.setMatrixAt(mesh.addInstance(gid), m);
    }
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    mesh.name = (b.material as THREE.Material).name || 'batch';
    // Geliştirme dökümü için: model başına üçgen
    const tris: Record<string, number> = {};
    for (const p of parts) tris[p.model] = (tris[p.model] ?? 0) + (((p.geo.index?.count ?? p.geo.getAttribute('position').count) / 3) * p.matrices.length);
    mesh.userData.tris = tris;
    const count: Record<string, number> = {};
    for (const p of parts) count[p.model] = Math.max(count[p.model] ?? 0, p.matrices.length);
    mesh.userData.count = count;
    group.add(mesh);
  }
  return group;
}

/**
 * Kutu izdüşümü UV: her üçgen, normalinin baskın eksenine dik düzleme izdüşürülür.
 * Trim-sheet UV'li bir modele tekrarlanan (tileable) doku uygulamak için. `scale` m başına tekrar.
 */
export function boxProjectUVs(geometry: THREE.BufferGeometry, scale: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      const [u, w] = ax >= ay && ax >= az ? [v.z, v.y] : ay >= az ? [v.x, v.z] : [v.x, v.y];
      uv[(i + k) * 2] = u * scale;
      uv[(i + k) * 2 + 1] = w * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;

/** Aynı görüntüye bağlı dokuları tek nesneye indirger (GPU'ya bir kez yüklenir). */
export function shareTextures(roots: THREE.Object3D[]): number {
  const canon = new Map<unknown, THREE.Texture>();
  let replaced = 0;
  for (const root of roots)
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        const m = mat as THREE.MeshStandardMaterial;
        for (const slot of TEXTURE_SLOTS) {
          const t = m[slot];
          if (!t) continue;
          const key = t.source.data;
          const prev = canon.get(key);
          if (prev && prev !== t && prev.colorSpace === t.colorSpace && prev.flipY === t.flipY) {
            m[slot] = prev;
            replaced++;
          } else if (!prev) canon.set(key, t);
        }
      }
    });
  return replaced;
}
