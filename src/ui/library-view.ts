// Konu kütüphanesi: üç sekme.
// - Konular: ders > konu listesi, durum (klasörden gelen taslak "onay bekliyor"), şablon sayıları, inceleme ve silme.
//   Repodaki onaylı konular (content/library/) salt okunurdur.
// - Klasör (yalnız dev sunucusu): ders_materyalleri/ dosyaları, kuyruk durumu, kota beklemesi, eşleşmeyen klasörler.
// - Ders analizi: soru kalıpları ve öncelikli öneriler.

import type { CourseAnalysis } from '../core/analysis';
import { isFromBook, type Library } from '../core/library';
import type { ItemStatus, QueueView } from '../pipeline/materials-queue';
import { esc } from '../puzzles/dom';
import { analysisHtml } from './analysis-view';

export type LibraryTab = 'topics' | 'folder' | 'analysis';

export interface FolderDeps {
  view: () => QueueView;
  /** Kuyruk değişince çağrılır; dönen fonksiyon aboneliği bitirir. */
  subscribe: (fn: () => void) => () => void;
  force: (path: string) => void;
  retryNow: () => void;
  /** Önerilen modele geç (Ayarlar'daki model alanı) ve hemen dene. */
  useModel: (model: string) => void;
}

export interface LibraryDeps {
  lib: () => Library;
  remove: (id: string) => Promise<void>;
  /** Taslağı incele (onay akışı); kapanınca liste yenilenir. */
  review: (id: string, done: () => void) => void;
  analyses: () => CourseAnalysis[];
  /** Klasör sekmesi (yalnız dev); yoksa null. */
  folder: FolderDeps | null;
  tab?: LibraryTab;
  onClose: () => void;
}

const STATUS: Record<ItemStatus, string> = {
  pending: 'Sırada',
  working: 'İşleniyor…',
  done: 'İşlendi',
  long: 'Uzun: onayını bekliyor',
  'too-big': 'Çok büyük',
  failed: 'Hata',
  'no-course': 'Ders eşleşmedi',
  book: 'Kitap',
};

