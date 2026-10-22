# El hesabı kontrolleri

Yeni dokuz türün yanı sıra algo-trace, cs-output ve light-decay için el hesapları burada. Örnekler testlerdeki sayılardan **bağımsız** seçildi; hesaplar formülden elle yapıldı, yalnız aritmetik hesap makinesiyle teyit edildi. Her örnek `src/handcheck.test.ts`'te çözücünün sonucuyla karşılaştırılıyor. **13 örneğin 13'ü uyuşuyor, uyuşmazlık yok.** En altta, testlerdeki mevcut sabitlerin elle yeniden kontrolü var.

## 1. Süperpozisyon (iki jeneratör, I₃ ölçümü)

**Veri:** V₁ = 12 V, R₁ = 100 Ω, R₂ = 200 Ω, R₃ = 100 Ω, V₂ = 6 V.

**İleri yön, a düğümünde KCL:**
- (12 − Va)/100 + (6 − Va)/200 = Va/100
- 0,12 + 0,03 = Va·(0,01 + 0,005 + 0,01) → 0,15 = 0,025·Va → **Va = 6 V**
- I₃ = 6/100 = **0,06 A**

**Ters yön (oyuncunun yolu), M = 0,06 A verilmiş:**
- G = 1/100 + 1/200 + 1/100 = 0,025 S
- Yalnız V₁ açıkken: I₃′ = V₁/(R₁·G·R₃) = 12/250 = 0,048 A
- V₂'nin volt başına katkısı: b = 1/(R₂·G·R₃) = 1/500 = 0,002 A/V
- V₂ = (0,06 − 0,048)/0,002 = **6 V** ✔

## 2. Diyot (Shockley, iki katalog noktası)

**Veri:** (20 mA, 3,10 V) ve (5 mA, 2,95 V); Vs = 5 V; hedef I* = 15 mA.

- Eğim: n·V_T = (3,10 − 2,95)/ln(20/5) = 0,15/1,386294 = **0,108202 V**
- Diyot gerilimi: V_D = 3,10 + 0,108202·ln(15/20) = 3,10 − 0,031128 = **3,068872 V**
- Seri direnç: R = (5 − 3,068872)/0,015 = **128,742 Ω**
- Çapraz kontrol: bu iki noktadan kurulan modelle, Newton ve ikiye bölme çözücüleri bu R'de 15 mA buluyor ✔

## 3. RC alçak geçiren filtre (kesim aralığı)

**Veri:** C = 47 nF; 1 kHz en fazla 1 dB zayıflamalı; 20 kHz en az 20 dB bastırılmalı. Kazanç |H| = 1/√(1 + (f/f_c)²).

