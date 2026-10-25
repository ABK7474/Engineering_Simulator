// Defter (N): üç sekme. Tekrar: konuların Leitner kutuları ve zamanı gelenler için pratik; Formüller: denenmiş
// konuların brifing özetleri; Kayıtlar: durumlarla açılan istasyon kayıtları. Yalnız gösterir; kararı main verir.

import type { FormulaPage, StationLog } from '../core/notebook';
import { esc } from '../puzzles/dom';

export interface ReviewRow {
  key: string;
  courseName: string;
  topicName: string;
  box: number;
  dueLabel: string;
  due: boolean;
  /** Bu konu için pratik yapılabilecek aşama var mı. */
  practicable: boolean;
}

export interface GoalView {
  title: string;
  summary: string;
  done: boolean;
  steps: { label: string; why: string; done: boolean }[];
}

export interface NotebookView {
  /** Sezon hedefi: yollar ve adımları (her onarımın nedeni). */
  goals: { title: string; objectives: GoalView[] };
  review: ReviewRow[];
  formulas: FormulaPage[];
  logs: StationLog[];
  totalLogs: number;
}

export type NotebookTab = 'goals' | 'review' | 'formulas' | 'logs';

const boxes = (b: number) => `<span class="boxes" aria-label="Kutu ${b}/5">${'●'.repeat(b)}${'○'.repeat(5 - b)}</span>`;

export function openNotebook(root: HTMLElement, v: NotebookView, opts: { tab?: NotebookTab; onPractice: (key: string) => void; onClose: () => void }): () => void {
  const el = document.createElement('div');
  el.className = 'overlay';
  const due = v.review.filter((r) => r.due).length;
  el.innerHTML = `
    <div class="panel wide notebook" role="dialog" aria-label="Defter">
      <header class="panel-head">
        <span class="tag note">DEFTER</span>
        <h2>Mühendis defteri</h2>
        <button class="ghost" data-act="close" title="Esc ya da N">Kapat ✕</button>
      </header>
      <nav class="nb-tabs" role="tablist">
        <button role="tab" data-tab="goals">Hedefler</button>
        <button role="tab" data-tab="review">Tekrar${due ? ` <b>${due}</b>` : ''}</button>
        <button role="tab" data-tab="formulas">Formüller</button>
        <button role="tab" data-tab="logs">Kayıtlar <span class="dim">${v.logs.length}/${v.totalLogs}</span></button>
      </nav>
      <section data-page="goals" hidden>
        <p class="how"><b>${esc(v.goals.title)}.</b> İki yol var; ikisi de hazır olunca gemiyle bağlantı kurulur.</p>
        ${v.goals.objectives
          .map(
            (o) => `<article class="nb-page"><h3>${esc(o.title)} ${o.done ? '<span class="dim">tamam</span>' : ''}</h3><p>${esc(o.summary)}</p>
            <ol class="nb-goal">${o.steps.map((st) => `<li class="${st.done ? 'done' : ''}">${esc(st.label)}<span class="dim">${esc(st.why)}</span></li>`).join('')}</ol></article>`,
          )
          .join('')}
      </section>
      <section data-page="review" hidden>
        ${
          v.review.length
            ? `<p class="how">Doğru çözdüğün konular kutuda ilerler; aralık 1, 3, 7, 14, 30 gün. Yanlışta konu başa döner ve 10 dakika sonra yeniden gelir. Pratik kaynak harcatmaz.</p>
          <table class="trace nb-review"><thead><tr><th>Ders</th><th>Konu</th><th>Kutu</th><th>Tekrar</th><th></th></tr></thead><tbody>
          ${v.review
            .map(
              (r) =>
                `<tr class="${r.due ? 'due' : ''}"><td>${esc(r.courseName)}</td><td>${esc(r.topicName)}</td><td>${boxes(r.box)}</td><td>${esc(r.dueLabel)}</td><td>${
                  r.practicable ? `<button class="${r.due ? 'primary' : 'ghost'} small" data-practice="${esc(r.key)}">Pratik</button>` : ''
                }</td></tr>`,
            )
            .join('')}
          </tbody></table>`
            : '<p class="how">Henüz denenmiş konu yok. Bir arızayı onarmayı denediğinde konusu buraya eklenir.</p>'
        }
      </section>
      <section data-page="formulas" hidden>
        ${
          v.formulas.length
            ? v.formulas
                .map(
                  (f) => `<article class="nb-page"><h3>${esc(f.topicName)} <span class="dim">${esc(f.courseName)}</span> ${boxes(f.box)}</h3>
                  ${f.notes.map((n) => `<p><b>${esc(n.title)}.</b> ${esc(n.text)}</p>`).join('')}</article>`,
                )
                .join('')
            : '<p class="how">Formül sayfaları, bir konuyu ilk kez denediğinde açılır.</p>'
        }
      </section>
      <section data-page="logs" hidden>
        ${
          v.logs.length
            ? v.logs.map((l) => `<article class="nb-page"><h3>${esc(l.title)}</h3><p>${esc(l.text)}</p></article>`).join('')
            : '<p class="how">İstasyon kayıtları, sistemleri onardıkça açılır.</p>'
        }
      </section>
    </div>`;
  root.appendChild(el);
  const show = (tab: NotebookTab) => {
    el.querySelectorAll<HTMLElement>('[data-page]').forEach((s) => (s.hidden = s.dataset.page !== tab));
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  };
  show(opts.tab ?? (due ? 'review' : 'goals'));
  el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as NotebookTab)));
  const close = () => {
    window.removeEventListener('keydown', onKey);
    el.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.code === 'KeyN') {
      e.preventDefault();
      close();
      opts.onClose();
    }
  };
  window.addEventListener('keydown', onKey);
  el.querySelector('[data-act="close"]')!.addEventListener('click', () => {
    close();
    opts.onClose();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-practice]').forEach((b) =>
    b.addEventListener('click', () => {
      close();
      opts.onPractice(b.dataset.practice!);
    }),
  );
  return close;
}
