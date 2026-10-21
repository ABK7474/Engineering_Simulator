// Nodal analiz çözücüsünün testleri. Beklenen değerlerin hepsi ELLE hesaplanmış sabitlerdir;
// hiçbiri formülle ya da çözücüyle üretilmez. Her devrenin el hesabı yorumda yazılı.

import { describe, expect, it } from 'vitest';
import { checkSolution, solveDC, type Element } from './mna';

/** Her çözümde KCL ve güç dengesi de sağlanmalı (çözümden bağımsız kontrol). */
function solveChecked(elements: Element[]) {
  const s = solveDC(elements);
  const c = checkSolution(elements, s);
  expect(c.kcl).toBeLessThan(1e-9);
  expect(c.power).toBeLessThan(1e-9);
  return s;
}

describe('Devre 1: gerilim bölücü', () => {
  // 12 V, üstte R1 = 4 kΩ, altta R2 = 8 kΩ.
  // I = 12 / (4000 + 8000) = 1 mA;  V_orta = 12 · 8000 / 12000 = 8 V.
  const s = solveChecked([
    { id: 'V1', kind: 'V', a: 'in', b: '0', volts: 12 },
    { id: 'R1', kind: 'R', a: 'in', b: 'mid', ohms: 4000 },
    { id: 'R2', kind: 'R', a: 'mid', b: '0', ohms: 8000 },
  ]);

  it('V_orta = 8 V', () => expect(s.voltage.mid).toBeCloseTo(8, 9));
  it('I = 1 mA (R1 ve R2 aynı akım)', () => {
    expect(s.current.R1).toBeCloseTo(0.001, 12);
    expect(s.current.R2).toBeCloseTo(0.001, 12);
  });
  it('kaynak 1 mA verir (akımı −1 mA), 12 mW', () => {
    expect(s.current.V1).toBeCloseTo(-0.001, 12);
    expect(s.power.V1).toBeCloseTo(-0.012, 12);
  });
});

describe('Devre 2: seri + paralel', () => {
  // 10 V, R1 = 2 Ω seri; sonra R2 = 6 Ω ∥ R3 = 3 Ω.
  // R2∥R3 = 6·3/(6+3) = 2 Ω;  R_eş = 2 + 2 = 4 Ω;  I = 10 / 4 = 2,5 A.
  // V_orta = 2,5 · 2 = 5 V;  I2 = 5/6 = 0,8333 A;  I3 = 5/3 = 1,6667 A.
  // P: R1 = 2,5²·2 = 12,5 W;  R2 = 5²/6 = 4,1667 W;  R3 = 5²/3 = 8,3333 W;  toplam 25 W.
  const s = solveChecked([
    { id: 'V1', kind: 'V', a: 'in', b: '0', volts: 10 },
    { id: 'R1', kind: 'R', a: 'in', b: 'mid', ohms: 2 },
    { id: 'R2', kind: 'R', a: 'mid', b: '0', ohms: 6 },
    { id: 'R3', kind: 'R', a: 'mid', b: '0', ohms: 3 },
  ]);

  it('toplam akım 2,5 A', () => expect(s.current.R1).toBeCloseTo(2.5, 9));
  it('V_orta = 5 V', () => expect(s.voltage.mid).toBeCloseTo(5, 9));
  it('akım bölücü: I2 = 0,8333 A, I3 = 1,6667 A', () => {
    expect(s.current.R2).toBeCloseTo(0.833333, 5);
    expect(s.current.R3).toBeCloseTo(1.666667, 5);
  });
  it('güçler: 12,5 W + 4,1667 W + 8,3333 W = 25 W', () => {
    expect(s.power.R1).toBeCloseTo(12.5, 9);
    expect(s.power.R2).toBeCloseTo(4.166667, 5);
    expect(s.power.R3).toBeCloseTo(8.333333, 5);
    expect(s.power.V1).toBeCloseTo(-25, 9);
  });
});

