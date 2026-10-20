// LLM'den gelen şablon adaylarının doğrulanması: bozuk veri havuza giremez.

import { describe, expect, it } from 'vitest';
import fault from '../../content/faults/door-power-01.json';
import type { StageDef } from '../core/types';
import { createMockProvider, MOCK_EXPECTED } from '../llm/mock';
import { parseSeriesParallelConfig } from './circuit/series-parallel';
import { generateSeriesParallel } from './circuit/series-parallel.generate';
import { verifySeriesParallel } from './circuit/series-parallel.verify';
import { MAX_CANDIDATES, validateCandidates } from './templates';

const LED_BASE = fault.stages[0] as StageDef;
const SP_BASE = fault.stages[1] as StageDef;
const topic = { id: 't1', name: 'Seri devreler', courseName: 'Devre Teorisi 1', briefing: 'Konu özeti.' };
const ctxFor = (base: StageDef, existing: StageDef[] = []) => ({ base, topic, existing, seeds: 5 });

const goodLed = {
  title: 'Uyarı LED\'i',
  story: 'Bölme uyarısı.',
  supplyVoltages: [9, 12],
  leds: [{ color: 'turuncu', vf: 2 }],
  targetMin_mA: 8,
  targetMax_mA: 16,
  absMax_mA: 25,
  visibleMin_mA: 1,
  fuse_mA: 150,
  resistorRating_W: 0.25,
};
const goodSp = {
  title: 'Damper sürücüsü',
  story: 'Damper motoru.',
  Vs_choices: [12, 24],
  Rm_range: [10, 47],
  Rold_range: [10, 100],
  R1_range: [4.7, 68],
  R2_range: [10, 330],
  tolerance: 0.05,
  slotRating_W: 5,
};
const led = (patch: object) => validateCandidates('series-led', [{ ...goodLed, ...patch }], ctxFor(LED_BASE));
const sp = (patch: object) => validateCandidates('series-parallel', [{ ...goodSp, ...patch }], ctxFor(SP_BASE));
const reasonOf = (r: ReturnType<typeof led>) => r.rejected[0]?.reason ?? '(kabul edildi)';

describe('geçerli adaylar kabul edilir', () => {
  it('seri LED: kaynak bilgisi ve konu brifingi ile aşamaya dönüşür', () => {
    const r = led({});
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toMatchObject({
      type: 'series-led',
      title: 'Uyarı LED\'i',
      briefing: 'Bölme uyarısı. Konu özeti.',
      source: { topicId: 't1', topicName: 'Seri devreler', courseName: 'Devre Teorisi 1' },
    });
  });

  it('seri-paralel: topoloji ve çözüm zinciri temel şablondan, aralıklar adaydan', () => {
    const r = sp({});
    expect(r.accepted).toHaveLength(1);
    const cfg = parseSeriesParallelConfig(r.accepted[0].config);
    expect(cfg.elements).toEqual(parseSeriesParallelConfig(SP_BASE.config).elements);
    expect(cfg.steps).toEqual(parseSeriesParallelConfig(SP_BASE.config).steps);
    expect(cfg.params.Vs.choices).toEqual([12, 24]);
    expect(cfg.targets.every((t) => t.tolerance === 0.05)).toBe(true);
    // Kabul edilen şablondan üretilen problemler doğrulayıcıdan geçer
    for (let s = 100; s < 110; s++) expect(verifySeriesParallel(cfg, generateSeriesParallel(cfg, s)).ok).toBe(true);
  });

  it('metindeki <script> düz metin olarak kalır (çalıştırılmaz; panel kaçışlar)', () => {
    const r = led({ title: '<script>alert(1)</script>' });
    expect(r.accepted[0].title).toBe('<script>alert(1)</script>');
  });
});

