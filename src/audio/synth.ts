// Kodla üretilen sesler (dosya yok): telsiz cızırtısı, dalış kıyafetinde nefes döngüsü, gövde gıcırtısı.
// Hepsi tek bir beyaz gürültü tamponundan ve osilatörlerden kurulur; gölgelendirici gibi ucuz.

export interface Synth {
  /** Telsiz paraziti: `seconds` boyunca kesik kesik cızırtı (0..1 şiddet). */
  radio: (seconds: number, intensity?: number) => void;
  /** Kıyafet nefesi: açıkken ~4 s'lik nefes al/ver döngüsü. */
  setBreath: (on: boolean) => void;
  /** Gövde gıcırtısı: alçak, uzun bir metal inlemesi. */
  creak: () => void;
  /** Bilek cihazının uyarı bip'i (iki kısa ton). */
  beep: () => void;
}

export function createSynth(ctx: AudioContext, out: AudioNode): Synth {
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noiseSrc = (loop = false) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = loop;
    return s;
  };
  const running = () => ctx.state === 'running';

  let breath: { src: AudioBufferSourceNode; gain: GainNode; timer: number } | null = null;

  return {
    radio(seconds, intensity = 1) {
      if (!running()) return;
      const t0 = ctx.currentTime;
      const src = noiseSrc(true);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1800;
      band.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      // Kesik kesik: rastgele açılıp kapanan zarf
      for (let t = 0; t < seconds; t += 0.06) g.gain.setValueAtTime(Math.random() < 0.55 ? 0.22 * intensity * Math.random() : 0.02, t0 + t);
      g.gain.setValueAtTime(0, t0 + seconds);
      src.connect(band).connect(g).connect(out);
      src.start(t0);
      src.stop(t0 + seconds + 0.05);
    },
    setBreath(on) {
      if (on === Boolean(breath)) return;
      if (!on && breath) {
        clearInterval(breath.timer);
        breath.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
        const b = breath;
        setTimeout(() => b.src.stop(), 800);
        breath = null;
        return;
      }
      if (!running()) return;
      const src = noiseSrc(true);
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(low).connect(gain).connect(out);
      src.start();
      const cycle = () => {
        const t = ctx.currentTime;
        // Nefes al (1,4 s, yükselen), dur, nefes ver (1,8 s, daha kısık ve alçak)
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.11, t + 0.7);
        gain.gain.linearRampToValueAtTime(0, t + 1.4);
        gain.gain.linearRampToValueAtTime(0.07, t + 2.2);
        gain.gain.linearRampToValueAtTime(0, t + 3.4);
        low.frequency.setValueAtTime(1100, t);
        low.frequency.linearRampToValueAtTime(600, t + 3.4);
      };
      cycle();
      breath = { src, gain, timer: window.setInterval(cycle, 4200) };
    },
    beep() {
      if (!running()) return;
      const t0 = ctx.currentTime;
      for (const [k, f] of [[0, 1760], [0.16, 1320]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0 + k);
        g.gain.linearRampToValueAtTime(0.05, t0 + k + 0.01);
        g.gain.linearRampToValueAtTime(0, t0 + k + 0.1);
        osc.connect(g).connect(out);
        osc.start(t0 + k);
        osc.stop(t0 + k + 0.12);
      }
    },
    creak() {
      if (!running()) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(70, t0);
      osc.frequency.exponentialRampToValueAtTime(38, t0 + 2.6);
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 260;
      low.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.35, t0 + 0.4);
      g.gain.linearRampToValueAtTime(0, t0 + 2.8);
      osc.connect(low).connect(g).connect(out);
      osc.start(t0);
      osc.stop(t0 + 3);
    },
  };
}