describe('Devre 3: iki kaynak, tek düğüm (nodal denklem)', () => {
  // 12 V —R1 = 4 Ω— a;  3 V —R2 = 2 Ω— a;  a —R3 = 4 Ω— toprak.
  // KCL(a): (Va − 12)/4 + (Va − 3)/2 + Va/4 = 0  → ×4: Va − 12 + 2Va − 6 + Va = 0 → Va = 4,5 V.
  // I1 = (12 − 4,5)/4 = 1,875 A (a'ya doğru);  I2 = (3 − 4,5)/2 = −0,75 A (a'dan 3 V kaynağına akar);
  // I3 = 4,5/4 = 1,125 A.  Kontrol: 1,875 − 0,75 = 1,125.
  const s = solveChecked([
    { id: 'V1', kind: 'V', a: 's1', b: '0', volts: 12 },
    { id: 'V2', kind: 'V', a: 's2', b: '0', volts: 3 },
    { id: 'R1', kind: 'R', a: 's1', b: 'a', ohms: 4 },
    { id: 'R2', kind: 'R', a: 's2', b: 'a', ohms: 2 },
    { id: 'R3', kind: 'R', a: 'a', b: '0', ohms: 4 },
  ]);

  it('Va = 4,5 V', () => expect(s.voltage.a).toBeCloseTo(4.5, 9));
  it('I1 = 1,875 A, I2 = −0,75 A, I3 = 1,125 A', () => {
    expect(s.current.R1).toBeCloseTo(1.875, 9);
    expect(s.current.R2).toBeCloseTo(-0.75, 9);
    expect(s.current.R3).toBeCloseTo(1.125, 9);
  });
  it('3 V kaynağı akım çeker (şarj olur): akımı +0,75 A, güç +2,25 W', () => {
    expect(s.current.V2).toBeCloseTo(0.75, 9);
    expect(s.power.V2).toBeCloseTo(2.25, 9);
  });
});

describe('Devre 4: dengeli Wheatstone köprüsü (seri-paralel değil)', () => {
  // 10 V; sol kol: R1 = 100 Ω (üst) / R2 = 200 Ω (alt); sağ kol: R3 = 50 Ω / R4 = 100 Ω; köprü R5 = 1 kΩ.
  // 100/200 = 50/100 → dengeli: Va = 10·200/300 = 6,6667 V, Vb = 10·100/150 = 6,6667 V, I5 = 0.
  // Kaynak akımı = 10/300 + 10/150 = 0,03333 + 0,06667 = 0,1 A.
  const s = solveChecked([
    { id: 'V1', kind: 'V', a: 'in', b: '0', volts: 10 },
    { id: 'R1', kind: 'R', a: 'in', b: 'a', ohms: 100 },
    { id: 'R2', kind: 'R', a: 'a', b: '0', ohms: 200 },
    { id: 'R3', kind: 'R', a: 'in', b: 'b', ohms: 50 },
    { id: 'R4', kind: 'R', a: 'b', b: '0', ohms: 100 },
    { id: 'R5', kind: 'R', a: 'a', b: 'b', ohms: 1000 },
  ]);

  it('Va = Vb = 6,6667 V', () => {
    expect(s.voltage.a).toBeCloseTo(6.666667, 5);
    expect(s.voltage.b).toBeCloseTo(6.666667, 5);
  });
  it('köprü akımı 0', () => expect(s.current.R5).toBeCloseTo(0, 12));
  it('kaynak akımı 0,1 A', () => expect(s.current.V1).toBeCloseTo(-0.1, 9));
});

describe('Ek testler', () => {
  it('akım kaynağı: 2 mA → 1 kΩ ∥ 1 kΩ (= 500 Ω) → 1 V', () => {
    // Kaynak akımı topraktan alıp x'e basar. V = 0,002 · 500 = 1 V; her dirençten 1 mA.
    const s = solveChecked([
      { id: 'I1', kind: 'I', a: '0', b: 'x', amps: 0.002 },
      { id: 'Ra', kind: 'R', a: 'x', b: '0', ohms: 1000 },
      { id: 'Rb', kind: 'R', a: 'x', b: '0', ohms: 1000 },
    ]);
    expect(s.voltage.x).toBeCloseTo(1, 9);
    expect(s.current.Ra).toBeCloseTo(0.001, 12);
  });

  it('oyun topolojisi: 24 V, R₁ = 12 Ω, motor 24 Ω ∥ R₂ = 24 Ω', () => {
    // Motor ∥ R₂ = 12 Ω;  toplam 24 Ω;  I_s = 24/24 = 1 A;  V_a = 1 · 12 = 12 V;
    // I_m = 12/24 = 0,5 A;  I₂ = 0,5 A;  P(R₁) = 1²·12 = 12 W.
    const s = solveChecked([
      { id: 'Vs', kind: 'V', a: 'top', b: '0', volts: 24 },
      { id: 'R1', kind: 'R', a: 'top', b: 'a', ohms: 12 },
      { id: 'Rm', kind: 'R', a: 'a', b: '0', ohms: 24 },
      { id: 'R2', kind: 'R', a: 'a', b: '0', ohms: 24 },
    ]);
    expect(s.voltage.a).toBeCloseTo(12, 9);
    expect(s.current.Vs).toBeCloseTo(-1, 9);
    expect(s.current.Rm).toBeCloseTo(0.5, 9);
    expect(s.current.R2).toBeCloseTo(0.5, 9);
    expect(s.power.R1).toBeCloseTo(12, 9);
  });

  it('ölçüm senaryosu: R₂ sökülü (açık devre), R₁ = 24 Ω, motor 24 Ω', () => {
    // Paralel kol yok → bölücü: V_a = 24 · 24/48 = 12 V.
    const s = solveChecked([
      { id: 'Vs', kind: 'V', a: 'top', b: '0', volts: 24 },
      { id: 'R1', kind: 'R', a: 'top', b: 'a', ohms: 24 },
      { id: 'Rm', kind: 'R', a: 'a', b: '0', ohms: 24 },
    ]);
    expect(s.voltage.a).toBeCloseTo(12, 9);
  });

  it('toprağa yolu olmayan düğümde açıklamalı hata', () => {
    expect(() =>
      solveDC([
        { id: 'V1', kind: 'V', a: 'in', b: '0', volts: 5 },
        { id: 'R1', kind: 'R', a: 'in', b: '0', ohms: 10 },
        { id: 'R2', kind: 'R', a: 'x', b: 'y', ohms: 10 },
      ]),
    ).toThrow(/'x', 'y' düğümünün toprağa yolu yok/);
  });

  it('paralel iki farklı gerilim kaynağı (tekil sistem) açıklamalı hata', () => {
    expect(() =>
      solveDC([
        { id: 'V1', kind: 'V', a: 'in', b: '0', volts: 5 },
        { id: 'V2', kind: 'V', a: 'in', b: '0', volts: 6 },
        { id: 'R1', kind: 'R', a: 'in', b: '0', ohms: 10 },
      ]),
    ).toThrow(/tekil/);
  });

  it('geçersiz eleman değerlerini reddeder', () => {
    expect(() => solveDC([{ id: 'R', kind: 'R', a: 'a', b: '0', ohms: 0 }])).toThrow(/pozitif/);
    expect(() => solveDC([{ id: 'R', kind: 'R', a: 'a', b: 'a', ohms: 5 }])).toThrow(/aynı düğüm/);
    expect(() =>
      solveDC([
        { id: 'R', kind: 'R', a: 'a', b: '0', ohms: 5 },
        { id: 'R', kind: 'R', a: 'a', b: '0', ohms: 5 },
      ]),
    ).toThrow(/iki kez/);
  });
});

