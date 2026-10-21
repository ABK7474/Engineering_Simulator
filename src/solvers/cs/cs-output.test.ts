import { describe, expect, it } from 'vitest';
import card from '../../../content/faults/ai-core-runtime-01.json';
import { CS_GENERATED, CS_TEMPLATES } from './content';
import { buildCsReport, classifyCs, expand, generateCsOutput, hashCode, parseCsOutputConfig, render, resolveCsOutcome, type CsProblem } from './cs-output';

const inst = (template: string, params: Record<string, unknown>) => {
  const i = CS_GENERATED.instances.find((x) => x.template === template && JSON.stringify(x.params) === JSON.stringify(params));
  if (!i) throw new Error(`örnek yok: ${template} ${JSON.stringify(params)}`);
  return i;
};
const problem = (template: string, params: Record<string, unknown>): CsProblem => {
  const t = CS_TEMPLATES.find((x) => x.id === template)!;
  const instance = inst(template, params);
  return { seed: 0, template: t, instance, code: render(t, instance.params), dotnet: CS_GENERATED.dotnet };
};

describe('C# çıktı: elle kontrol edilebilir örnekler (kayıtlı derleyici çıktısıyla)', () => {
  it('1) struct, A = 20, B = 3, C = 4: a kopyalanır → 20; b → 24; arr[0] dizide yerinde 24 → 20 + 24 = 44. Sınıf sanılırsa 21, 21, 50', () => {
    const i = inst('struct-copy', { A: 20, B: 3, C: 4 });
    expect(i.output).toEqual(['20', '24', '44']);
    expect(i.misconceptions[0].output).toEqual(['21', '21', '50']);
  });

  it('2) virtual/new, A = 4, B = 5: Rate override → 8; Limit gizli, Pump üzerinden 5, TurboPump üzerinden 15; Report = 8 + 5 = 13', () => {
    expect(inst('virtual-new', { A: 4, B: 5 }).output).toEqual(['8', '5', '15', '13']);
  });

  it('3) kapanış, N = 2, K = 2, A = 4, B = 10: i döngü sonunda 3 → 6, 6; foreach 5, 11 → toplamlar 6, 12, 17, 28', () => {
    expect(inst('closure-loop', { N: 2, K: 2, A: 4, B: 10 }).output).toEqual(['6', '12', '17', '28']);
  });

  it('4) finally, L = 10, A = 3, B = 35: try 3, finally 3, catch 35, finally 35, 6 + (−1) = 5', () => {
    expect(inst('try-finally', { L: 10, A: 3, B: 35 }).output).toEqual(['try 3', 'finally 3', 'catch 35', 'finally 35', '5']);
  });

  it('5) static, S = 2, M = 2: kimlikler 2, 4, 6; c = a → 2 + 6 = 8; 4·2 + 6 = 14', () => {
    expect(inst('static-field', { S: 2, M: 2 }).output).toEqual(['2', '8', '14']);
  });

  it('6) LINQ, liste 12, 25, 40 + 22, limit sonradan 30: Count 1, Sum 40; temizlenince 0', () => {
    expect(inst('linq-deferred', { A: 12, B: 25, C: 40, D: 22, L: 15, M: 30 }).output).toEqual(['1', '40', '0']);
  });
});

describe('kayıtlı çıktılar ve şablonlar', () => {
  it('her örnek şablondan aynı kodu üretir (özet tutar); yanılgılar doğru çıktıdan farklı', () => {
    for (const i of CS_GENERATED.instances) {
      const t = CS_TEMPLATES.find((x) => x.id === i.template)!;
      expect(hashCode(render(t, i.params)), `${i.template} ${JSON.stringify(i.params)}: şablon değişmiş, npm run gen:cs`).toBe(i.hash);
      expect(i.output.length).toBeGreaterThanOrEqual(2);
      for (const m of i.misconceptions) expect(m.output).not.toEqual(i.output);
    }
  });

  it('her yanılgı yaması her parametre kümesinde tam bir kez uygulanır; kodlar 30 satırı aşmaz', () => {
    for (const t of CS_TEMPLATES)
      for (const params of expand(t)) {
        expect(render(t, params).length, t.id).toBeLessThanOrEqual(34);
        for (const m of t.misconceptions) expect(() => render(t, params, m.id)).not.toThrow();
      }
  });

  it('her şablonun en az bir örneği var; kart yapılandırmaları geçerli', () => {
    for (const t of CS_TEMPLATES) expect(CS_GENERATED.instances.some((i) => i.template === t.id), t.id).toBe(true);
    for (const s of card.stages) expect(() => parseCsOutputConfig(s.config, CS_TEMPLATES, CS_GENERATED)).not.toThrow();
    expect(() => parseCsOutputConfig({ templates: ['yok'] }, CS_TEMPLATES, CS_GENERATED)).toThrow(/bilinmeyen/);
  });

  it('üretici 200 tohumda yalnız kartın şablonlarını seçer', () => {
    const cfg = parseCsOutputConfig(card.stages[0].config, CS_TEMPLATES, CS_GENERATED);
    for (let seed = 1; seed <= 200; seed++) expect(cfg.templates).toContain(generateCsOutput(cfg, seed, CS_TEMPLATES, CS_GENERATED).template.id);
  });
});

describe('sonuçlar ve rapor', () => {
  const p = problem('try-finally', { L: 10, A: 3, B: 35 });
  it('doğru → başarı (boşluklar önemsiz); tek satır → sensör; yanılgı → yeniden başlatma; satır sayısı → donma', () => {
    expect(classifyCs(p, ['try 3 ', ' finally 3', 'catch 35', 'finally 35', '5'])).toBe('success');
    expect(classifyCs(p, ['try 3', 'finally 3', 'catch 35', 'finally 35', '6'])).toBe('sensor_misread');
    expect(classifyCs(p, ['try 3', 'catch 35', 'finally 35', '5', ''])).toBe('core_freeze');
    const q = problem('struct-copy', { A: 20, B: 3, C: 4 });
    expect(classifyCs(q, ['21', '21', '50'])).toBe('core_reboot');
    expect(resolveCsOutcome(q, ['21', '21', '50']).explanation).toContain('sınıf');
  });

  it('rapor: satır karşılaştırması, kavram açıklaması, derleyici notu', () => {
    const a = ['try 3', 'finally 3', 'catch 35', 'finally 35', '6'];
    const r = buildCsReport('core-events', p, a, resolveCsOutcome(p, a));
    expect(r.table!.rows[4]).toEqual(['5', '5', '6', 'yanlış']);
    expect(r.steps.join(' ')).toContain('finally');
    expect(r.steps.join(' ')).toContain('dotnet');
  });
});
