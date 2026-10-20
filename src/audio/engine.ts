// Web Audio ses motoru. Müzik akış olarak (HTMLAudioElement) çalar, kısa efektler belleğe
// çözülür. Tarayıcılar sesi kullanıcı etkileşiminden önce başlatmaz: bağlam askıda oluşturulur,
// "Tıkla ve başla" tıklamasında start() ile açılır.

import { layerGains, type VolumeSettings } from './mix';

export type SfxName =
  | 'door_open'
  | 'door_close'
  | 'click'
  | 'switch'
  | 'spark'
  | 'led_pop'
  | 'fuse'
  | 'jam'
  | 'step';

const SFX: Record<SfxName, string[]> = {
  door_open: ['kenney_sci-fi-sounds/doorOpen_000', 'kenney_sci-fi-sounds/doorOpen_001', 'kenney_sci-fi-sounds/doorOpen_002'],
  door_close: ['kenney_sci-fi-sounds/doorClose_000', 'kenney_sci-fi-sounds/doorClose_001', 'kenney_sci-fi-sounds/doorClose_002'],
  click: ['kenney_interface-sounds/click_001', 'kenney_interface-sounds/click_002'],
  switch: ['kenney_interface-sounds/switch_002'],
  spark: [1, 2, 3, 4].map((k) => `kenney_interface-sounds/glitch_00${k}`),
  led_pop: ['kenney_impact-sounds/impactGlass_light_000'],
  fuse: ['kenney_sci-fi-sounds/lowFrequency_explosion_001'],
  jam: ['kenney_impact-sounds/impactMetal_heavy_001'],
  step: [0, 1, 2, 3, 4].map((k) => `kenney_impact-sounds/footstep_concrete_00${k}`),
};
const LEAK = 'kenney_sci-fi-sounds/slime_001';

const MUSIC = {
  calm: ['hub/underwater-theme-ii', 'hub/underwater-theme-2nd-variation', 'hub/submerge-coral-reef'],
  tension: ['tension/insistent', 'tension/searching'],
};

export interface PlayOptions {
  volume?: number;
  /** Saniye cinsinden gecikme. */
  delay?: number;
  /** ± oransal hız/perde sapması (çeşitlilik için). */
  pitchJitter?: number;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private musicBus: GainNode;
  private sfxBus: GainNode;
  private calmGain: GainNode;
  private tensionGain: GainNode;
  private leakGain: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private calmEl: HTMLAudioElement;
  private tensionEl: HTMLAudioElement;
  private started = false;
  private tension = 0;

  constructor(private base: string) {
    this.ctx = new AudioContext();
    this.master = this.node(this.ctx.destination);
    this.musicBus = this.node(this.master);
    this.sfxBus = this.node(this.master);
    this.calmGain = this.node(this.musicBus);
    this.tensionGain = this.node(this.musicBus, 0);
    this.leakGain = this.node(this.sfxBus, 0);
    this.calmEl = this.playlist(MUSIC.calm, this.calmGain);
    this.tensionEl = this.playlist(MUSIC.tension, this.tensionGain);
  }

  /** Kısa efektleri indirip çözer (müzik akış olduğu için burada yüklenmez). */
  async load(): Promise<void> {
    const names = [...new Set([...Object.values(SFX).flat(), LEAK])];
    await Promise.all(
      names.map(async (n) => {
        const res = await fetch(`${this.base}audio/sfx/${n}.ogg`);
        if (!res.ok) throw new Error(`Ses yüklenemedi: ${n} (${res.status})`);
        this.buffers.set(n, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      }),
    );
  }

  /** Kullanıcı etkileşimi içinde çağrılmalı. Tekrar çağrılması zararsız. */
  async start(): Promise<void> {
    await this.ctx.resume();
    if (this.started) return;
    this.started = true;
    void this.calmEl.play().catch(() => {});
    void this.tensionEl.play().catch(() => {});
    const leak = this.ctx.createBufferSource();
    leak.buffer = this.buffers.get(LEAK) ?? null;
    leak.loop = true;
    leak.connect(this.leakGain);
    leak.start();
  }

  applySettings(s: VolumeSettings): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
  }

  /** 0 = sakin, 1 = tam gerilim; `seconds` içinde çapraz geçiş yapar. */
  setTension(level: number, seconds = 2): void {
    this.tension = level;
    const g = layerGains(level);
    const t = this.ctx.currentTime;
    for (const [node, v] of [
      [this.calmGain, g.calm],
      [this.tensionGain, g.tension],
    ] as const) {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(v, t + seconds);
    }
  }

  get tensionLevel(): number {
    return this.tension;
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    if (this.ctx.state !== 'running') return;
    const variants = SFX[name];
    const buf = this.buffers.get(variants[Math.floor(Math.random() * variants.length)]);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const j = opts.pitchJitter ?? 0;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * j;
    const g = this.node(this.sfxBus, opts.volume ?? 1);
    src.connect(g);
    src.onended = () => g.disconnect();
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }

  /** Kıvılcım: kısa çıtırtılar düzensiz aralıklarla. */
  sparks(seconds = 0.5): void {
    for (let t = 0; t < seconds; t += 0.04 + Math.random() * 0.08) this.play('spark', { delay: t, volume: 0.6, pitchJitter: 0.25 });
  }

  /** İki tonlu siren, kodda üretilir; en fazla `seconds` sürer. */
  alarm(seconds: number): void {
    if (this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    const env = this.node(this.sfxBus, 0);
    osc.connect(filter).connect(env);
    const period = 0.45;
    for (let t = 0; t < seconds; t += period) osc.frequency.setValueAtTime(Math.round(t / period) % 2 ? 620 : 830, t0 + t);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.18, t0 + 0.05);
    env.gain.setValueAtTime(0.18, t0 + seconds - 0.4);
    env.gain.linearRampToValueAtTime(0, t0 + seconds);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.05);
    osc.onended = () => env.disconnect();
    this.counts.alarm = (this.counts.alarm ?? 0) + 1;
  }

  /** Sızıntı döngüsünün yüksekliği (0..1), mesafeye göre hub ayarlar. */
  setLeakVolume(v: number): void {
    this.leakGain.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.1);
  }

  /** Geliştirme/test için: hangi sesin kaç kez çaldığı. */
  readonly counts: Record<string, number> = {};

  private node(to: AudioNode, gain = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(to);
    return g;
  }

  private playlist(tracks: string[], out: GainNode): HTMLAudioElement {
    const el = new Audio();
    el.preload = 'auto';
    let k = 0;
    el.src = `${this.base}audio/music/${tracks[0]}.ogg`;
    el.addEventListener('ended', () => {
      k = (k + 1) % tracks.length;
      el.src = `${this.base}audio/music/${tracks[k]}.ogg`;
      void el.play().catch(() => {});
    });
    this.ctx.createMediaElementSource(el).connect(out);
    return el;
  }
}
