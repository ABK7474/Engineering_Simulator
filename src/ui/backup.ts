// ⋯ menüsü: ilerlemeyi .json olarak dışa aktar / içe aktar (altın kural 4).

export interface BackupHandlers {
  /** Yedek dosyasının içeriği. */
  exportJson: () => string;
  /** Dosya metnini doğrulayıp uygular; geçersizse açıklamalı hata fırlatır. */
  importJson: (text: string) => Promise<void>;
}

export function mountBackupMenu(root: HTMLElement, h: BackupHandlers): void {
  const el = document.createElement('div');
  el.className = 'backup-menu';
  el.innerHTML = `
    <button class="ghost menu-toggle" aria-haspopup="true" aria-expanded="false" title="İlerleme yedeği">⋯</button>
    <div class="menu" hidden>
      <button data-act="export">İlerlemeyi dışa aktar (.json)</button>
      <button data-act="import">İlerlemeyi içe aktar…</button>
      <input type="file" accept="application/json,.json" hidden>
    </div>`;
  root.appendChild(el);

  const toggle = el.querySelector<HTMLButtonElement>('.menu-toggle')!;
  const menu = el.querySelector<HTMLDivElement>('.menu')!;
  const file = el.querySelector<HTMLInputElement>('input[type=file]')!;
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(menu.hidden !== false));

  el.querySelector('[data-act="export"]')!.addEventListener('click', () => {
    const blob = new Blob([h.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `derin-muhendis-ilerleme-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
  });

  el.querySelector('[data-act="import"]')!.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    setOpen(false);
    if (!f) return;
    if (!confirm('Mevcut ilerlemenin üzerine yazılsın mı?')) return;
    try {
      await h.importJson(await f.text());
    } catch (e) {
      alert(`İçe aktarılamadı: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