export function openLibraryView(root: HTMLElement, d: LibraryDeps): void {
  const el = document.createElement('div');
  el.className = 'overlay';
  root.appendChild(el);
  let tab: LibraryTab = d.tab ?? 'topics';
  let course = '';
  let tick: number | null = null;

  const topicsHtml = () => {
    const topics = [...d.lib().topics].sort(
      (a, b) => Number(a.status === 'approved') - Number(b.status === 'approved') || a.courseName.localeCompare(b.courseName, 'tr') || a.name.localeCompare(b.name, 'tr'),
    );
    if (!topics.length) return '<p class="muted">Henüz konu yok. ⋯ → "Konu ekle…" ile bir PDF yükleyebilir ya da dosyaları ders_materyalleri/&lt;ders&gt;/notlar/ klasörüne koyabilirsin.</p>';
    return `<ul class="topic-list">${topics
      .map((t) => {
        const active = t.templates.filter((x) => !x.flagged).length;
        const flagged = t.templates.length - active;
        const state =
          t.status === 'approved'
            ? t.origin === 'repo'
              ? 'Onaylı · repoda'
              : 'Onaylı'
            : t.truncated
              ? '<b class="fail">Eksik taslak: onaylanamaz</b>'
              : '<b class="warn">Yeni taslak: onay bekliyor</b>';
        const src = t.source.path ? `ders_materyalleri/${t.source.path}` : t.source.fileName;
        return `<li><div><b>${esc(t.name)}</b> <span class="muted">· ${esc(t.courseName)}${isFromBook(t) ? ' · kitap' : ''}</span><br>
          <span class="muted">${state} · ${active} şablon oyunda${flagged ? ` · ${flagged} hatalı işaretli` : ''} · kaynak: ${esc(src)}</span></div>
          <span class="row">${t.status === 'draft' ? `<button class="primary" data-review="${esc(t.id)}">İncele</button>` : ''}
          ${t.origin === 'repo' ? '' : `<button class="ghost" data-del="${esc(t.id)}">Sil</button>`}</span></li>`;
      })
      .join('')}</ul>`;
  };

  const folderHtml = (f: FolderDeps) => {
    const v = f.view();
    const secs = v.resumeAt !== null ? Math.max(0, Math.ceil((v.resumeAt - Date.now()) / 1000)) : null;
    const banner =
      v.phase === 'quota'
        ? `<p class="error-box">${esc(v.message ?? '')}${secs !== null ? ` <b data-countdown>${secs}</b> sn sonra yeniden denenecek.` : ''}</p>`
        : v.phase === 'no-key' || v.phase === 'invalid-key'
          ? `<p class="error-box">${esc(v.message ?? '')}</p>`
          : v.phase === 'working'
            ? '<p class="working"><span class="spinner" aria-hidden="true"></span>Dosyalar işleniyor (arka planda; oynamaya devam edebilirsin).</p>'
            : '';
    const actions =
      v.phase === 'quota' || v.phase === 'no-key' || v.phase === 'invalid-key' || v.suggestModel
        ? `<div class="row">${v.phase !== 'idle' && v.phase !== 'working' ? '<button class="primary" data-act="retry">Şimdi dene</button>' : ''}
           ${v.suggestModel ? `<button class="ghost" data-model="${esc(v.suggestModel)}">Modeli ${esc(v.suggestModel)} yap ve dene</button>` : ''}</div>`
        : '';
    const warn = [
      ...v.listing.unmatched.map((u) => `"${esc(u)}" klasörü hiçbir dersle eşleşmedi (content/courses.json'daki ders adı ya da kimliği olmalı).`),
      ...v.listing.splitting.map((b) => `Kitap bölünüyor: ${esc(b)}`),
      ...(v.listing.ignored.length ? [`Düzene uymayan ${v.listing.ignored.length} dosya atlandı: ${v.listing.ignored.slice(0, 5).map(esc).join(', ')}${v.listing.ignored.length > 5 ? '…' : ''}`] : []),
    ];
    const rows = v.items
      .map((i) => {
        const p = i.file.path.split('/').slice(1).join('/');
        const btn = i.status === 'long' ? 'Yine de işle' : i.status === 'failed' ? 'Tekrar dene' : '';
        return `<tr class="st-${i.status}"><td>${esc(i.file.courseDir)}</td><td>${esc(p)}<br><span class="muted">${esc(i.file.name)}${i.file.pages ? ` · ${i.file.pages} sayfa` : ''}</span></td>
          <td>${i.file.kind === 'questions' ? 'soru' : i.file.kind === 'book' ? 'kitap' : 'not'}</td>
          <td>${STATUS[i.status]}${i.message ? `<br><span class="muted">${esc(i.message)}</span>` : ''}</td>
          <td>${btn ? `<button class="ghost" data-force="${esc(i.file.path)}">${btn}</button>` : ''}</td></tr>`;
      })
      .join('');
    return `${banner}${actions}${warn.length ? `<ul class="warnings">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>` : ''}
      <p class="muted">ders_materyalleri/&lt;ders&gt;/notlar|konular (ders notu), sorular|ornek_sorular (soru), kitaplar (git dışında; uzun kitap
        bölümlere ayrılır). Aynı dosya tekrar işlenmez; değişen dosya yeniden işlenir. Uzun PDF senin onayınla gider.</p>
      ${v.items.length ? `<table class="trace folder-table"><thead><tr><th>Ders</th><th>Dosya</th><th>Tür</th><th>Durum</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Klasörde dosya yok.</p>'}`;
  };

  const analysisTab = () => {
    const list = d.analyses();
    if (!list.length) return '<p class="muted">Henüz ders analizi yok. Soru dosyalarını ders_materyalleri/&lt;ders&gt;/sorular/ klasörüne koy.</p>';
    if (!list.some((a) => a.courseId === course)) course = list[0].courseId;
    const a = list.find((x) => x.courseId === course)!;
    return `${list.length > 1 ? `<label>Ders <select name="course">${list.map((x) => `<option value="${esc(x.courseId)}" ${x.courseId === course ? 'selected' : ''}>${esc(x.courseName)}</option>`).join('')}</select></label>` : `<h3>${esc(a.courseName)}</h3>`}
      ${analysisHtml(a)}`;
  };

  const render = () => {
    shown = signature();
    const folder = d.folder;
    const drafts = d.lib().topics.filter((t) => t.status === 'draft' && !t.truncated).length;
    const body = tab === 'topics' ? topicsHtml() : tab === 'folder' && folder ? folderHtml(folder) : analysisTab();
    el.innerHTML = `
      <div class="panel library" role="dialog" aria-label="Konu kütüphanesi">
        <header class="panel-head"><span class="tag ok">KÜTÜPHANE</span><h2>Konu kütüphanesi</h2><button class="ghost" data-act="close">Kapat ✕</button></header>
        <nav class="nb-tabs" role="tablist">
          <button role="tab" data-tab="topics" aria-selected="${tab === 'topics'}">Konular${drafts ? ` <b>${drafts}</b>` : ''}</button>
          ${folder ? `<button role="tab" data-tab="folder" aria-selected="${tab === 'folder'}">Klasör</button>` : ''}
          <button role="tab" data-tab="analysis" aria-selected="${tab === 'analysis'}">Ders analizi</button>
        </nav>
        <section class="lib-body">${body}</section>
      </div>`;
    el.querySelector('[data-act="close"]')!.addEventListener('click', close);
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.tab as LibraryTab;
        render();
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Bu konu, notu ve şablonlarıyla birlikte silinsin mi?')) return;
        await d.remove(b.dataset.del!);
        render();
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((b) => b.addEventListener('click', () => d.review(b.dataset.review!, render)));
    el.querySelectorAll<HTMLButtonElement>('[data-force]').forEach((b) => b.addEventListener('click', () => folder?.force(b.dataset.force!)));
    el.querySelector('[data-act="retry"]')?.addEventListener('click', () => folder?.retryNow());
    el.querySelector<HTMLButtonElement>('[data-model]')?.addEventListener('click', (e) => folder?.useModel((e.currentTarget as HTMLButtonElement).dataset.model!));
    el.querySelector<HTMLSelectElement>('[name="course"]')?.addEventListener('change', (e) => {
      course = (e.target as HTMLSelectElement).value;
      render();
    });
  };
  // Kuyruk değişince yeniden çiz; ama yalnız görünen bir şey değiştiyse (yoklama her 10 sn'de bir gelir; düğmeler
  // tıklanırken yerinden kalkmasın) ve inceleme penceresi üstte değilse
  const signature = () => {
    const v = d.folder?.view();
    return JSON.stringify([v && { ...v, resumeAt: v.resumeAt !== null }, d.lib().topics.map((t) => `${t.id}:${t.status}:${t.templates.length}`), d.analyses().map((a) => a.createdAt)]);
  };
  let shown = signature();
  const unsub = d.folder?.subscribe(() => {
    const overlays = root.querySelectorAll('.overlay');
    const sig = signature();
    if (sig === shown || !el.isConnected || overlays[overlays.length - 1] !== el) return;
    render();
  });
  // Kota geri sayımı: yalnız sayı güncellenir (düğmeler yerinde kalsın)
  tick = window.setInterval(() => {
    const at = d.folder?.view().resumeAt;
    const c = el.querySelector('[data-countdown]');
    if (c && at != null) c.textContent = String(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
  }, 1000);
  function close(): void {
    unsub?.();
    if (tick !== null) clearInterval(tick);
    el.remove();
    d.onClose();
  }
  render();
}
