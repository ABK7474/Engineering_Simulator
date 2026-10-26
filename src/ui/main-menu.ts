// Ana menü: açılışta (ve oyun içinden "Ana menü" ile) tam ekran. Arka planda hub'ın 'menu' düzeni: istasyonun dışında
// süzülen kamera. Devam et (kayıt varsa), Yeni oyun (ad, prolog görüldüyse "Prologu atla"; kayıt varsa önce onay),
// Ayarlar, Kontroller, Kütüphane. Yalnız gösterir; kaydı, sıfırlamayı ve oyunu başlatmayı main yapar.

import { esc } from '../puzzles/dom';
import { controlsHtml } from './controls-help';

export type MenuItem = 'continue' | 'new' | 'settings' | 'controls' | 'library';

/** Menüde görünen seçenekler (sırasıyla). "Devam et" yalnız kayıt varsa. */
export function menuItems(hasSave: boolean): MenuItem[] {
  return [...(hasSave ? (['continue'] as const) : []), 'new', 'settings', 'controls', 'library'];
}

/** Yeni oyun kayıt varsa onay ister (kayıt silinir). */
export const newGameNeedsConfirm = (hasSave: boolean) => hasSave;

const LABELS: Record<MenuItem, string> = {
  continue: 'Devam et',
  new: 'Yeni oyun',
  settings: 'Ayarlar',
  controls: 'Kontroller',
  library: 'Kütüphane',
};

export interface MainMenuInfo {
  hasSave: () => boolean;
  /** "Prologu atla" kutusu gösterilsin mi (prolog daha önce görüldü). */
  canSkipPrologue: () => boolean;
  playerName: () => string;
  /** Kaydı ve kütüphaneyi bilen özet satırı (ör. "Bölüm 2 · 5/12 arıza"); yoksa boş. */
  saveSummary: () => string;
  onContinue: () => void;
  onNewGame: (o: { name: string; skipPrologue: boolean }) => void;
  /** Kayıt silinsin (main sıfırlar ve sayfayı yeniler; yenilenince ad adımı açılır). */
  onReset: () => void;
  /** Ekranlar menünün üstünde açılır; kapanınca menüye dönülür. */
  onSettings: (onClose: () => void) => void;
  onLibrary: (onClose: () => void) => void;
  /** Menüdeki ilk tıklama (tarayıcı sesi ancak kullanıcı etkileşimiyle başlatır). */
  onFirstInteraction: () => void;
}

export interface MainMenu {
  readonly open: boolean;
  show: (step?: 'main' | 'name') => void;
  hide: () => void;
}

export function mountMainMenu(root: HTMLElement, info: MainMenuInfo): MainMenu {
  const el = document.createElement('div');
  el.className = 'main-menu';
  el.hidden = true;
  root.appendChild(el);
  let interacted = false;
  el.addEventListener('pointerdown', () => {
    if (interacted) return;
    interacted = true;
    info.onFirstInteraction();
  });
  // Menü açıkken oyun tuşları (E, M, N, rakamlar) oyuna gitmesin
  el.addEventListener('keydown', (e) => e.stopPropagation());

  const frame = (body: string) => `
    <div class="main-menu-inner">
      <h1>Derin Mühendis</h1>
      <p class="main-menu-season">Sezon 1 · Terk edilmiş istasyon</p>
      ${body}
    </div>`;

  const mainStep = () => {
    const summary = info.hasSave() ? info.saveSummary() : '';
    el.innerHTML = frame(`
      <nav class="main-menu-items">
        ${menuItems(info.hasSave())
          .map((m, i) => `<button class="${i === 0 ? 'primary' : 'ghost'}" data-menu="${m}">${LABELS[m]}</button>`)
          .join('')}
      </nav>
      ${summary ? `<p class="main-menu-save">${esc(summary)}</p>` : ''}`);
    el.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((b) =>
      b.addEventListener('click', () => {
        const m = b.dataset.menu as MenuItem;
        if (m === 'continue') {
          hide();
          info.onContinue();
        } else if (m === 'new') {
          if (newGameNeedsConfirm(info.hasSave())) confirmStep();
          else nameStep();
        } else if (m === 'settings') away(info.onSettings);
        else if (m === 'library') away(info.onLibrary);
        else controlsStep();
      }),
    );
    el.querySelector<HTMLButtonElement>('[data-menu]')?.focus();
  };

  const confirmStep = () => {
    el.innerHTML = frame(`
      <div class="main-menu-card" role="alertdialog" aria-label="Kayıt silinsin mi?">
        <p><b>Kayıt silinsin mi?</b></p>
        <p class="muted">Yeni oyun bütün ilerlemeyi siler (onarımlar, kaynaklar, defter). Konu kütüphanen kalır.
          Önce ⋯ menüsünden yedek almak isteyebilirsin.</p>
        <footer>
          <button class="ghost" data-menu="back">Vazgeç</button>
          <button class="danger" data-menu="reset">Sil ve yeni oyun</button>
        </footer>
      </div>`);
    el.querySelector('[data-menu="back"]')!.addEventListener('click', mainStep);
    el.querySelector('[data-menu="reset"]')!.addEventListener('click', () => info.onReset());
  };

  const nameStep = () => {
    el.innerHTML = frame(`
      <form class="main-menu-card" data-menu="name-form">
        <label class="main-menu-name">Adın <input name="pname" maxlength="20" spellcheck="false" autocomplete="off"></label>
        ${info.canSkipPrologue() ? '<label class="main-menu-skip"><input type="checkbox" name="skip"> Prologu atla</label>' : ''}
        <footer>
          <button type="button" class="ghost" data-menu="back">Geri</button>
          <button type="submit" class="primary" data-menu="start">Başla</button>
        </footer>
      </form>`);
    const form = el.querySelector<HTMLFormElement>('form')!;
    const input = form.querySelector<HTMLInputElement>('input[name="pname"]')!;
    input.value = info.playerName();
    form.querySelector('[data-menu="back"]')!.addEventListener('click', mainStep);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const skip = form.querySelector<HTMLInputElement>('input[name="skip"]')?.checked ?? false;
      hide();
      info.onNewGame({ name: input.value, skipPrologue: skip });
    });
    input.focus();
    input.select();
  };

  const controlsStep = () => {
    el.innerHTML = frame(`
      <div class="main-menu-card">
        ${controlsHtml()}
        <footer><button class="primary" data-menu="back">Geri</button></footer>
      </div>`);
    el.querySelector('[data-menu="back"]')!.addEventListener('click', mainStep);
  };

  /** Menünün üstünde başka ekran (ayarlar, kütüphane): menü gizlenir, kapanınca geri gelir. */
  const away = (open: (onClose: () => void) => void) => {
    el.hidden = true;
    open(() => {
      el.hidden = false;
      mainStep();
    });
  };

  const hide = () => {
    el.hidden = true;
    el.innerHTML = '';
    document.body.classList.remove('in-menu');
  };

  return {
    get open() {
      return !el.hidden;
    },
    show(step = 'main') {
      el.hidden = false;
      document.body.classList.add('in-menu');
      if (step === 'name') nameStep();
      else mainStep();
    },
    hide,
  };
}
