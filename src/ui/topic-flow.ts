// "Konu ekle" akışı: ders + konu adı + PDF → (anahtar sorusu) → .md üretimi → inceleme ve onay →
// şablon üretimi → rapor. ders_materyalleri/ klasöründen gelen taslak doğrudan incelemeden başlar.
// LLM çıktısı hiçbir yerde HTML olarak yorumlanmaz (textarea/esc).

import type { ApproveEdits, Topic } from '../core/library';
import { BRIEFING_LIMIT } from '../core/library';
import { checkPdf, inspectPdf } from '../core/pdf';
import { TYPE_LABEL, type Course, type DraftInput } from '../pipeline/topic-pipeline';
import { esc } from '../puzzles/dom';

export interface KeyDeps {
  providerLabel: () => string;
  keyAdvice: string;
  saveKey: (key: string) => void;
}

const keyFormHtml = (d: KeyDeps, why: string) => `
  <p>${esc(why)} ${esc(d.providerLabel())} API anahtarın gerekiyor. Anahtar <b>yalnız bu tarayıcıda</b> saklanır;
  koda, yedeğe ve kayıtlara girmez. Sonradan ⋯ → Ayarlar'dan değiştirebilirsin.</p>
  <p class="muted">${esc(d.keyAdvice)}</p>
  <label class="key-row">Anahtar <input type="password" name="key" autocomplete="off" spellcheck="false"></label>
  <footer><button class="ghost" data-act="skip">Şimdilik atla</button><button class="primary" data-act="save" disabled>Kaydet ve devam et</button></footer>`;

function bindKeyForm(el: HTMLElement, d: KeyDeps, onSave: () => void, onSkip: () => void): void {
  const keyIn = el.querySelector<HTMLInputElement>('[name="key"]')!;
  const save = el.querySelector<HTMLButtonElement>('[data-act="save"]')!;
  keyIn.addEventListener('input', () => (save.disabled = !keyIn.value.trim()));
  save.addEventListener('click', () => {
    d.saveKey(keyIn.value);
    keyIn.value = '';
    onSave();
  });
  el.querySelector('[data-act="skip"]')!.addEventListener('click', onSkip);
}

