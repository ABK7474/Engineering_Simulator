// Sahte LLM istemcisi: ağ ve API anahtarı olmadan bütün içerik hattının sınanması için.
// Deterministiktir. Şablon önerilerinin bir kısmı BİLEREK bozuktur: doğrulayıcının LLM'den gelen
// hatalı veriyi elediğini gösterir. Konu adında "kesik" geçerse .md kesilmiş gibi döner.

import type { LlmProvider, MarkdownResult, TemplateRequest, TemplateResult } from './llm';

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

export function createMockProvider(): LlmProvider {
  return {
    label: MOCK_LABEL,
    model: 'mock',
    async pdfToMarkdown(pdf, ctx): Promise<MarkdownResult> {
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
      if (/kesik/i.test(ctx.topicName)) {
        return { markdown: md.slice(0, 120), briefing, truncated: true, note: 'Yanıt modelin çıktı sınırında kesildi; .md eksik.' };
      }
      return { markdown: md, briefing, truncated: false };
    },
    async generateTemplates(req: TemplateRequest): Promise<TemplateResult> {
      const list = req.type === 'series-led' ? LED_CANDIDATES : SP_CANDIDATES;
      return { candidates: structuredClone(list), truncated: false };
    },
    async testConnection() {
      return { ok: true, kind: 'ok' as const, message: 'Sahte istemci: bağlantı her zaman başarılı.' };
    },
  };
}
