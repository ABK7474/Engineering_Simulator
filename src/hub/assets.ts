// Model/doku yükleme, instancing ve kutu izdüşümü UV. Yalnızca hub kullanır.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModelId, Placement } from '../world/layout';

const MODELS = [
  'WallAstra_Straight',
  'WallAstra_Straight_Window',
  'WallAstra_Straight_Broken',
  'TopCables_Straight',
  'TopCables_Straight_Hanging',
  'BottomMetal_Straight',
  'Platform_DarkPlates',
  'Door_Frame_Square',
  'Door_Metal',
  'Prop_AccessPoint',
  'Prop_Computer',
  'Prop_Light_Wide',
  'Prop_Vent_Wide',
  'Prop_Cable_1',
  'Column_Simple',
  'Prop_Crate',
  'Prop_Crate_Large',
  'Prop_Locker',
] as const;
export type LoadedModelId = (typeof MODELS)[number];

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

  const entries = await Promise.all(
    MODELS.map(async (id) => [id, (await gltf.loadAsync(`${base}models/quaternius/${id}.gltf`)).scene] as const),
  );
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

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function placementMatrix(p: Placement, out: THREE.Matrix4): THREE.Matrix4 {
  tmpEuler.set(p.flip ? Math.PI : 0, p.rotY, 0, 'YXZ');
  tmpQuat.setFromEuler(tmpEuler);
  return out.compose(tmpPos.set(p.x, p.y, p.z), tmpQuat, ONE);
}

/**
 * Aynı modelin tüm yerleşimlerini, modelin her (geometri, malzeme) parçası için tek bir
 * InstancedMesh ile çizer. Sabit nesneler: gölge düşürür ve alır (gölge haritası bir kez çizilir).
 */
export function instanceAll(models: Assets['models'], placements: readonly Placement[]): THREE.Group {
  const group = new THREE.Group();
  const byModel = new Map<ModelId, Placement[]>();
  for (const p of placements) byModel.set(p.model, [...(byModel.get(p.model) ?? []), p]);

  for (const [id, list] of byModel) {
    const root = models[id];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const inst = new THREE.InstancedMesh(o.geometry, o.material, list.length);
      list.forEach((p, k) => inst.setMatrixAt(k, placementMatrix(p, tmpMatrix).multiply(o.matrixWorld)));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.name = `${id}/${o.name}`;
      group.add(inst);
    });
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
