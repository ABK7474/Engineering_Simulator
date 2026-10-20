// 2D trace paneli: numaralı C# programı + izleme tablosu. Oyuncu bozuk adımı seçer ve doğru durumu yazar.
// Three.js'i bilmez; yalnızca cevabı geri bildirir.

import type { DsTraceProblem } from '../../solvers/ds/ds-trace.generate';
import { editableVars, type TraceAnswer } from '../../solvers/ds/ds-trace.outcomes';
import { stateCells, traceColumns } from '../../solvers/ds/ds-trace.report';
import { esc } from '../dom';

export interface TracePanelOptions {
  title: string;
  briefing: string;
  problem: DsTraceProblem;
  onSubmit: (answer: TraceAnswer) => void;
  onCancel: () => void;
  source?: { label: string; onFlag: () => void };
  onSound?: (s: 'click' | 'switch') => void;
}

/** "3, 5 8" ya da "[3, 5, 8]" → [3, 5, 8]; boş → []. Geçersizse null. */
export function parseList(text: string): number[] | null {
  const t = text.trim().replace(/^\[|\]$/g, '').trim();
  if (t === '') return [];
  const parts = t.split(/[\s,;]+/).filter(Boolean);
  const out = parts.map((x) => Number(x));
  return out.every((x) => Number.isInteger(x)) ? out : null;
}

/** Boş ya da "—" → null; tamsayı değilse undefined (geçersiz). */
export function parseVar(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '' || t === '—' || t === '-') return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : undefined;
}

export function openTracePanel(root: HTMLElement, opts: TracePanelOptions): () => void {
  const p = opts.problem;
  const { head } = traceColumns(p);
  let selected: number | null = null;

  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `
    <div class="panel trace-panel" role="dialog" aria-label="${esc(opts.title)}">
      <header class="panel-head">
        <span class="tag">ARIZA</span>
        <h2>${esc(opts.title)}</h2>
        <button class="ghost" data-act="cancel" title="Esc">Geri dön ✕</button>
      </header>
      ${opts.source ? `<p class="source-line">Konu: ${esc(opts.source.label)} <button class="ghost small" data-act="flag">Bu soru hatalı</button></p>` : ''}
      <details class="briefing" open>
        <summary>Brifing</summary>
        <p>${esc(opts.briefing)}</p>
      </details>
      <p class="prompt">${esc(p.template.story)} İzleme kaydında <b>tek bir adım</b> yanlış yazılmış. O adımı seç ve doğru durumu gir.</p>
      <div class="trace-body">
        <pre class="code" aria-label="C# programı">${p.code.map((l, i) => `<span class="ln" data-line="${i + 1}"><i>${i + 1}</i>${esc(l) || ' '}</span>`).join('')}</pre>
        <div class="trace-wrap">
          <table class="trace">
            <thead><tr><th>Adım</th><th>Satır</th><th>İşlem</th>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>
              <tr class="initial"><td>0</td><td>—</td><td>başlangıç</td>${stateCells(p, p.initial).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>
              ${p.rows
                .map(
                  (r, j) =>
                    `<tr data-row="${j}" tabindex="0"><td>${j + 1}</td><td>${r.line}</td><td><code>${esc(r.text)}</code></td>${stateCells(p, p.shown[j])
                      .map((c) => `<td>${esc(c)}</td>`)
                      .join('')}</tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="trace-edit" hidden>
        <h3>Adım <span class="which"></span> için doğru durum</h3>
        <div class="fields"></div>
        <p class="err" hidden>Listeleri virgülle ayrılmış tamsayılar olarak yaz (boş yapı için boş bırak).</p>
        <button class="primary" data-act="submit" disabled>Kaydı düzelt</button>
      </div>
    </div>`;
  root.appendChild(el);

  const edit = el.querySelector<HTMLDivElement>('.trace-edit')!;
  const fields = el.querySelector<HTMLDivElement>('.fields')!;
  const err = el.querySelector<HTMLParagraphElement>('.err')!;
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;
  const vars = editableVars(p);

  const read = (): TraceAnswer | null => {
    if (selected === null) return null;
    const structs: Record<string, number[]> = {};
    for (const s of p.structs) {
      const v = parseList(fields.querySelector<HTMLInputElement>(`[data-struct="${s.name}"]`)!.value);
      if (v === null) return null;
      structs[s.name] = v;
    }
    const out: Record<string, number | null> = {};
    for (const v of vars) {
      const x = parseVar(fields.querySelector<HTMLInputElement>(`[data-var="${v}"]`)!.value);
      if (x === undefined) return null;
      out[v] = x;
    }
    return { row: selected, structs, vars: out };
  };
  const validate = () => {
    const ok = read() !== null;
    err.hidden = ok;
    submit.disabled = !ok;
  };

  const choose = (j: number) => {
    opts.onSound?.('click');
    selected = j;
    el.querySelectorAll('tr[data-row]').forEach((tr) => tr.classList.toggle('selected', Number((tr as HTMLElement).dataset.row) === j));
    el.querySelectorAll('.ln').forEach((ln) => ln.classList.toggle('hl', Number((ln as HTMLElement).dataset.line) === p.rows[j].line));
    const s = p.shown[j];
    edit.hidden = false;
    edit.querySelector('.which')!.textContent = String(j + 1);
    fields.innerHTML =
      p.structs
        .map((d, k) => `<label>${esc(head[k])}<input data-struct="${d.name}" value="${esc(s.structs[d.name].join(', '))}" autocomplete="off"></label>`)
        .join('') +
      vars.map((v) => `<label>${esc(v)}<input data-var="${v}" value="${s.vars[v] ?? ''}" placeholder="—" autocomplete="off"></label>`).join('');
    fields.querySelectorAll('input').forEach((i) => i.addEventListener('input', validate));
    validate();
  };
  el.querySelectorAll<HTMLTableRowElement>('tr[data-row]').forEach((tr) => {
    const j = Number(tr.dataset.row);
    tr.addEventListener('click', () => choose(j));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') choose(j);
    });
  });

  const close = () => {
    window.removeEventListener('keydown', onKey);
    el.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      opts.onCancel();
    }
  };
  window.addEventListener('keydown', onKey);
  el.querySelector('[data-act="flag"]')?.addEventListener('click', () => {
    if (!confirm('Bu soru hatalı olarak işaretlensin mi?')) return;
    close();
    opts.source?.onFlag();
  });
  el.querySelector('[data-act="cancel"]')!.addEventListener('click', () => {
    close();
    opts.onCancel();
  });
  submit.addEventListener('click', () => {
    const a = read();
    if (!a) return;
    opts.onSound?.('switch');
    close();
    opts.onSubmit(a);
  });
  return close;
}