/** Klasör kuyruğu için tek başına anahtar sorusu; kaydedilirse true. */
export function askApiKey(root: HTMLElement, d: KeyDeps): Promise<boolean> {
  return new Promise((done) => {
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="panel topic-flow" role="dialog" aria-label="API anahtarı">
      <header class="panel-head"><span class="tag ok">İÇERİK</span><h2>ders_materyalleri/ için API anahtarı</h2></header>
      ${keyFormHtml(d, 'Klasöre eklediğin notları ve soruları işlemek için')}</div>`;
    root.appendChild(el);
    const end = (ok: boolean) => {
      el.remove();
      done(ok);
    };
    bindKeyForm(el, d, () => end(true), () => end(false));
  });
}

export interface TopicFlowDeps {
  courses: Course[];
  /** Görünen sağlayıcı ve model adı. */
  providerLabel: () => string;
  /** Sağlayıcıya özgü anahtar güvenliği önerisi. */
  keyAdvice: string;
  needsKey: () => boolean;
  saveKey: (key: string) => void;
  createDraft: (input: DraftInput) => Promise<Topic>;
  approve: (t: Topic, edits: ApproveEdits) => Promise<Topic>;
  generate: (t: Topic) => Promise<Topic>;
  onClose: () => void;
}

/** `start` verilirse form atlanır, taslağın incelemesiyle başlar (klasörden gelen taslak; PDF önizleme için). */
export function openTopicFlow(root: HTMLElement, deps: TopicFlowDeps, start?: { draft: Topic; pdf: Uint8Array | null }): void {
  const el = document.createElement('div');
  el.className = 'overlay';
  root.appendChild(el);
  let pdfUrl: string | null = null;
  const close = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    el.remove();
    deps.onClose();
  };
  const show = (html: string) => {
    el.innerHTML = `<div class="panel topic-flow" role="dialog" aria-label="Konu ekle">${html}</div>`;
    el.querySelector('[data-act="close"]')?.addEventListener('click', close);
  };
  const head = (title: string) =>
    `<header class="panel-head"><span class="tag ok">İÇERİK</span><h2>${esc(title)}</h2><button class="ghost" data-act="close">Kapat ✕</button></header>`;
  const fail = (msg: string, retry?: () => void) => {
    show(`${head('Bir sorun oldu')}<p class="error-box">${esc(msg)}</p>
      <footer>${retry ? '<button class="primary" data-act="retry">Tekrar dene</button>' : ''}<button class="ghost" data-act="close">Kapat</button></footer>`);
    if (retry) el.querySelector('[data-act="retry"]')!.addEventListener('click', retry);
  };
  const working = (msg: string) =>
    show(`${head('Çalışıyor')}<p class="working"><span class="spinner" aria-hidden="true"></span>${esc(msg)}</p>
      <p class="muted">Bu birkaç dakika sürebilir; pencereyi kapatma.</p>`);

  // ---------------------------------------------------------------- 1. form
  const form = () => {
    show(`${head('Konu ekle')}
      <div class="form-grid">
        <label>Ders <select name="course">${deps.courses.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
        <label>Konu adı <input name="name" maxlength="80" placeholder="örn. Seri ve paralel devreler"></label>
        <label>PDF <input name="pdf" type="file" accept="application/pdf,.pdf"></label>
      </div>
      <p class="pdf-info muted"></p>
      <ul class="warnings"></ul>
      <p class="course-note muted"></p>
      <footer><button class="ghost" data-act="close">Vazgeç</button><button class="primary" data-act="next" disabled>PDF'ten not çıkar</button></footer>`);
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    const courseSel = q<HTMLSelectElement>('[name="course"]');
    const nameIn = q<HTMLInputElement>('[name="name"]');
    const fileIn = q<HTMLInputElement>('[name="pdf"]');
    const next = q<HTMLButtonElement>('[data-act="next"]');
    let picked: { file: File; bytes: Uint8Array; pages: number | null } | null = null;
    let blocking = true;

    const courseNote = () => {
      const c = deps.courses.find((x) => x.id === courseSel.value)!;
      q('.course-note').textContent = c.problemTypes.length
        ? `Bu ders için üretilecek problem türleri: ${c.problemTypes.map((t) => TYPE_LABEL[t]).join(', ')}.`
        : 'Bu ders için henüz oyun problem türü yok: yalnız .md notu ve brifing özeti saklanır.';
    };
    const refresh = () => (next.disabled = blocking || !nameIn.value.trim());
    courseSel.addEventListener('change', courseNote);
    nameIn.addEventListener('input', refresh);
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files?.[0];
      picked = null;
      blocking = true;
      q('.warnings').innerHTML = '';
      if (!file) return refresh();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = inspectPdf(bytes);
      const check = checkPdf(info);
      q('.pdf-info').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB · ${check.pagesLabel}`;
      q('.warnings').innerHTML = [check.blocking, ...check.warnings]
        .filter(Boolean)
        .map((w) => `<li class="${w === check.blocking ? 'blocking' : ''}">${esc(w!)}</li>`)
        .join('');
      if (!check.blocking) {
        picked = { file, bytes, pages: info.pages };
        blocking = false;
      }
      refresh();
    });
    next.addEventListener('click', () => {
      if (!picked) return;
      const input = {
        course: deps.courses.find((c) => c.id === courseSel.value)!,
        name: nameIn.value.trim(),
        fileName: picked.file.name,
        pdf: picked.bytes,
        pages: picked.pages,
      };
      pdfUrl = URL.createObjectURL(new Blob([picked.bytes as BlobPart], { type: 'application/pdf' }));
      if (deps.needsKey()) askKey(() => extract(input));
      else extract(input);
    });
    courseNote();
  };

  // ---------------------------------------------------------------- 2. anahtar (ilk kez burada)
  const askKey = (then: () => void) => {
    show(`${head('API anahtarı')}${keyFormHtml(deps, 'PDF\'i okumak için')}`);
    bindKeyForm(el, deps, then, () =>
      show(`${head('Anahtar atlandı')}<p>Anahtar olmadan PDF okunamaz. Hazır olduğunda ⋯ → Ayarlar'dan anahtarı ekleyip
        "Konu ekle"yi yeniden başlatabilirsin.</p><footer><button class="primary" data-act="close">Tamam</button></footer>`),
    );
  };

  // ---------------------------------------------------------------- 3. .md üretimi
  const extract = async (input: DraftInput) => {
    working(`PDF okunuyor ve .md'ye çevriliyor (${deps.providerLabel()})…`);
    try {
      review(await deps.createDraft(input), input);
    } catch (e) {
      fail((e as Error).message, () => extract(input));
    }
  };

  // ---------------------------------------------------------------- 4. inceleme ve onay
  const review = (t: Topic, input: DraftInput | null) => {
    const source = t.source.path ? `<p class="muted">Kaynak: ders_materyalleri/${esc(t.source.path)}</p>` : '';
    show(`${head(`İncele: ${t.name}`)}
      ${t.truncated ? `<p class="error-box"><b>Eksik .md:</b> ${esc(t.note ?? 'Yanıt kesildi.')} Bu hâliyle onaylanamaz.</p>` : ''}
      ${source}
      <div class="review-grid">
        <div class="pdf-pane">${pdfUrl ? `<iframe title="Kaynak PDF" src="${pdfUrl}"></iframe>` : '<p class="muted">PDF önizlemesi yok.</p>'}</div>
        <div class="md-pane">
          <label>Konu adı <input name="tname" maxlength="80"></label>
          <label>Not (.md) — düzenleyebilirsin <textarea name="md" spellcheck="false"></textarea></label>
          <label>Brifing özeti (oyunda gösterilir) <span class="counter"></span>
            <textarea name="briefing" maxlength="${BRIEFING_LIMIT}" rows="4"></textarea></label>
          <label>Formül sayfası (defterde konu sayfası) <textarea name="formulas" spellcheck="false" rows="6"></textarea></label>
        </div>
      </div>
      <p class="muted">Onaylamadan oyuna da repoya da girmez; şablon üretimi de başlamaz.</p>
      <footer><button class="ghost" data-act="close">Vazgeç</button>${input ? '<button class="ghost" data-act="regen">Yeniden üret</button>' : ''}
        <button class="primary" data-act="approve" ${t.truncated ? 'disabled' : ''}>Onayla</button></footer>`);
    const md = el.querySelector<HTMLTextAreaElement>('[name="md"]')!;
    const br = el.querySelector<HTMLTextAreaElement>('[name="briefing"]')!;
    const fs = el.querySelector<HTMLTextAreaElement>('[name="formulas"]')!;
    const nm = el.querySelector<HTMLInputElement>('[name="tname"]')!;
    const counter = el.querySelector<HTMLSpanElement>('.counter')!;
    md.value = t.markdown; // value ataması: LLM çıktısı HTML olarak yorumlanmaz
    br.value = t.briefing.slice(0, BRIEFING_LIMIT);
    fs.value = t.formulaSheet;
    nm.value = t.name;
    const count = () => (counter.textContent = `${br.value.length}/${BRIEFING_LIMIT}`);
    br.addEventListener('input', count);
    count();
    if (input) el.querySelector('[data-act="regen"]')!.addEventListener('click', () => extract(input));
    el.querySelector('[data-act="approve"]')!.addEventListener('click', async () => {
      let approved: Topic;
      try {
        approved = await deps.approve(t, { markdown: md.value, briefing: br.value, formulaSheet: fs.value, name: nm.value });
      } catch (e) {
        alert((e as Error).message);
        return;
      }
      const course = deps.courses.find((c) => c.id === approved.courseId)!;
      if (!course.problemTypes.length) {
        show(`${head('Konu kaydedildi')}<p>"${esc(approved.name)}" notu ve brifing özeti kütüphaneye kaydedildi.
          Bu ders için henüz oyun problem türü olmadığından şablon üretilmedi.</p><footer><button class="primary" data-act="close">Tamam</button></footer>`);
        return;
      }
      show(`${head('Konu onaylandı')}<p>"${esc(approved.name)}" kaydedildi. Şimdi bu konudan
        ${course.problemTypes.map((x) => esc(TYPE_LABEL[x])).join(' ve ')} için aday problemler üretilecek. Her aday çözücü ve
        doğrulayıcıdan geçmeden oyuna girmez.</p>
        <footer><button class="ghost" data-act="close">Sonra</button><button class="primary" data-act="gen">Şablon üret</button></footer>`);
      el.querySelector('[data-act="gen"]')!.addEventListener('click', () => generate(approved));
    });
  };

  // ---------------------------------------------------------------- 5. şablon üretimi ve rapor
  const generate = async (t: Topic) => {
    working('Şablon adayları üretiliyor ve çözücüyle doğrulanıyor…');
    let done: Topic;
    try {
      done = await deps.generate(t);
    } catch (e) {
      fail((e as Error).message, () => generate(t));
      return;
    }
    const r = done.report!;
    const byType = Object.keys(TYPE_LABEL).filter((ty) => r.rejected.some((x) => x.type === ty) || done.templates.some((x) => x.stage.type === ty));
    show(`${head('Şablon raporu')}
      <p class="report-total"><b>${r.total} aday: ${r.accepted} kabul, ${r.total - r.accepted} elendi.</b></p>
      ${r.truncatedTypes.length ? `<p class="error-box">Yanıtı kesilen türler (aday alınamadı): ${r.truncatedTypes.map((x) => esc(TYPE_LABEL[x as keyof typeof TYPE_LABEL] ?? x)).join(', ')}</p>` : ''}
      ${byType
        .map((ty) => {
          const acc = done.templates.filter((x) => x.stage.type === ty && !t.templates.includes(x));
          const rej = r.rejected.filter((x) => x.type === ty);
          return `<section class="type-report"><h4>${esc(TYPE_LABEL[ty as keyof typeof TYPE_LABEL])}: ${acc.length} kabul, ${rej.length} elendi</h4>
            <ul>${acc.map((x) => `<li class="ok">✔ ${esc(x.stage.title)}</li>`).join('')}
            ${rej.map((x) => `<li class="fail">✘ Aday ${x.index + 1}: ${esc(x.reason)}</li>`).join('')}</ul></section>`;
        })
        .join('')}
      <p class="muted">Kabul edilen şablonlar oyunda bu konunun brifingiyle çıkar. Hatalı bulduğun bir soruyu oyunda "Bu soru hatalı" ile havuzdan çıkarabilirsin.</p>
      <footer><button class="primary" data-act="close">Tamam</button></footer>`);
  };

  if (start) {
    if (start.pdf) pdfUrl = URL.createObjectURL(new Blob([start.pdf as BlobPart], { type: 'application/pdf' }));
    review(start.draft, null);
  } else form();
}
