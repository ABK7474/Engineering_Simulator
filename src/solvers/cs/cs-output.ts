// C# çıktı tahmini (İleri Programlama). Şablonlar elle yazılmıştır (content/cs-output/templates.json); her şablonun
// parametreli kodu ve yanılgı yamaları vardır. Doğru çıktı ve her yanılgının çıktısı oyun sırasında DEĞİL, üretim
// sırasında gerçek derleyiciyle (scripts/gen-cs-output.mjs → dotnet) bir kez hesaplanıp
// content/generated/cs-output.json'a yazılır. Oyunda derleyici yok; kod şablondan yeniden üretilir ve özeti
// kayıttakiyle karşılaştırılır (şablon değişip yeniden üretilmezse test kırılır).

import { createRng, pick } from '../../core/rng';
import type { Outcome, OutcomeKind, StageResult } from '../../core/types';

export type ParamValue = number | string | boolean;

export interface CsTemplate {
  id: string;
  title: string;
  explain: string;
  code: string[];
  params?: Record<string, ParamValue[]>;
  cases?: Record<string, ParamValue>[];
  misconceptions: { id: string; text: string; patches: { find: string; replace: string }[] }[];
}

export interface CsInstance {
  template: string;
  params: Record<string, ParamValue>;
  /** Oluşturulan kodun özeti (şablon değişince eskir). */
  hash: string;
  output: string[];
  misconceptions: { id: string; output: string[] }[];
}

export interface CsGenerated {
  dotnet: string;
  instances: CsInstance[];
}

export interface CsOutputConfig {
  templates: string[];
}

/** Şablonun parametre kümeleri (deterministik sıra). */
export function expand(t: CsTemplate): Record<string, ParamValue>[] {
  if (t.cases) return t.cases;
  let out: Record<string, ParamValue>[] = [{}];
  for (const [k, vs] of Object.entries(t.params ?? {})) out = out.flatMap((o) => vs.map((v) => ({ ...o, [k]: v })));
  return out;
}

/** Yamaları uygular (her biri tam bir kez geçmeli), sonra {X} yer tutucularını doldurur. */
export function render(t: CsTemplate, params: Record<string, ParamValue>, misconception?: string): string[] {
  let text = t.code.join('\n');
  if (misconception) {
    const m = t.misconceptions.find((x) => x.id === misconception);
    if (!m) throw new Error(`${t.id}: bilinmeyen yanılgı ${misconception}`);
    for (const p of m.patches) {
      const n = text.split(p.find).length - 1;
      if (n !== 1) throw new Error(`${t.id}/${m.id}: yama metni ${n} kez geçiyor (1 olmalı): ${p.find.slice(0, 40)}`);
      text = text.replace(p.find, p.replace);
    }
  }
  text = text.replace(/\{([A-Z])\}/g, (_all, k: string) => {
    if (!(k in params)) throw new Error(`${t.id}: parametre yok {${k}}`);
    return String(params[k]);
  });
  return text.split('\n');
}

