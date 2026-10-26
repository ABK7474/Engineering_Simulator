// Sağlayıcıdan bağımsız istem metinleri ve yanıt şemaları (JSON Schema alt kümesi).
// Şemalar yalnız biçimi daraltır; değerler her zaman kodda ayrıca doğrulanır.

import type { TemplateType } from './llm';

export const BRIEFING_MAX = 600;

export const MARKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    markdown: { type: 'string', description: 'Belgenin tamamının temiz Markdown hali.' },
    briefing: { type: 'string', description: `Konunun ${BRIEFING_MAX} karakteri geçmeyen kısa özeti (oyundaki brifing ekranı için).` },
    formulas: { type: 'string', description: 'Konunun formül sayfası (Markdown): başlıklar, formüller ve her birinin ne zaman kullanıldığı.' },
  },
  required: ['markdown', 'briefing', 'formulas'],
} as const;

export function markdownPrompt(courseName: string, topicName: string): string {
  return [
    `Bu belge "${courseName}" dersinin "${topicName}" konusuna ait ders notudur.`,
    'Görevin: belgenin TAMAMINI temiz, düzenli Markdown\'a çevirmek. Özetleme, atlama yapma.',
    'Kurallar:',
    '- Belgenin dilini koru (Türkçe ise Türkçe).',
    '- Başlıkları #, ## ile; listeleri - ile yaz.',
    '- Formülleri LaTeX olarak $...$ (satır içi) ya da $$...$$ (blok) içinde yaz.',
    '- Tabloları Markdown tablosu olarak yaz.',
    '- Her devre şemasını ```devre kod bloğu içinde metne dök: her bileşen (tür, etiket, değer, birim) ve',
    '  hangi düğümler arasına bağlı olduğu, kaynakların yönü ve kutupları. Şemadaki hiçbir değer kaybolmasın.',
    '- Grafikleri eksenler, birimler, önemli noktalar ve eğilim olarak anlat.',
    '- Okunamayan ya da emin olmadığın yerleri [okunamadı] diye işaretle; uydurma.',
    `Ayrıca "briefing" alanına konunun en önemli kavramlarını ve formüllerini ${BRIEFING_MAX} karakteri`,
    'geçmeyen, öğrenciye hatırlatma niteliğinde kısa bir özet yaz.',
    '"formulas" alanına bir formül sayfası yaz: ## alt başlıklar altında her formül ($...$), sembollerin anlamı ve birimi,',
    'ne zaman kullanıldığı ve yaygın hata (bir satır). Belgede olmayan formül ekleme.',
  ].join('\n');
}

const strArr = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

/** Tek soru dosyasının kalıp analizi (ders düzeyindeki birleştirme kodda yapılır). */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    questionCount: { type: 'integer', description: 'Dosyadaki soru (alt sorular dahil değil) sayısı.' },
    topics: {
      type: 'array',
      description: 'Konu ağırlıkları; ağırlıklar soru sayısına göre, toplam 100.',
      items: { type: 'object', properties: { name: { type: 'string' }, weight: { type: 'number' } }, required: ['name', 'weight'] },
    },
    steps: {
      type: 'object',
      description: 'Bir sorunun çözümündeki adım sayısı.',
      properties: { min: { type: 'integer' }, typical: { type: 'integer' }, max: { type: 'integer' } },
      required: ['min', 'typical', 'max'],
    },
    traps: strArr('Öğrencinin tipik düştüğü tuzaklar (kısa cümleler).'),
    ranges: {
      type: 'array',
      description: 'Sorulardaki sayısal büyüklüklerin aralıkları.',
      items: {
        type: 'object',
        properties: { quantity: { type: 'string' }, unit: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } },
        required: ['quantity', 'unit', 'min', 'max'],
      },
    },
    notation: {
      type: 'array',
      description: 'Hocanın kullandığı semboller ve anlamları.',
      items: { type: 'object', properties: { symbol: { type: 'string' }, meaning: { type: 'string' } }, required: ['symbol', 'meaning'] },
    },
    patterns: {
      type: 'array',
      description: 'Soru kalıpları ve mevcut problem türlerinin onları karşılayıp karşılamadığı.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Kalıbın kısa adı.' },
          description: { type: 'string' },
          count: { type: 'integer', description: 'Bu kalıptaki soru sayısı.' },
          steps: { type: 'integer' },
          coveredBy: { type: 'string', description: 'Karşılayan mevcut türün kimliği; yoksa boş dize.' },
          fit: { type: 'string', enum: ['full', 'partial', 'none'] },
        },
        required: ['name', 'description', 'count', 'steps', 'coveredBy', 'fit'],
      },
    },
    proposals: {
      type: 'array',
      description: 'Karşılanmayan kalıplar için yazılması gereken yeni problem türü ya da mevcut türe soru biçimi.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['new-type', 'variant'] },
          description: { type: 'string', description: 'Oyuncunun ne yapacağı ve kodun neyi hesaplayacağı.' },
          covers: strArr('Karşıladığı kalıp adları (patterns[].name).'),
          priority: { type: 'integer', description: '1 en önemli, 5 en az.' },
        },
        required: ['name', 'kind', 'description', 'covers', 'priority'],
      },
    },
  },
  required: ['questionCount', 'topics', 'steps', 'traps', 'ranges', 'notation', 'patterns', 'proposals'],
} as const;

