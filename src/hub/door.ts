// Kayar kapı: iki Door_Metal kanadı (kutu izdüşümü UV ile Poly Haven paslı metal). Çerçeve sabit
// modüllerle birlikte instancing ile çizilir; burada yalnız hareketli kanatlar ve kapalıyken çarpışma var.
// Kanatlar hareketli olduğu için gölge düşürmez (sabit gölge haritası bozulmasın).

import * as THREE from 'three';
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

const LEAF_TRAVEL = 2.15;

export function createDoor(scene: THREE.Scene, assets: Assets, d: DoorLayout): Door {
  // Model tek yüzlü: iki taraftan da görünsün diye çift taraflı.
  const rust = pbrMaterial(assets.rustyMetal, new THREE.Vector2(1, 1), { metalness: 0.8, side: THREE.DoubleSide });
  const root = new THREE.Group();
  root.position.set(d.x, 0, d.z);
  root.rotation.y = d.rotY;
  scene.add(root);
  const makeLeaf = () => {
    const leaf = new THREE.Group();
    const src = assets.models.Door_Metal;
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      leaf.add(new THREE.Mesh(boxProjectUVs(geo, 0.5), rust));
    });
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
      left.position.x = -api.openAmount * LEAF_TRAVEL;
      right.position.x = api.openAmount * LEAF_TRAVEL;
    },
  };
  return api;
}
