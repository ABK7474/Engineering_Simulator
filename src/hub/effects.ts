// Kısa ömürlü efektler. Dinamik ışıklar baştan oluşturulur (yoğunluk 0) ve gölge üretmez;
// böylece ışık sayısı değişmez, shader yeniden derlenmez.

import * as THREE from 'three';

/** Her kare çağrılan görev; false dönünce listeden çıkar. */
export type Tween = (dt: number, elapsed: number) => boolean;

export class Tweens {
  private items: { fn: Tween; t: number }[] = [];
  add(fn: Tween): void {
    this.items.push({ fn, t: 0 });
  }
  clear(): void {
    this.items = [];
  }
  update(dt: number): void {
    this.items = this.items.filter((it) => {
      it.t += dt;
      return it.fn(dt, it.t);
    });
  }
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

/** Nokta parçacık sistemi: kıvılcım (yerçekimli, parlak) veya duman (yükselen, gri). */
class ParticleSystem {
  private particles: Particle[] = [];
  private geo: THREE.BufferGeometry;
  private positions: Float32Array;
  readonly points: THREE.Points;

  constructor(
    scene: THREE.Scene,
    private max: number,
    material: THREE.PointsMaterial,
    private gravity: number,
    private drag: number,
  ) {
    this.positions = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setDrawRange(0, 0);
    this.points = new THREE.Points(this.geo, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(origin: THREE.Vector3, count: number, velocity: () => THREE.Vector3, life: number): void {
    for (let k = 0; k < count && this.particles.length < this.max; k++) {
      this.particles.push({ pos: origin.clone(), vel: velocity(), life: life * (0.6 + Math.random() * 0.4) });
    }
  }

  get active(): number {
    return this.particles.length;
  }

  update(dt: number): void {
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    this.particles.forEach((p, k) => {
      p.vel.y -= this.gravity * dt;
      p.vel.multiplyScalar(1 - this.drag * dt);
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02 && p.vel.y < 0) {
        p.pos.y = 0.02;
        p.vel.y *= -0.3;
      }
      this.positions.set([p.pos.x, p.pos.y, p.pos.z], k * 3);
    });
    this.geo.setDrawRange(0, this.particles.length);
    this.geo.attributes.position.needsUpdate = true;
  }
}

/** Yumuşak yuvarlak parçacık dokusu (kare noktalar yerine). */
function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  private sparks: ParticleSystem;
  private smoke: ParticleSystem;
  private sparkLight: THREE.PointLight;
  private alarmLight: THREE.PointLight;
  private alarmLamp: THREE.Mesh;
  private alarmOn = false;
  private time = 0;
  private sparkFlash = 0;

  constructor(scene: THREE.Scene, alarmPos: THREE.Vector3) {
    const dot = softDot();
    this.sparks = new ParticleSystem(
      scene,
      200,
      new THREE.PointsMaterial({ map: dot, color: 0xffc060, size: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      9.8,
      0.5,
    );
    this.smoke = new ParticleSystem(
      scene,
      300,
      new THREE.PointsMaterial({ map: dot, color: 0x6a7276, size: 0.3, transparent: true, opacity: 0.4, depthWrite: false }),
      -0.25,
      1.2,
    );
    this.sparkLight = new THREE.PointLight(0xffb050, 0, 5, 2);
    scene.add(this.sparkLight);

    this.alarmLight = new THREE.PointLight(0xff2020, 0, 12, 1.5);
    this.alarmLight.position.copy(alarmPos);
    scene.add(this.alarmLight);
    this.alarmLamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0000, emissiveIntensity: 0 }),
    );
    this.alarmLamp.position.copy(alarmPos).setY(alarmPos.y + 0.15);
    scene.add(this.alarmLamp);
  }

  sparkBurst(at: THREE.Vector3, count = 60): void {
    this.sparks.emit(at, count, () => new THREE.Vector3((Math.random() - 0.7) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3), 0.9);
    this.sparkLight.position.copy(at);
    this.sparkFlash = 0.5;
  }

  smokePuff(at: THREE.Vector3, seconds: number): void {
    let left = seconds;
    const tick = () => {
      this.smoke.emit(at, 3, () => new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3), 3);
      left -= 0.1;
      if (left > 0) setTimeout(tick, 100);
    };
    tick();
  }

  setAlarm(on: boolean): void {
    this.alarmOn = on;
    if (!on) {
      this.alarmLight.intensity = 0;
      (this.alarmLamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.sparkFlash = Math.max(0, this.sparkFlash - dt);
    this.sparkLight.intensity = this.sparkFlash > 0 ? 4 + Math.random() * 6 : 0;
    if (this.alarmOn) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      this.alarmLight.intensity = 1 + 5 * pulse;
      (this.alarmLamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 2 * pulse;
    }
  }
}