describe('LLM\'den gelen bozuk veri reddedilir', () => {
  it.each([
    ['sayı yerine metin', { targetMin_mA: 'on' }, /sayı değil/],
    ['NaN', { absMax_mA: Number.NaN }, /sayı değil/],
    ['Infinity', { fuse_mA: Number.POSITIVE_INFINITY }, /sayı değil/],
    ['negatif', { targetMin_mA: -5 }, /izinli aralık/],
    ['sıra bozuk eşikler', { targetMax_mA: 40 }, /visibleMin < targetMin < targetMax < absMax < fuse/],
    ['gerçek dışı gerilim', { supplyVoltages: [400] }, /supplyVoltages\[0\]/],
    ['boş gerilim listesi', { supplyVoltages: [] }, /1–4 öğeli/],
    ['devasa dizi', { supplyVoltages: Array(1000).fill(9) }, /1–4 öğeli/],
    ['LED nesnesi bozuk', { leds: [{ color: 'kırmızı' }] }, /eksik alan: vf/],
    ['bilinmeyen alan', { solution: 'R = 330' }, /bilinmeyen alan: solution/],
    ['eksik alan', { fuse_mA: undefined }, /eksik alan|sayı değil/],
    ['boş başlık', { title: '  ' }, /'title' boş/],
    ['çok uzun hikâye', { story: 'x'.repeat(5000) }, /çok uzun/],
    ['çözümü olmayan (Vs, Vf + 1 V\'u geçmiyor)', { supplyVoltages: [3], leds: [{ color: 'mavi', vf: 3 }] }, /tohumda doğrulanabilir problem yok/],
  ])('seri LED: %s', (_name, patch, reason) => {
    const r = led(patch);
    expect(r.accepted).toHaveLength(0);
    expect(reasonOf(r)).toMatch(reason);
  });

  it.each([
    ['ters aralık', { Rm_range: [47, 10] }, /ters ya da boş/],
    ['E12 değeri içermeyen aralık', { R1_range: [10.5, 11.5] }, /E12 değeri yok/],
    ['aralık öğesi metin', { R2_range: [10, 'çok'] }, /R2_range\[1\]/],
    ['tolerans çok gevşek', { tolerance: 0.5 }, /izinli aralık/],
    ['topolojiyi değiştirme girişimi', { elements: [] }, /bilinmeyen alan: elements/],
    ['çözümü olmayan aralıklar (200 denemede üretilemez)', { Vs_choices: [5], Rm_range: [100000, 1000000] }, /200 denemede doğrulanabilir problem bulunamadı/],
  ])('seri-paralel: %s', (_name, patch, reason) => {
    const r = sp(patch);
    expect(r.accepted).toHaveLength(0);
    expect(reasonOf(r)).toMatch(reason);
  });

  it.each([
    ['null', null],
    ['metin', 'adaylar'],
    ['nesne', { candidates: [] }],
  ])('yanıt dizi değilse (%s) hiçbir şey kabul edilmez', (_n, raw) => {
    const r = validateCandidates('series-led', raw, ctxFor(LED_BASE));
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/aday dizisi değil/);
  });

  it('dizide nesne olmayan öğe', () => {
    const r = validateCandidates('series-led', [42, goodLed], ctxFor(LED_BASE));
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([{ index: 0, reason: 'aday bir nesne değil' }]);
  });

  it('aday sayısı sınırı', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 2 }, (_, i) => ({ ...goodLed, supplyVoltages: [9 + i] }));
    const r = validateCandidates('series-led', many, ctxFor(LED_BASE));
    expect(r.rejected.filter((x) => /en fazla/.test(x.reason))).toHaveLength(2);
  });

  it('havuzda zaten olan şablon tekrar eklenmez', () => {
    const first = led({}).accepted[0];
    const r = validateCandidates('series-led', [goodLed], ctxFor(LED_BASE, [first]));
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/zaten var/);
  });

  it('aynı yanıtta iki kez önerilen aday bir kez kabul edilir', () => {
    const r = validateCandidates('series-led', [goodLed, goodLed], ctxFor(LED_BASE));
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([{ index: 1, reason: 'aynı şablon havuzda zaten var' }]);
  });
});

describe('sahte istemcinin önerileri', () => {
  it.each(['series-led', 'series-parallel'] as const)('%s: beklenen kabul/ret sayıları', async (type) => {
    const { candidates } = await createMockProvider().generateTemplates({ type, markdown: '', courseName: 'D', topicName: 'T', count: 8 });
    const r = validateCandidates(type, candidates, ctxFor(type === 'series-led' ? LED_BASE : SP_BASE));
    expect(r.total).toBe(MOCK_EXPECTED[type].total);
    expect(r.accepted).toHaveLength(MOCK_EXPECTED[type].accepted);
    expect(r.rejected).toHaveLength(MOCK_EXPECTED[type].total - MOCK_EXPECTED[type].accepted);
  });
});
