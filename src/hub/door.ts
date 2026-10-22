// Kayar kapı: iki Door_Metal kanadı (kutu izdüşümü UV ile Poly Haven paslı metal). Çerçeve sabit
// modüllerle birlikte instancing ile çizilir; burada yalnız hareketli kanatlar ve kapalıyken çarpışma var.
// Kanatlar hareketli olduğu için gölge düşürmez (sabit gölge haritası bozulmasın).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DoorLayout } from '../world/layout';
import { boxProjectUVs, pbrMaterial, type Assets } from './assets';
import { toBox } from './building';

export interface Door {
  id: string;
  /** 0 = kapalı, 1 = tamamen açık. */
  openAmount: number;
  /** Kapalıyken geçişi kapatan kutu (hub, openAmount'a göre kullanır). */
  collider: THREE.Box3;
  position: THREE.Vector3;
  update: () => void;
}

// Kanatlar yukarı, tavanın (5 m) üstüne kayar: yana kaysalardı duvarda cep olmadığı için komşu duvar hücresinin
// önüne çıkıp oradaki terminale/eşyaya binerlerdi. Tam açıkken gizlenir (dış pencerelerden çatı üstünde görünmesin).
const LEAF_TRAVEL = 5.1;

export function createDoor(scene: THREE.Scene, assets: Assets, d: DoorLayout): Door {
  // Model tek yüzlü: iki taraftan da görünsün diye çift taraflı.
  const rust = pbrMaterial(assets.rustyMetal, new THREE.Vector2(1, 1), { metalness: 0.8, side: THREE.DoubleSide });
  const root = new THREE.Group();
  root.position.set(d.x, 0, d.z);
  root.rotation.y = d.rotY;
  scene.add(root);
  const makeLeaf = () => {
    // Kanadın bütün parçaları aynı malzemede: tek geometriye birleştirilir (kanat başına bir çizim çağrısı).
    const leaf = new THREE.Group();
    const src = assets.models.Door_Metal;
    src.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    src.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = boxProjectUVs(o.geometry.clone().applyMatrix4(o.matrixWorld), 0.5);
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      parts.push(geo);
    });
    leaf.add(new THREE.Mesh(mergeGeometries(parts), rust));
    leaf.position.z = -0.05;
    root.add(leaf);
    return leaf;
  };
  const left = makeLeaf();
  const right = makeLeaf();
  // Sağ kanat aynalanır (180° döndürmek tek yüzlü modelin arkasını kameraya çevirirdi).
  right.scale.x = -1;

  const api: Door = {
    id: d.def.id,
    openAmount: 0,
    collider: toBox(d.collider),
    position: new THREE.Vector3(d.x, 2, d.z),
    update() {
      left.position.y = right.position.y = api.openAmount * LEAF_TRAVEL;
      root.visible = api.openAmount < 0.999;
    },
  };
  return api;
}