describe('ideal op-amp (OA)', () => {
  it('eviren yükselteç: Vin = 1 V, R₁ = 1 kΩ, Rf = 10 kΩ → Vout = −10 V, giriş akımı 1 mA', () => {
    const els: Element[] = [
      { id: 'Vin', kind: 'V', a: 'in', b: '0', volts: 1 },
      { id: 'R1', kind: 'R', a: 'in', b: 'n', ohms: 1000 },
      { id: 'Rf', kind: 'R', a: 'n', b: 'out', ohms: 10_000 },
      { id: 'U1', kind: 'OA', a: '0', b: 'n', out: 'out' },
    ];
    const s = solveDC(els);
    expect(s.voltage.out).toBeCloseTo(-10, 9);
    expect(s.voltage.n).toBeCloseTo(0, 12); // sanal toprak
    expect(s.current.R1).toBeCloseTo(0.001, 12);
    const chk = checkSolution(els, s);
    expect(chk.kcl).toBeLessThan(1e-12);
    expect(chk.power).toBeLessThan(1e-9);
  });

  it('evirmeyen yükselteç: Vin = 0,5 V, Rg = 1 kΩ, Rf = 3 kΩ → Vout = 0,5·(1 + 3) = 2 V', () => {
    const s = solveDC([
      { id: 'Vin', kind: 'V', a: 'p', b: '0', volts: 0.5 },
      { id: 'Rg', kind: 'R', a: 'n', b: '0', ohms: 1000 },
      { id: 'Rf', kind: 'R', a: 'out', b: 'n', ohms: 3000 },
      { id: 'U1', kind: 'OA', a: 'p', b: 'n', out: 'out' },
    ]);
    expect(s.voltage.out).toBeCloseTo(2, 12);
    expect(s.voltage.n).toBeCloseTo(0.5, 12);
  });

  it('referanslı ofset: Vs = 1 V, Vref = 2,5 V, Rf = 10 kΩ, Rg = 10 kΩ, Rr = 20 kΩ → Vout = 1·(1 + 1 + 0,5) − 2,5·0,5 = 1,25 V', () => {
    const s = solveDC([
      { id: 'Vs', kind: 'V', a: 'p', b: '0', volts: 1 },
      { id: 'Vref', kind: 'V', a: 'r', b: '0', volts: 2.5 },
      { id: 'Rg', kind: 'R', a: 'n', b: '0', ohms: 10_000 },
      { id: 'Rr', kind: 'R', a: 'n', b: 'r', ohms: 20_000 },
      { id: 'Rf', kind: 'R', a: 'out', b: 'n', ohms: 10_000 },
      { id: 'U1', kind: 'OA', a: 'p', b: 'n', out: 'out' },
    ]);
    expect(s.voltage.out).toBeCloseTo(1.25, 12);
  });
});