/** FNV-1a (32 bit), onaltılık. */
export function hashCode(lines: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of lines.join('\n')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function parseCsOutputConfig(raw: unknown, templates: CsTemplate[], gen: CsGenerated): CsOutputConfig {
  const c = raw as CsOutputConfig;
  if (!c || !Array.isArray(c.templates) || c.templates.length === 0) throw new Error('cs-output yapılandırması: templates boş olamaz');
  for (const id of c.templates) {
    if (!templates.some((t) => t.id === id)) throw new Error(`cs-output: bilinmeyen şablon '${id}'`);
    if (!gen.instances.some((i) => i.template === id)) throw new Error(`cs-output: '${id}' için üretilmiş örnek yok (npm run gen:cs)`);
  }
  return c;
}

export interface CsProblem {
  seed: number;
  template: CsTemplate;
  instance: CsInstance;
  code: string[];
  dotnet: string;
}

export function generateCsOutput(c: CsOutputConfig, seed: number, templates: CsTemplate[], gen: CsGenerated): CsProblem {
  const rng = createRng(seed);
  const tid = pick(rng, c.templates);
  const template = templates.find((t) => t.id === tid)!;
  const instance = pick(rng, gen.instances.filter((i) => i.template === tid));
  const code = render(template, instance.params);
  if (hashCode(code) !== instance.hash) throw new Error(`cs-output: '${tid}' şablonu değişmiş, kayıtlı çıktı eski (npm run gen:cs)`);
  return { seed, template, instance, code, dotnet: gen.dotnet };
}

// ---------------------------------------------------------------- sonuç

/** Satır karşılaştırması: baştaki/sondaki boşluklar ve sondaki boş satırlar önemsiz. */
export const normalize = (lines: string[]) => {
  const out = lines.map((l) => l.trim());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
};

export type CsOutcomeKind = Extract<OutcomeKind, 'success' | 'sensor_misread' | 'core_reboot' | 'core_freeze'>;

export function diffLines(p: CsProblem, answer: string[]) {
  const want = p.instance.output;
  const got = normalize(answer);
  const wrong = want.map((w, k) => (got[k] === w ? -1 : k)).filter((k) => k >= 0);
  const mis = p.instance.misconceptions.find((m) => JSON.stringify(m.output) === JSON.stringify(got));
  return { want, got, wrong, countOk: got.length === want.length, misconception: mis ? p.template.misconceptions.find((m) => m.id === mis.id)! : undefined };
}

export function classifyCs(p: CsProblem, answer: string[]): CsOutcomeKind {
  const d = diffLines(p, answer);
  if (d.countOk && !d.wrong.length) return 'success';
  if (!d.countOk) return 'core_freeze';
  return d.wrong.length === 1 && !d.misconception ? 'sensor_misread' : 'core_reboot';
}

export function resolveCsOutcome(p: CsProblem, answer: string[]): Outcome {
  const kind = classifyCs(p, answer);
  const d = diffLines(p, answer);
  const base = { kind, resistorOverheat: false, severity: kind === 'success' ? 0 : 1 + d.wrong.length / 2 };
  switch (kind) {
    case 'success':
      return { ...base, headline: 'Çekirdek modülü doğru öngörüldü', explanation: 'Yazdığın çıktı derleyicinin kayıtlı çıktısıyla satır satır aynı. Çekirdek modülü güvenle yüklendi.' };
    case 'sensor_misread':
      return { ...base, headline: 'Bir satır yanlış, sensör kaydı kaydı', explanation: `${d.wrong[0] + 1}. satır "${d.want[d.wrong[0]]}" olmalıydı (yazdığın: "${d.got[d.wrong[0]] ?? ''}").` };
    case 'core_reboot':
      return {
        ...base,
        headline: 'Öngörü tuttu sanıldı, çekirdek yeniden başladı',
        explanation: d.misconception ? `Yazdığın çıktı bir yanılgının çıktısıyla aynı: ${d.misconception.text}` : `${d.wrong.length} satır yanlış: ${d.wrong.map((k) => k + 1).join(', ')}.`,
      };
    case 'core_freeze':
      return { ...base, headline: 'Satır sayısı tutmadı, çekirdek dondu', explanation: `Program ${d.want.length} satır yazar; sen ${d.got.length} satır yazdın.${d.misconception ? ` Yanılgı: ${d.misconception.text}` : ''}` };
  }
}

export function buildCsReport(stageId: string, p: CsProblem, answer: string[], outcome: Outcome): StageResult {
  const d = diffLines(p, answer);
  const rows = Array.from({ length: Math.max(d.want.length, d.got.length) }, (_, k) => [String(k + 1), d.want[k] ?? '—', d.got[k] ?? '—', d.want[k] === d.got[k] ? 'doğru' : 'yanlış']);
  const steps = [
    p.template.explain,
    ...p.instance.misconceptions.map((m) => {
      const t = p.template.misconceptions.find((x) => x.id === m.id)!;
      return `Sık yanılgı: ${t.text} Bu durumda çıktı şöyle olurdu: ${m.output.join(' / ')}`;
    }),
    `Kontrol: çıktı üretim sırasında gerçek C# derleyicisiyle (dotnet ${p.dotnet}) çalıştırılarak kaydedildi; yanılgı çıktıları da kodun yanılgıya göre değiştirilmiş hâli çalıştırılarak bulundu.`,
  ];
  if (d.misconception) steps.unshift(`Yazdığın çıktı şu yanılgının çıktısı: ${d.misconception.text}`);
  return {
    stageId,
    success: outcome.kind === 'success',
    chosenLabel: d.got.join(' / ') || '(boş)',
    correctLabel: d.want.join(' / '),
    outcome,
    facts: [
      { label: 'Konu', value: p.template.title },
      { label: 'Satır sayısı', value: `${d.want.length}` },
      { label: 'Yanlış satır', value: d.wrong.length ? d.wrong.map((k) => k + 1).join(', ') : d.countOk ? 'yok' : 'sayı farklı' },
    ],
    steps,
    table: {
      caption: 'Satır satır karşılaştırma',
      head: ['Satır', 'Doğru çıktı', 'Senin yazdığın', ''],
      rows,
      bad: d.wrong.length ? d.wrong[0] : undefined,
    },
  };
}
