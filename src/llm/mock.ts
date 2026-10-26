// Sahte LLM istemcisi: ağ ve API anahtarı olmadan bütün içerik hattının sınanması için.
// Deterministiktir. Şablon önerilerinin bir kısmı BİLEREK bozuktur: doğrulayıcının LLM'den gelen
// hatalı veriyi elediğini gösterir. Konu adında "kesik" geçerse .md kesilmiş gibi döner. Konu ya da dosya adında "kota"
// geçerse o ad için ilk istek 429 (kota) hatası verir, sonrakiler başarılı olur (kuyruğun bekleyip devam ettiği sınanır).

import { FALLBACK_MODEL } from './client';
import { LlmError, type LlmProvider, type MarkdownResult, type QuestionAnalysisResult, type TemplateRequest, type TemplateResult } from './llm';

export const MOCK_LABEL = 'Sahte istemci';

/** Sahte önerilerin beklenen sonuçları (testler ve uçtan uca kontrol bunu kullanır). */
export const MOCK_EXPECTED = {
  'series-led': { total: 5, accepted: 2 },
  'series-parallel': { total: 4, accepted: 1 },
} as const;

const LED_CANDIDATES: unknown[] = [
  {
    title: 'Basınç sensörü uyarı LED\'i',
    story: 'Bölme basıncı düşünce turuncu LED yanar.',
    supplyVoltages: [9, 12],
    leds: [{ color: 'turuncu', vf: 2.0 }, { color: 'beyaz', vf: 3.1 }],
    targetMin_mA: 8,
    targetMax_mA: 16,
    absMax_mA: 25,
    visibleMin_mA: 1,
    fuse_mA: 150,
    resistorRating_W: 0.25,
  },
  {
    title: '<script>alert(1)</script> Kızılötesi işaret',
    story: 'Metin olarak kalmalı, çalıştırılmamalı.',
    supplyVoltages: [5, 9],
    leds: [{ color: 'kırmızı', vf: 1.8 }],
    targetMin_mA: 12,
    targetMax_mA: 24,
    absMax_mA: 40,
    visibleMin_mA: 1,
    fuse_mA: 250,
    resistorRating_W: 0.5,
  },
  // Bozuk: eşik sırası yanlış (hedef üst sınırı mutlak sınırın üstünde)
  {
    title: 'Sıra bozuk',
    story: 'x',
    supplyVoltages: [12],
    leds: [{ color: 'yeşil', vf: 2.2 }],
    targetMin_mA: 10,
    targetMax_mA: 40,
    absMax_mA: 30,
    visibleMin_mA: 1,
    fuse_mA: 200,
    resistorRating_W: 0.25,
  },
  // Bozuk: sayı yerine metin
  { title: 'Metin sayı', story: 'x', supplyVoltages: ['on iki'], leds: [{ color: 'mavi', vf: 3 }], targetMin_mA: 10, targetMax_mA: 20, absMax_mA: 30, visibleMin_mA: 1, fuse_mA: 200, resistorRating_W: 0.25 },
  // Bozuk: nesne değil
  'Bu bir aday değil',
];

const SP_CANDIDATES: unknown[] = [
  {
    title: 'Havalandırma damperi sürücüsü',
    story: 'Damper motoru seri-paralel sürücüyle beslenir.',
    Vs_choices: [12, 24],
    Rm_range: [10, 47],
    Rold_range: [10, 100],
    R1_range: [4.7, 68],
    R2_range: [10, 330],
    tolerance: 0.05,
    slotRating_W: 5,
  },
  // Bozuk: çözümü yok (motor direnci gerçekçi akım aralığına hiç girmez)
  {
    title: 'Çözümsüz',
    story: 'x',
    Vs_choices: [5],
    Rm_range: [100000, 1000000],
    Rold_range: [10, 100],
    R1_range: [4.7, 68],
    R2_range: [10, 330],
    tolerance: 0.05,
    slotRating_W: 5,
  },
  // Bozuk: ters aralık ve sonsuz değer
  { title: 'Ters aralık', story: 'x', Vs_choices: [12], Rm_range: [47, 10], Rold_range: [10, 100], R1_range: [4.7, 68], R2_range: [10, 330], tolerance: 0.05, slotRating_W: 5 },
  // Bozuk: bilinmeyen alan (topoloji değiştirmeye çalışıyor)
  { title: 'Topoloji', story: 'x', Vs_choices: [12], Rm_range: [10, 47], Rold_range: [10, 100], R1_range: [4.7, 68], R2_range: [10, 330], tolerance: 0.05, slotRating_W: 5, elements: [] },
];

/** Sahte kota: "kota" geçen her ad için bir kez 429. */
const quotaHit = new Set<string>();
function maybeQuota(name: string): void {
  if (!/kota/i.test(name) || quotaHit.has(name)) return;
  quotaHit.add(name);
  throw new LlmError('quota', 'Kota ya da hız sınırı aşıldı; biraz bekleyip tekrar dene [HTTP 429] (sahte istemci).', FALLBACK_MODEL);
}
/** Sahte istemcinin yaptığı istekler (uçtan uca test: aynı dosya ikinci kez işlenmesin). */
export const mockCalls: { kind: 'markdown' | 'templates' | 'analysis'; name: string }[] = [];

