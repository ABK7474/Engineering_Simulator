// Katmanlar arası ortak dil. Hub yalnızca Outcome'u okur; bulmaca mantığından habersizdir.

export type OutcomeKind =
  | 'success'
  | 'no_light' // akım görünür ışık için çok düşük
  | 'dim' // yetersiz akım: LED sönük, kapı motoru zorlanır
  | 'led_stressed' // aşırı akım, hafif: LED zorlanır ve söner
  | 'led_burnt' // aşırı akım, ağır: LED patlar
  | 'resistor_burnt' // direnç güç sınırını aştı
  | 'fuse_blown'; // neredeyse kısa devre: sigorta atar

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
}

export interface StageDef {
  id: string;
  type: 'series-led';
  /** Problem türüne özgü yapılandırma; çözücü modülü doğrular. */
  config: unknown;
}

export interface FaultCard {
  id: string;
  title: string;
  briefing: string;
  stages: StageDef[];
}
