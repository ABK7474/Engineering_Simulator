// Katmanlar arası ortak dil. Hub yalnızca Outcome'u okur; bulmaca mantığından habersizdir.

export type OutcomeKind =
  | 'success'
  | 'no_light' // akım görünür ışık için çok düşük
  | 'dim' // yetersiz akım: LED sönük, kapı motoru zorlanır
  | 'led_stressed' // aşırı akım, hafif: LED zorlanır ve söner
  | 'led_burnt' // aşırı akım, ağır: LED patlar
  | 'resistor_burnt' // direnç güç sınırını aştı
  | 'fuse_blown' // neredeyse kısa devre ya da hat koruması: sigorta atar
  | 'motor_stall' // motor akımı çok düşük: motor dönmez
  | 'motor_slow' // motor akımı düşük ya da besleme kararsız: kapı yavaş, takılır
  | 'motor_overheat' // aşırı akım, hafif: termik koruma motoru keser
  | 'motor_burnt' // aşırı akım, ağır: sargı yanar
  | 'core_reboot' // trace: komşu (yanlış) kayıt düzeltildi, çekirdek yeniden başladı
  | 'core_crash' // trace: sağlam bellek kaydının üstüne yazıldı, AI çekirdeği çöktü
  | 'sensor_misread' // trace: doğru kayıt, yanlış değer/eleman sayısı (sınır hatası): sensör yanlış okur
  | 'core_freeze' // trace: doğru kayıt, elemanlar doğru ama sıra ters: komutlar ters işlendi, panel donar
  | 'signal_weak' // max-power: yük gücü en büyük gücün altında, verici zayıf
  | 'opamp_saturated' // op-amp: çıkış besleme rayını aştı, sinyal kırpıldı
  | 'valve_slam' // rc-rl: valf penceresinden erken kapandı, darbe
  | 'valve_late' // rc-rl: valf geç kapandı, basınç kaçağı
  | 'valve_stuck'; // rc-rl: eşiğe hiç ulaşılmadı, valf kapanmadı

export interface Outcome {
  kind: OutcomeKind;
  /** 0 = sorunsuz, 1 = sınırda, >1 sınırın kaç katı aşıldığı. */
  severity: number;
  /** Ek fiziksel bulgu: direnç anma gücünü aştı (duman/yanık izi). */
  resistorOverheat: boolean;
  headline: string;
  explanation: string;
}

export interface ReportFact {
  label: string;
  value: string;
}

export interface StageResult {
  stageId: string;
  success: boolean;
  chosenLabel: string;
  correctLabel: string;
  outcome: Outcome;
  facts: ReportFact[];
  /** Adım adım çözüm, olay raporunda gösterilir. */
  steps: string[];
  /** İsteğe bağlı tablo (ör. doğru trace); `bad` ve `chosen` satır dizinleri işaretlenir. */
  table?: { caption: string; head: string[]; rows: string[][]; bad?: number; good?: number; chosen?: number };
  /** İsteğe bağlı zaman grafiği (ör. geçici hâl): eğriler, eşik çizgisi, kabul penceresi. */
  plot?: TimePlot;
}

export interface TimePlot {
  caption: string;
  xLabel: string;
  yLabel: string;
  /** Eksen ölçeği: gösterilen değer = gerçek · ölçek (ör. s → ms için 1000). */
  xScale: number;
  yScale: number;
  threshold: number;
  window: [number, number];
  series: { label: string; kind: 'correct' | 'chosen'; points: [number, number][] }[];
}

export interface StageDef {
  id: string;
  type: 'series-led' | 'series-parallel' | 'ds-trace' | 'thevenin' | 'max-power' | 'opamp' | 'rc-rl';
  /** Ders kimliği (content/courses.json). Zorunlu; aralıklı tekrar için. */
  course: string;
  /** Konu etiketi (ör. "thevenin-norton"; kullanıcı konuları için "konu:<kimlik>"). Zorunlu. */
  topic: string;
  title: string;
  /** Aşamanın konu özeti (brifing ekranı). */
  briefing: string;
  /** Problem türüne özgü yapılandırma; çözücü modülü doğrular. */
  config: unknown;
  /** Kullanıcının yüklediği bir konudan üretilmiş şablonsa kaynağı. */
  source?: { topicId: string; topicName: string; courseName: string };
}

export interface FaultCard {
  id: string;
  title: string;
  briefing: string;
  stages: StageDef[];
}
