// Güvenli, küçük Markdown görüntüleyici (formül sayfaları ve analiz için): başlık, liste, kalın, satır içi kod ve
// paragraf. Önce HER ŞEY kaçışlanır, sonra yalnız bu biçimler etikete çevrilir; LLM çıktısındaki HTML asla yorumlanmaz.
// Formüller ($...$) LaTeX metni olarak kalır (kod biçiminde).

import { esc } from '../puzzles/dom';

const inline = (s: string) =>
  esc(s)
    .replace(/\$\$([^$]+)\$\$|\$([^$]+)\$/g, (_m, a: string | undefined, b: string | undefined) => `<code class="tex">${a ?? b}</code>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list = false;
  const close = () => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      close();
      const level = Math.min(6, h[1].length + 2); // sayfa başlığı h3; # → h3, ## → h4
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (!line.trim()) close();
    else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join('');
}
