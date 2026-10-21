// Algoritma izleme paneli: C# kodu + (grafta) komşuluk çizimi + izleme tablosu. Oyuncu bozuk adımı seçer ve o
// satırın doğru durumunu yazar. Trace panelinin görünümünü (sınıflarını) paylaşır.

import { columnHead, editableColumns, fmtCell, type AlgoTraceAnswer, type AlgoTraceProblem } from '../../solvers/algo/algo-trace';
import type { AlgoInput, Cells } from '../../solvers/algo/variants';
import { esc } from '../dom';
import { parseList, parseVar } from '../trace-table/panel';

export interface AlgoPanelOptions {
  title: string;
  briefing: string;
  problem: AlgoTraceProblem;
  onSubmit: (answer: AlgoTraceAnswer) => void;
  onCancel: () => void;
  source?: { label: string; onFlag: () => void };
  onSound?: (s: 'click' | 'switch') => void;
}

/** Yönsüz graf: düğümler çember üzerinde; başlangıç düğümü vurgulu. */
export function graphSvg(g: Extract<AlgoInput, { variant: 'bfs' | 'dfs' }>): string {
  const R = 78;
  const pos = Array.from({ length: g.n }, (_, k) => {
    const t = (2 * Math.PI * k) / g.n - Math.PI / 2;
    return [110 + R * Math.cos(t), 100 + R * Math.sin(t)];
  });
  const edges = g.adj.flatMap((l, a) => l.filter((b) => b > a).map((b) => `<line x1="${pos[a][0].toFixed(1)}" y1="${pos[a][1].toFixed(1)}" x2="${pos[b][0].toFixed(1)}" y2="${pos[b][1].toFixed(1)}" class="wire"/>`));
  const nodes = pos.map(
    ([x, y], k) =>
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" style="fill:#061a1f;stroke:${k === g.start ? 'var(--warn)' : '#e6f4f5'};stroke-width:${k === g.start ? 3 : 2}"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" class="lbl" text-anchor="middle">${k}</text>`,
  );
  return `<svg viewBox="0 0 220 200" class="circuit board algo-graph" aria-label="Ağ grafı">${edges.join('')}${nodes.join('')}</svg>`;
}

function inputInfo(i: AlgoInput): string {
  switch (i.variant) {
    case 'bfs':
    case 'dfs':
      return `Başlangıç düğümü ${i.start}. Komşuluk listeleri (adj): ${i.adj.map((l, k) => `${k}: [${l.join(', ')}]`).join(' · ')}`;
    case 'insertion':
    case 'selection':
      return `Girdi dizisi: [${i.array.join(', ')}]`;
    case 'bst':
      return `Anahtarlar boş ağaca bu sırayla eklenir: ${i.keys.join(', ')}. Sonra ${i.traversal === 'pre' ? 'preorder' : 'postorder'} dolaşma yazdırılır.`;
  }
}

export function openAlgoTracePanel(root: HTMLElement, opts: AlgoPanelOptions): () => void {
  const p = opts.problem;
  const head = p.columns.map(columnHead);
  const cells = (c: Cells) => p.columns.map((col) => `<td>${esc(fmtCell(c[col.id]))}</td>`).join('');
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
      <p class="prompt">${esc(p.story)} ${esc(inputInfo(p.input))} İzleme kaydında <b>tek bir adım</b> yanlış yazılmış. O adımı seç ve doğru durumu gir.</p>
      <div class="trace-body">
        <div>
          <pre class="code" aria-label="C# kodu">${p.code.map((l, i) => `<span class="ln"><i>${i + 1}</i>${esc(l) || ' '}</span>`).join('')}</pre>
          ${p.input.variant === 'bfs' || p.input.variant === 'dfs' ? `<div class="schematic">${graphSvg(p.input)}</div>` : ''}
        </div>
        <div class="trace-wrap">
          <table class="trace">
            <thead><tr><th>Adım</th><th>İşlem</th>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>
              <tr class="initial"><td>0</td><td>başlangıç</td>${cells(p.initial)}</tr>
              ${p.shown.map((r, j) => `<tr data-row="${j}" tabindex="0"><td>${j + 1}</td><td><code>${esc(p.ops[j])}</code></td>${cells(r)}</tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="trace-edit" hidden>
        <h3>Adım <span class="which"></span> için doğru durum</h3>
        <div class="fields"></div>
        <p class="err" hidden>Listeleri virgülle ayrılmış tamsayılar olarak, sayıları tamsayı olarak yaz.</p>
        <button class="primary" data-act="submit" disabled>Kaydı düzelt</button>
      </div>
    </div>`;
  root.appendChild(el);

  const edit = el.querySelector<HTMLDivElement>('.trace-edit')!;
  const fields = el.querySelector<HTMLDivElement>('.fields')!;
  const err = el.querySelector<HTMLParagraphElement>('.err')!;
  const submit = el.querySelector<HTMLButtonElement>('[data-act="submit"]')!;

  const read = (): AlgoTraceAnswer | null => {
    if (selected === null) return null;
    const out: Cells = {};
    for (const col of editableColumns(p, selected)) {
      const text = fields.querySelector<HTMLInputElement>(`[data-col="${col.id}"]`)!.value;
      if (col.kind === 'list') {
        const v = parseList(text);
        if (v === null) return null;
        out[col.id] = v;
      } else {
        const v = parseVar(text);
        if (v === undefined || v === null) return null;
        out[col.id] = v;
      }
    }
    return { row: selected, cells: out };
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
    edit.hidden = false;
    edit.querySelector('.which')!.textContent = String(j + 1);
    const s = p.shown[j];
    fields.innerHTML = editableColumns(p, j)
      .map((col) => {
        const v = s[col.id];
        const text = v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
        return `<label>${esc(columnHead(col))}<input data-col="${col.id}" value="${esc(text)}" autocomplete="off"></label>`;
      })
      .join('');
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
