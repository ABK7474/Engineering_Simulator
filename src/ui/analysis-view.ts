// Ders analizi sayfası (Kütüphane → Ders analizi): soru kalıpları, kapsama ve öncelikli öneriler. Yalnız gösterir;
// her metin kaçışlanır (LLM çıktısı HTML olarak yorumlanmaz).

import type { CourseAnalysis, Fit } from '../core/analysis';
import { PROBLEM_CATALOG } from '../core/problem-catalog';
import { esc } from '../puzzles/dom';

const FIT: Record<Fit, string> = { full: 'karşılıyor', partial: 'kısmen', none: 'karşılamıyor' };
const dec = (n: number) => String(n).replace('.', ',');

export function analysisHtml(a: CourseAnalysis): string {
  const m = a.merged;
  const pct = (n: number) => (m.questionCount ? Math.round((n / m.questionCount) * 100) : 0);
  return `
    <p class="muted">${a.files.length} dosya, ${m.questionCount} soru · ${esc(a.createdAt.slice(0, 10))} · model ${esc(a.model)}.
      Her dosya ayrı analiz edildi, ders düzeyinde kodla birleştirildi. <b>LLM önerisidir</b>; oyundaki sorulara dokunmaz.</p>
    <h4>Öneriler (öncelik sırasıyla)</h4>
    ${
      m.recommendations.length
        ? `<ol class="an-recs">${m.recommendations
            .map(
              (r) => `<li><b>${esc(r.name)}</b> <span class="tag ${r.kind === 'new-type' ? 'warn' : 'note'}">${r.kind === 'new-type' ? 'yeni tür' : 'soru biçimi'}</span>
              <br>${esc(r.description)}<br><span class="muted">Karşıladığı kalıplar: ${esc(r.covers.join(', ') || '—')} · karşılanmayan yük ${dec(r.uncovered)} soru · ${r.files} dosyada önerildi</span></li>`,
            )
            .join('')}</ol>`
        : '<p class="muted">Öneri yok: kalıpların hepsi mevcut türlerle karşılanıyor.</p>'
    }
    <h4>Kapsama</h4>
    <div class="an-cover" role="img" aria-label="Tam ${pct(m.coverage.full)}%, kısmen ${pct(m.coverage.partial)}%, karşılanmıyor ${pct(m.coverage.none)}%">
      <span class="full" style="flex:${m.coverage.full}"></span><span class="partial" style="flex:${m.coverage.partial}"></span><span class="none" style="flex:${m.coverage.none}"></span>
    </div>
    <p class="muted">Tam %${pct(m.coverage.full)} · kısmen %${pct(m.coverage.partial)} · karşılanmıyor %${pct(m.coverage.none)}</p>
    <table class="trace an-table"><thead><tr><th>Kalıp</th><th>Soru</th><th>Adım</th><th>Mevcut tür</th><th>Uyum</th></tr></thead><tbody>
      ${m.patterns
        .map(
          (p) => `<tr class="fit-${p.fit}"><td>${esc(p.name)}<br><span class="muted">${esc(p.description)}</span></td><td>${p.count}</td><td>${p.steps}</td>
          <td>${p.coveredBy ? esc(PROBLEM_CATALOG[p.coveredBy].label) : '—'}</td><td>${FIT[p.fit]}</td></tr>`,
        )
        .join('')}
    </tbody></table>
    <div class="an-grid">
      <section><h4>Konu ağırlığı</h4><ul class="an-bars">${m.topics
        .map((t) => `<li><span>${esc(t.name)}</span><i style="width:${Math.min(100, t.weight)}%"></i><b>%${dec(t.weight)}</b></li>`)
        .join('')}</ul>
        <p class="muted">Adım sayısı: en az ${m.steps.min}, tipik ${m.steps.typical}, en çok ${m.steps.max}.</p></section>
      <section><h4>Tipik tuzaklar</h4><ul>${m.traps.map((t) => `<li>${esc(t.text)}${t.files > 1 ? ` <span class="muted">(${t.files} dosya)</span>` : ''}</li>`).join('') || '<li class="muted">—</li>'}</ul></section>
      <section><h4>Sayı aralıkları</h4><ul>${m.ranges.map((r) => `<li>${esc(r.quantity)}: ${dec(r.min)} … ${dec(r.max)} ${esc(r.unit)}</li>`).join('') || '<li class="muted">—</li>'}</ul></section>
      <section><h4>Hocanın notasyonu</h4><ul>${m.notation.map((n) => `<li><code>${esc(n.symbol)}</code> ${esc(n.meaning)}</li>`).join('') || '<li class="muted">—</li>'}</ul></section>
    </div>
    <p class="muted">Dosyalar: ${a.files.map((f) => `${esc(f.path)} (${f.analysis.questionCount} soru)`).join(' · ')}</p>`;
}