export function analysisPrompt(courseName: string, fileName: string, catalog: string): string {
  return [
    `Bu dosya ("${fileName}") "${courseName}" dersinin sınav/ödev sorularıdır. Görevin soruları ÇÖZMEK değil, kalıplarını analiz etmek.`,
    'Çıkar: konu ağırlıkları, çözüm adım sayısı, öğrencinin tipik düştüğü tuzaklar, sayısal büyüklüklerin aralıkları (birimiyle),',
    'hocanın notasyonu (semboller) ve soru kalıpları.',
    'Oyundaki mevcut problem türleri aşağıda. Her kalıp için onu karşılayan türü (kimliğiyle) ve uyumu yaz: full (aynı soru',
    'biçimi), partial (konu aynı ama soru biçimi/adım sayısı farklı), none (karşılayan yok; coveredBy boş dize).',
    'Son olarak eksik kalıplar için yazılması gereken yeni türleri ya da mevcut türe eklenecek soru biçimlerini öner ve',
    'önceliklendir (1 en önemli). Öneriler çok adımlı, ters problem niteliğinde (çıktıdan girdi bulma) olsun.',
    'Okuyamadığın yerleri tahmin etme; yalnız gördüğünü say.',
    '',
    'Mevcut problem türleri:',
    catalog,
  ].join('\n');
}

const num = (description: string) => ({ type: 'number', description });
const text = (description: string) => ({ type: 'string', description });
const range = (description: string) => ({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description });

const CANDIDATE_SCHEMAS: Record<TemplateType, object> = {
  'series-led': {
    type: 'object',
    properties: {
      title: text('Kısa aşama başlığı (en fazla 60 karakter).'),
      story: text('Bu devrenin istasyondaki görevi, 1-2 cümle.'),
      supplyVoltages: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 4, description: 'Kaynak gerilim seçenekleri (V).' },
      leds: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'object', properties: { color: text('LED rengi'), vf: num('İleri gerilim (V)') }, required: ['color', 'vf'] },
      },
      targetMin_mA: num('Hedef akım alt sınırı (mA)'),
      targetMax_mA: num('Hedef akım üst sınırı (mA)'),
      absMax_mA: num('LED mutlak en yüksek akımı (mA)'),
      visibleMin_mA: num('Gözle görülür ışık için en düşük akım (mA)'),
      fuse_mA: num('Hat sigortası (mA)'),
      resistorRating_W: num('Direnç anma gücü (W)'),
    },
    required: ['title', 'story', 'supplyVoltages', 'leds', 'targetMin_mA', 'targetMax_mA', 'absMax_mA', 'visibleMin_mA', 'fuse_mA', 'resistorRating_W'],
  },
  'series-parallel': {
    type: 'object',
    properties: {
      title: text('Kısa aşama başlığı (en fazla 60 karakter).'),
      story: text('Bu sürücünün istasyondaki görevi, 1-2 cümle.'),
      Vs_choices: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 4, description: 'Kaynak gerilim seçenekleri (V).' },
      Rm_range: range('Gizli motor sargı direnci aralığı [min, max] (Ω, E12 değerlerinden seçilir).'),
      Rold_range: range('Ölçüm kaydındaki eski R1 aralığı [min, max] (Ω).'),
      R1_range: range('Cevap R1 (seri) aralığı [min, max] (Ω).'),
      R2_range: range('Cevap R2 (paralel) aralığı [min, max] (Ω).'),
      tolerance: num('Hedef toleransı (0.02-0.08 arası oran).'),
      slotRating_W: num('Yuva dirençlerinin anma gücü (W).'),
    },
    required: ['title', 'story', 'Vs_choices', 'Rm_range', 'Rold_range', 'R1_range', 'R2_range', 'tolerance', 'slotRating_W'],
  },
};

export function templateSchema(type: TemplateType, count: number): object {
  return {
    type: 'object',
    properties: { candidates: { type: 'array', items: CANDIDATE_SCHEMAS[type], minItems: 1, maxItems: count } },
    required: ['candidates'],
  };
}

const TYPE_GUIDE: Record<TemplateType, string> = {
  'series-led':
    'Problem türü: seri devre (pil + direnç + LED). Oyuncu, LED akımı hedef aralıkta olacak direnci standart E12 ' +
    'değerlerinden seçer. Sabit Vf modeli kullanılır: I = (Vs − Vf) / R. Eşikler şu sırada olmalı: ' +
    'visibleMin < targetMin < targetMax < absMax < fuse. Vs her LED\'in Vf değerinden en az 1 V büyük olmalı.',
  'series-parallel':
    'Problem türü: seri-paralel ters problem. Vs — R1 (seri) — a düğümü; a ile toprak arasında motor (gizli direnç Rm) ' +
    've ona paralel R2. Oyuncu eski bir ölçümden Rm\'yi bulur, sonra motor akımı ve kaynak akımı hedeflerini ' +
    'birlikte sağlayan R1 ve R2\'yi seçer. Topoloji sabittir; yalnız sayısal aralıkları öner. Aralıklar E12 ' +
    'değerleri içermeli (1 Ω – 1 MΩ). Gerçekçi motor akımı 0,15–1,2 A, a düğümü gerilimi Vs\'nin %30–85\'i olmalı.',
};

export function templatePrompt(type: TemplateType, courseName: string, topicName: string, count: number): string {
  return [
    `Aşağıdaki Markdown, "${courseName}" dersinin "${topicName}" konusudur.`,
    `Bu konuyla bağlantılı, ${count} adede kadar birbirinden farklı aday problem öner.`,
    TYPE_GUIDE[type],
    'Sorular zor olmalı: çok adımlı düşünmeyi gerektiren, konudaki gerçek değer aralıklarına dayanan durumlar.',
    'Cevabı sen hesaplama; yalnız parametreleri öner. Her aday kod tarafından çözülüp doğrulanacak, geçemeyen elenecek.',
    '',
    '--- KONU ---',
  ].join('\n');
}