/** Sahte soru analizi: dosya adına göre deterministik; bir kalıp karşılanıyor, biri karşılanmıyor. */
function mockAnalysis(fileName: string): unknown {
  const final = /final/i.test(fileName);
  return {
    questionCount: final ? 3 : 4,
    topics: [
      { name: 'Thevenin ve Norton', weight: final ? 50 : 75 },
      { name: 'Düğüm analizi', weight: final ? 50 : 25 },
    ],
    steps: { min: 2, typical: final ? 5 : 4, max: final ? 8 : 6 },
    traps: ['Bağımlı kaynağı Rth hesabında kısa devre yapmak', final ? 'Süper düğümde kaynak yönünü ters almak' : 'Akım yönü işareti'],
    ranges: [
      { quantity: 'Direnç', unit: 'Ω', min: final ? 10 : 100, max: final ? 2200 : 4700 },
      { quantity: 'Kaynak gerilimi', unit: 'V', min: 5, max: 24 },
    ],
    notation: [{ symbol: 'V_x', meaning: 'bağımlı kaynağın kontrol gerilimi' }],
    patterns: [
      { name: 'Ölçümden Thevenin', description: 'İki yük ölçümünden Vth ve Rth', count: final ? 1 : 3, steps: 4, coveredBy: 'thevenin', fit: 'full' },
      { name: 'Bağımlı kaynaklı devre', description: 'Akım kontrollü gerilim kaynağı içeren düğüm analizi', count: final ? 2 : 1, steps: 6, coveredBy: '', fit: 'none' },
    ],
    proposals: [
      { name: 'Bağımlı kaynak türü', kind: 'new-type', description: 'Oyuncu kontrol değişkenini ölçümden bulur; çözücü düğüm denklemlerini kurar.', covers: ['Bağımlı kaynaklı devre'], priority: 1 },
      { name: '<b>Süper düğüm</b> biçimi', kind: 'variant', description: 'Metin olarak kalmalı.', covers: ['Bağımlı kaynaklı devre'], priority: 3 },
    ],
  };
}

export function createMockProvider(): LlmProvider {
  return {
    label: MOCK_LABEL,
    model: 'mock',
    async pdfToMarkdown(pdf, ctx): Promise<MarkdownResult> {
      mockCalls.push({ kind: 'markdown', name: ctx.topicName });
      maybeQuota(ctx.topicName);
      const md = [
        `# ${ctx.topicName}`,
        '',
        `*${ctx.courseName}* — sahte istemcinin ürettiği örnek not (${pdf.byteLength} bayt PDF).`,
        '',
        '## Seri ve paralel bağlantı',
        '- Seri: aynı akım, gerilimler toplanır: $R_{eş} = R_1 + R_2$',
        '- Paralel: aynı gerilim, akımlar toplanır: $1/R_{eş} = 1/R_1 + 1/R_2$',
        '',
        '```devre',
        'V1: 12 V kaynak, + ucu n1, − ucu toprak',
        'R1: 100 Ω, n1 – n2',
        'D1: kırmızı LED (Vf ≈ 2 V), anot n2, katot toprak',
        '```',
      ].join('\n');
      const briefing = 'Seri bağlı elemanlardan aynı akım geçer, paralel kollar aynı gerilimi görür. LED akımı I = (Vs − Vf)/R ile sınırlanır.';
      const formulas = [
        `## ${ctx.topicName}`,
        '- Seri eşdeğer: $R_{eş} = R_1 + R_2$ — aynı akım geçen elemanlar.',
        '- Paralel eşdeğer: $1/R_{eş} = 1/R_1 + 1/R_2$ — aynı gerilimi gören kollar.',
        '- LED akımı: $I = (V_s - V_f)/R$ — yaygın hata: $V_f$\'yi çıkarmamak.',
        '<img src=x onerror=alert(1)>',
      ].join('\n');
      if (/kesik/i.test(ctx.topicName)) {
        return { markdown: md.slice(0, 120), briefing, formulas, truncated: true, note: 'Yanıt modelin çıktı sınırında kesildi; .md eksik.' };
      }
      return { markdown: md, briefing, formulas, truncated: false };
    },
    async analyzeQuestions(file): Promise<QuestionAnalysisResult> {
      mockCalls.push({ kind: 'analysis', name: file.name });
      maybeQuota(file.name);
      if (/kesik/i.test(file.name)) return { analysis: null, truncated: true };
      return { analysis: mockAnalysis(file.name), truncated: false };
    },
    async generateTemplates(req: TemplateRequest): Promise<TemplateResult> {
      mockCalls.push({ kind: 'templates', name: req.topicName });
      const list = req.type === 'series-led' ? LED_CANDIDATES : SP_CANDIDATES;
      return { candidates: structuredClone(list), truncated: false };
    },
    async testConnection() {
      return { ok: true, kind: 'ok' as const, message: 'Sahte istemci: bağlantı her zaman başarılı.', suggestModel: null };
    },
  };
}
