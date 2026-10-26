// Oyundaki problem türlerinin kısa tanımları: soru kalıbı analizinde LLM'e "mevcut türler" olarak verilir ve analiz
// sayfasında gösterilir. Yeni tür eklenince buraya bir satır eklenir (kataloğun eksiksizliği testle denetlenir).

import type { StageDef } from './types';

export type ProblemType = StageDef['type'];

export const PROBLEM_CATALOG: Record<ProblemType, { label: string; course: string; what: string }> = {
  'series-led': { label: 'Seri LED devresi', course: 'Devre', what: 'Kaynak + direnç + LED; hedef akım aralığı için E12 direnci seç (I = (Vs − Vf)/R).' },
  'series-parallel': { label: 'Seri-paralel ters problem', course: 'Devre', what: 'Eski ölçümden gizli direnci bul, iki akım hedefini birlikte sağlayan R1/R2 seç.' },
  thevenin: { label: 'Thevenin eşdeğeri', course: 'Devre', what: 'İki ölçümden (açık devre/yük) Vth ve Rth bul, yük koşulunu sağla.' },
  'max-power': { label: 'En büyük güç aktarımı', course: 'Devre', what: 'Yük direncini Rth\'ye göre seç, aktarılan gücü ve verimi hesapla.' },
  superposition: { label: 'Süperpozisyon', course: 'Devre', what: 'Birden çok kaynaklı devrede her kaynağın katkısını ayrı bul, topla.' },
  opamp: { label: 'İşlemsel kuvvetlendirici', course: 'Elektronik', what: 'Evirmeyen/eviren kazanç devresi; doyma sınırı ve direnç seçimi.' },
  diode: { label: 'Diyot (Shockley modeli)', course: 'Elektronik', what: 'İki katalog noktasından n·V_T eğimini bul, hedef akımdaki gerilimi ve direnci hesapla.' },
  'rc-rl': { label: 'RC/RL geçici rejim', course: 'Devre', what: 'Birinci mertebe devrede zaman sabiti, şarj/deşarj süresi ve eşik geçişi.' },
  filter: { label: 'Birinci mertebe filtre', course: 'Devre', what: 'Kesim frekansını sinyal ve gürültü şartlarına göre seç (RC/RL), dB kazanç.' },
  phasor: { label: 'Fazör toplama', course: 'Devre', what: 'Aynı frekanslı sinüsleri karmaşık sayı olarak topla, genlik ve faz bul.' },
  damping: { label: 'İkinci mertebe sönüm', course: 'Diferansiyel Denklemler', what: 'm·x″ + c·x′ + k·x; ζ ve ω_n, aşma ve yerleşme şartları için c seç.' },
  stability: { label: 'Doğrusal sistem kararlılığı', course: 'Diferansiyel Denklemler', what: 'ẋ = A·x; özdeğerler, sönme hızı ve salınım şartı için kazanç seç.' },
  laplace: { label: 'Laplace / son değer', course: 'Mühendislik Matematiği', what: 'G(s) ile basamak yanıtı; son ve başlangıç değer teoremleri, ters dönüşüm.' },
  'light-decay': { label: 'Üstel sönüm (ODE)', course: 'Diferansiyel Denklemler', what: 'dV/dt = −V/τ; iki zaman şartını birlikte sağlayan direnç seçimi.' },
  probability: { label: 'Bayes / koşullu olasılık', course: 'Olasılık ve İstatistik', what: 'Önsel ve olabilirliklerden sonsal; koşullu bağımsız algılayıcılar.' },
  'ds-trace': { label: 'Veri yapısı izleme', course: 'Veri Yapıları', what: 'Stack/Queue/LinkedList işlemlerinin izini sür, son durumu yaz.' },
  'algo-trace': { label: 'Algoritma izleme', course: 'Veri Yapıları', what: 'İkili arama ağacı ekleme/arama yolu, gezinme sırası.' },
  'cs-output': { label: 'C# çıktı tahmini', course: 'İleri Programlama (C#)', what: 'Değer/referans tipi, ref, static; kısa programın çıktısını tahmin et.' },
};

export const PROBLEM_TYPES = Object.keys(PROBLEM_CATALOG) as ProblemType[];

/** LLM istemi için: "kimlik: ad — ne sorar" satırları. */
export const catalogPrompt = () => PROBLEM_TYPES.map((t) => `- ${t}: ${PROBLEM_CATALOG[t].label} (${PROBLEM_CATALOG[t].course}) — ${PROBLEM_CATALOG[t].what}`).join('\n');