**Sinyal şartı (f_c'yi alttan sınırlar):**
- 1 + (1000/f_c)² ≤ 10^0,1 = 1,258925
- f_c ≥ 1000/√0,258925 = **1965,23 Hz**

**Gürültü şartı (f_c'yi üstten sınırlar):**
- 1 + (20000/f_c)² ≥ 10² = 100
- f_c ≤ 20000/√99 = **2010,08 Hz**

**Direnç aralığı (R = 1/(2πC·f_c)):** **1684,65 Ω ≤ R ≤ 1723,10 Ω**

**Kontrol, R = 1,7 kΩ:**
- f_c = 1991,93 Hz
- 1 kHz: −0,976 dB (≤ 1 dB ✔)
- 20 kHz: −20,078 dB (≥ 20 dB ✔)

Çözücünün karmaşık empedans yolu da aynı dB değerlerini veriyor.

## 4. İkinci mertebe sönüm (kapı amortisörü)

**Veri:** m = 60 kg, serbest periyot T₀ = 1,2 s, aday c = 500 N·s/m.

- ω_n = 2π/1,2 = **5,235988 rad/s**
- k = m·ω_n² = 60·27,41557 = **1644,93 N/m**
- c_kritik = 2·m·ω_n = **628,32 N·s/m**
- ζ = 500/628,32 = **0,795775** (eksik sönümlü)
- Aşma: e^(−πζ/√(1−ζ²)) = e^(−2,5000/0,605600) = e^(−4,1281) = **%1,611**

Kapalı form ve RK4 benzetimi aynı aşmayı ölçüyor ✔

## 5. Özdeğerle kararlılık

**Veri:** A = [[a, b], [−k, −c]], a = 0,5, b = 1, c = 3.

**k = 5:**
- iz = a − c = −2,5
- det = −a·c + b·k = −1,5 + 5 = 3,5
- λ² + 2,5λ + 3,5 = 0 → λ = −1,25 ± j·√(14 − 6,25)/2 = **−1,25 ± 1,391941j**
- |λ| = √3,5 = 1,870829 → ζ = 1,25/1,870829 = **0,668153**

**k = 1,5:** det = 0 → λ = 0 ve −2,5 (kararlılık sınırı).

## 6. Laplace: son ve başlangıç değeri

**Veri:** G(s) = 2(s + 1)/((s + 0,5)(s + 4)), basamak girişi U = 3. Y(s) = G(s)·3/s.

- **Son değer teoremi:** y(∞) = lim s→0 s·Y(s) = 3·G(0) = 3·2·1/(0,5·4) = **3**
- **Kısmi kesirle teyit:** Y(s)'nin s = 0'daki rezidüsü 6·1/(0,5·4) = 3 ✔
- **Başlangıç eğimi:** y′(0⁺) = lim s→∞ s²·Y(s) = 3·2 = **6**

Durum uzayı RK4 benzetimi de 3 ve 6 ölçüyor ✔

## 7. Fazör toplamı

**Veri:** 20∠−60° + 40∠45°.

- 20∠−60° = 10 − 17,3205j
- 40∠45° = 28,2843 + 28,2843j
- Toplam = 38,2843 + 10,9638j
- Genlik: A = √(38,2843² + 10,9638²) = √1585,89 = **39,8232**
- Faz: φ = atan2(10,9638, 38,2843) = **15,981°**

Bir periyot boyunca örnekleyerek bulunan tepe değeri ve faz da aynı ✔

## 8. Bayes (sensör 1 alarm, sensör 2 sessiz)

**Veri:** P(K) = %4; S1: tespit %90, yanlış alarm %10; S2: tespit %80, yanlış alarm %20.

- Pay: 0,04 · 0,90 · (1 − 0,80) = 0,0072
- Kaçak yokken aynı gözlem: 0,96 · 0,10 · (1 − 0,20) = 0,0768
- P(K | gözlem) = 0,0072/0,0840 = **3/35 ≈ 0,085714**

Çözücü kesin kesirle tam olarak 3/35 buluyor ✔

## 9. Binom (pompa yedekliliği)

**Veri:** Her pompa q = %90 olasılıkla çalışır; en az 3 pompa gerekir.

**n = 4:**
- P(X ≥ 3) = 4·0,9³·0,1 + 0,9⁴ = 0,2916 + 0,6561 = **0,9477**

**n = 5:**
- P(X = 2) = 10·0,81·0,001 = 0,0081
- P(X = 1) = 5·0,9·0,0001 = 0,00045
- P(X = 0) = 0,00001
- P(X ≥ 3) = 1 − 0,00856 = **0,99144**

%99 şartı için en az **5 pompa** gerekir.

## 10. Poisson (conta yedekleri)

**Veri:** λ = 1,5; e^(−1,5) = 0,223130.

- P(N ≤ 2) = 0,223130·(1 + 1,5 + 1,125) = **0,808847**
- P(N ≤ 3) = 0,223130·(3,625 + 0,5625) = **0,934358**
- P(N ≤ 4) = 0,223130·(4,1875 + 0,2109375) = **0,981424**

%95 şartı için **4 yedek** gerekir. Gama integrali yolu da aynı sonucu veriyor ✔

## 11. algo-trace

**Graf:** kenarlar 0–1, 0–3, 1–2, 2–3, 3–4; komşular artan sırada; başlangıç 0.

**BFS (kuyruk):**

| Adım | Çıkan | Kuyruk |
|---|---|---|
| 1 | 0 | [1, 3] |
| 2 | 1 | [3, 2] |
| 3 | 3 | [2, 4] |
| 4 | 2 | [4] |
| 5 | 4 | [] |

**DFS:** 0 → 1 → 2 → 3 → 4 sırasıyla girilir; son çağrı yığını (tepeden dibe) [4, 3, 2, 1, 0].

**Seçme sıralaması**, girdi [29, 10, 14, 37, 13]:
- min indisleri 1, 4, 2, 4
- 2. geçişten sonra dizi [10, 13, 14, 37, 29]

**Ekleme sıralaması**, girdi [31, 41, 59, 26, 53]:
- kaydırma sayıları 0, 0, 3, 1

**İkili arama ağacı**, anahtarlar 40, 20, 60, 10, 30, 50, 70, 25:
- 25'in ekleme yolu [40, 20, 30]
- preorder: 40 20 10 30 25 60 50 70
- postorder: 10 25 30 20 50 70 60 40

## 12. cs-output (kodu kafada çalıştırma)

**struct-copy, A = 40, B = 5, C = 8:**
- a = 40
- b = a (kopya) → Fill(8) → 48
- Drain(a) kopyayı azaltır, a 40 kalır
- arr[0] a'nın kopyası; dizi elemanı yerinde değişir → 48
- Çıktı: **40 / 48 / 88**

**try-finally, L = 20, A = 7, B = 40:**
- Read(7): "try 7", sonra return 14'ten önce "finally 7"
- Read(40): istisna fırlar → "catch 40", sonra "finally 40", −1 döner
- Toplam 14 − 1 = 13
- Çıktı: **try 7 / finally 7 / catch 40 / finally 40 / 13**

**linq-deferred, A = 18, B = 25, C = 47, D = 58, L = 20, M = 30:**
- Sorgu Count anında çalışır: liste [18, 25, 47, 58], limit 30
- {47, 58} → Count 2, Sum 105
- Liste temizlenince Count 0
- Çıktı: **2 / 105 / 0**

**short-circuit, P = false, Q = false, W = 10:**
- `||`'nin sol tarafı false, sağ taraf da değerlendirilir: "kontrol 1", "kontrol 2"; sonuç false, "geçti" yazılmaz
- `&&`'nin sol tarafı false: "kontrol 3", sağ taraf (Check 4) atlanır
- calls = 10 + 20 + 30 = 60
- Çıktı: **kontrol 1 / kontrol 2 / kontrol 3 / 60**

Dördü de dotnet'in kayıtlı çıktısıyla aynı ✔

> **Not:** İlk seçtiğim P = false, Q = true kümesi havuzda yok. Doğru bir eleme: o durumda kısa devre hiç devreye girmiyor, yani "kısa devre yok" yanılgısı da aynı çıktıyı verir. Bu tür sorular kasıtlı olarak üretilmiyor.

## 13. Acil aydınlatma sönümü

**Veri:** V₀ = 12 V, C = 0,47 F, R_L = 15 Ω, R = 10 Ω.

- τ = (10 + 15)·0,47 = **11,75 s**
- V_L(0) = 12·15/25 = 7,2 V
- V_L(15 s) = 7,2·e^(−1,276596) = **2,008695 V**
- V_L(45 s) = 7,2·e^(−3,829787) = **0,156342 V**

RK4 benzetimi de aynı değerleri veriyor ✔

## Testlerdeki mevcut sabitlerin elle yeniden kontrolü

| Test | Elle | Sonuç |
|---|---|---|
| Laplace 0,8(s+2)/((s+0,5)(s+2,5)), U = 3 | 3·0,8·2/1,25 = 3,84; 3·0,8 = 2,4 | ✔ |
| Fazör 30∠0° + 40∠90° | 30 + 40j → 50∠53,13° | ✔ |
| Bayes önsel %1, iki sensör %90/%5 | 0,0081/(0,0081 + 0,99·0,0025) = 0,0081/0,010575 = 36/47 | ✔ |
| Binom q = %80, en az 2, n = 3 | 3·0,64·0,2 + 0,512 = 0,896 = 112/125 | ✔ |
| Poisson λ = 2, P(N ≤ 3) | e⁻²·(1 + 2 + 2 + 4/3) = 0,135335·6,3333 = 0,857123 | ✔ |
| Kararlılık k = 4 | iz −2,5, det 2,5 → −1,25 ± 0,968246j; ζ = 1,25/√2,5 = 0,790569 | ✔ |
| Acil ışık R = 33 Ω (24 V, 0,22 F, 22 Ω) | τ = 12,1 s; 9,6·e^(−15/12,1) = 2,779007 V | ✔ |
| C# struct A = 20, B = 3, C = 4 | 20 / 24 / 44; sınıf sanılırsa 21 / 21 / 50 | ✔ |

Testlerle bu el hesapları arasında **uyuşmazlık bulunmadı.**
