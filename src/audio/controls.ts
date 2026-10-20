// Ses çubukları + sessize alma. Ayarlar tarayıcıda (localStorage) hatırlanır; depolama
// kapalıysa (gizli pencere vb.) varsayılanlarla sessizce devam eder.

import { parseSettings, type VolumeSettings } from './mix';

const KEY = 'derin-muhendis.audio';

export function loadSettings(): VolumeSettings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return parseSettings(null);
  }
}

function saveSettings(s: VolumeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* depolama yok: bu oturumluk kalır */
  }
}

export function mountAudioControls(root: HTMLElement, initial: VolumeSettings, onChange: (s: VolumeSettings) => void): void {
  let s = { ...initial };
  const el = document.createElement('div');
  el.className = 'audio-controls';
  el.innerHTML = `
    <button class="mute" title="Sessize al (M)" aria-label="Sessize al"></button>
    <label>Müzik <input type="range" min="0" max="100" data-k="music" aria-label="Müzik sesi"></label>
    <label>Efekt <input type="range" min="0" max="100" data-k="sfx" aria-label="Efekt sesi"></label>`;
  root.appendChild(el);

  const mute = el.querySelector<HTMLButtonElement>('.mute')!;
  const sliders = [...el.querySelectorAll<HTMLInputElement>('input[type=range]')];
  const render = () => {
    mute.textContent = s.muted ? '🔇' : '🔊';
    mute.classList.toggle('on', s.muted);
    for (const r of sliders) r.value = String(Math.round(s[r.dataset.k as 'music' | 'sfx'] * 100));
  };
  const commit = (next: VolumeSettings) => {
    s = next;
    render();
    saveSettings(s);
    onChange(s);
  };

  mute.addEventListener('click', () => commit({ ...s, muted: !s.muted }));
  for (const r of sliders) {
    r.addEventListener('input', () => commit({ ...s, [r.dataset.k as 'music' | 'sfx']: Number(r.value) / 100 }));
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) commit({ ...s, muted: !s.muted });
  });
  render();
}
