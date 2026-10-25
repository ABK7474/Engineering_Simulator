// Ayarlar: LLM API anahtarı (kaydet/sil), model kimliği, "bağlantıyı sına".

import { esc } from '../puzzles/dom';

export interface SettingsDeps {
  providerLabel: string;
  defaultModel: string;
  keyAdvice: string;
  mock: boolean;
  maskedKey: () => string;
  saveKey: (k: string) => void;
  clearKey: () => void;
  model: () => string;
  saveModel: (m: string) => void;
  testConnection: () => Promise<{ ok: boolean; message: string }>;
  /** Oyuncunun adı (replikler). */
  playerName: () => string;
  savePlayerName: (n: string) => void;
  onClose: () => void;
}

export function openSettings(root: HTMLElement, d: SettingsDeps): void {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `
    <div class="panel settings" role="dialog" aria-label="Ayarlar">
      <header class="panel-head"><span class="tag ok">AYAR</span><h2>Ayarlar</h2><button class="ghost" data-act="close">Kapat ✕</button></header>
      <section>
        <h4>Mühendis adı</h4>
        <p class="muted">Ece ve NEREUS sana bu adla seslenir.</p>
        <div class="row"><input name="pname" maxlength="20" spellcheck="false"><button class="ghost" data-act="save-name">Kaydet</button></div>
      </section>
      ${d.mock ? '<p class="error-box">Sahte istemci etkin (<code>?llm=mock</code>): gerçek API çağrısı yapılmaz.</p>' : ''}
      <section>
        <h4>${esc(d.providerLabel)} API anahtarı</h4>
        <p class="muted">Kayıtlı: <span class="masked"></span>. Anahtar yalnız bu tarayıcıda saklanır; yedeğe ve kayıtlara girmez.</p>
        <p class="muted">${esc(d.keyAdvice)}</p>
        <div class="row"><input type="password" name="key" autocomplete="off" spellcheck="false" placeholder="yeni anahtar">
          <button class="primary" data-act="save-key" disabled>Kaydet</button><button class="ghost" data-act="clear-key">Sil</button></div>
      </section>
      <section>
        <h4>Model</h4>
        <p class="muted">Varsayılan: <code>${esc(d.defaultModel)}</code>. Model adı değişirse buradan güncelle.</p>
        <div class="row"><input name="model" spellcheck="false"><button class="ghost" data-act="save-model">Kaydet</button></div>
      </section>
      <section>
        <h4>Bağlantı</h4>
        <div class="row"><button class="primary" data-act="test">Bağlantıyı sına</button><span class="test-result" role="status"></span></div>
      </section>
    </div>`;
  root.appendChild(el);
  const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
  const keyIn = q<HTMLInputElement>('[name="key"]');
  const modelIn = q<HTMLInputElement>('[name="model"]');
  const result = q<HTMLSpanElement>('.test-result');
  const nameIn = q<HTMLInputElement>('[name="pname"]');
  q('[data-act="save-name"]').addEventListener('click', () => {
    d.savePlayerName(nameIn.value);
    render();
  });
  const render = () => {
    nameIn.value = d.playerName();
    q('.masked').textContent = d.maskedKey();
    modelIn.value = d.model();
  };
  keyIn.addEventListener('input', () => (q<HTMLButtonElement>('[data-act="save-key"]').disabled = !keyIn.value.trim()));
  q('[data-act="save-key"]').addEventListener('click', () => {
    d.saveKey(keyIn.value);
    keyIn.value = '';
    result.textContent = '';
    render();
  });
  q('[data-act="clear-key"]').addEventListener('click', () => {
    if (!confirm('Kayıtlı API anahtarı bu tarayıcıdan silinsin mi?')) return;
    d.clearKey();
    render();
  });
  q('[data-act="save-model"]').addEventListener('click', () => {
    d.saveModel(modelIn.value || d.defaultModel);
    render();
  });
  q('[data-act="test"]').addEventListener('click', async () => {
    const btn = q<HTMLButtonElement>('[data-act="test"]');
    btn.disabled = true;
    result.className = 'test-result';
    result.textContent = 'Sınanıyor…';
    const r = await d.testConnection();
    result.className = `test-result ${r.ok ? 'ok' : 'fail'}`;
    result.textContent = r.message;
    btn.disabled = false;
  });
  q('[data-act="close"]').addEventListener('click', () => {
    el.remove();
    d.onClose();
  });
  render();
}
