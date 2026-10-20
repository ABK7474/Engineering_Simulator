// Konu kütüphanesi: ders > konu listesi, durum, şablon sayıları, silme.

import type { Library } from '../core/library';
import { esc } from '../puzzles/dom';

export function openLibraryView(root: HTMLElement, lib: () => Library, d: { remove: (id: string) => Promise<void>; onClose: () => void }): void {
  const el = document.createElement('div');
  el.className = 'overlay';
  root.appendChild(el);
  const render = () => {
    const topics = [...lib().topics].sort((a, b) => a.courseName.localeCompare(b.courseName, 'tr') || a.name.localeCompare(b.name, 'tr'));
    el.innerHTML = `
      <div class="panel library" role="dialog" aria-label="Konu kütüphanesi">
        <header class="panel-head"><span class="tag ok">KÜTÜPHANE</span><h2>Konu kütüphanesi</h2><button class="ghost" data-act="close">Kapat ✕</button></header>
        ${topics.length === 0 ? '<p class="muted">Henüz konu yok. ⋯ → "Konu ekle…" ile bir PDF yükleyebilirsin.</p>' : ''}
        <ul class="topic-list">${topics
          .map((t) => {
            const active = t.templates.filter((x) => !x.flagged).length;
            const flagged = t.templates.length - active;
            return `<li><div><b>${esc(t.name)}</b> <span class="muted">· ${esc(t.courseName)}</span><br>
              <span class="muted">${t.status === 'approved' ? 'Onaylı' : 'Taslak'} · ${active} şablon oyunda${flagged ? ` · ${flagged} hatalı işaretli` : ''}
              · kaynak: ${esc(t.source.fileName)}</span></div>
              <button class="ghost" data-del="${esc(t.id)}">Sil</button></li>`;
          })
          .join('')}</ul>
      </div>`;
    el.querySelector('[data-act="close"]')!.addEventListener('click', () => {
      el.remove();
      d.onClose();
    });
    el.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Bu konu, notu ve şablonlarıyla birlikte silinsin mi?')) return;
        await d.remove(b.dataset.del!);
        render();
      }),
    );
  };
  render();
}
