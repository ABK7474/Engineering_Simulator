# Proje: Derin Mühendis (çalışma adı)

Ders çalışmak için tasarlanmış, hikâyeli, su altı temalı 3D gezinmeli bir bulmaca oyunu.
Oyuncu bir mühendistir; terk edilmiş bir su altı araştırma istasyonundaki arızaları, ders bilgisini
gerçekten kullanarak onarır. Bilgi, oyunun mekaniğinin kendisidir (çoktan seçmeli quiz DEĞİL).

Kullanıcı: bilgisayar + elektrik-elektronik mühendisliği öğrencisi. Dersler: Devre Teorisi 1,
Elektrik-Elektronik Devreler, Diferansiyel Denklemler, Mühendislik Matematiği, Olasılık ve İstatistik,
Veri Yapıları, İleri Programlama (C#). Kod aşamaları C, C# ve Java olabilir.

## Altın kurallar (asla bozma)

1. **Doğru cevabı LLM değil, kod hesaplar.** LLM soru/şablon yazar; sayısal cevabı çözücü (sympy vb.)
   hesaplar; kod sorularında gerçek derleyici çalıştırılır. LLM'in "doğru" demesi doğrulama sayılmaz.
2. **Oyun sırasında API gerekmez.** LLM sadece "konu ekleme" sırasında çağrılır. Üretilen sorular
   doğrulanıp önbelleğe alınır.
3. **LLM sağlayıcısı tek dosyada izole.** Sadece `src/llm/client.ts` Gemini'yi bilir. Oyunun geri kalanı
   `pdfToMarkdown()` ve `generateTemplates()` gibi soyut fonksiyonları çağırır. Model adını koda
   gömmeden önce Google'ın güncel dokümanından kontrol et (eski model adı yazma).
4. **Kullanıcı verisi koddan ayrı.** Notlar, sorular, ilerleme tarayıcıda IndexedDB'de durur.
   "Dışa aktar / içe aktar" yedek düğmesi olmalı.
5. **Önce çalışan en küçük prototip.** Her adımda oynanabilir bir şey kalsın. Kapsamı kendiliğinden genişletme.

## Teknoloji

- Web, TypeScript, Vite. GitHub Pages ile yayın (güncelleme = yeni sürümü yayınlamak; ayrı güncelleyici yok).
- 3D gezinme: Three.js. Bulmaca ekranları 2D (HTML/Canvas/SVG paneller).
- Matematik doğrulama: sympy, tarayıcıda Pyodide ile (ilk yüklemeden sonra önbelleğe alınır).
- İçerik üretimi: Gemini API (PDF ve görsel okuyabilir). Kullanıcının kendi anahtarı.
- Kod aşamaları için isteğe bağlı yerel çalıştırıcı (aşağıya bak).

## Mimari katmanlar (birbirinden bağımsız)

- `core/`: konu kartları, arıza kartları, aralıklı tekrar, ilerleme, kaynaklar (oksijen/güç/su).
- `solvers/`: her problem türü için çözücü + doğrulayıcı + "hata sonucu" üretici.
- `puzzles/`: 2D bulmaca arayüzleri (devre editörü, trace tablosu, denklem girişi...).
- `hub/`: 3D istasyon (gezinme, kapılar, paneller, hata efektleri). Hub değiştirilebilir olmalı;
  bulmaca mantığı hub'a bağımlı olmasın.
- `llm/`: içe aktarma ve şablon üretimi (tek dosyada sağlayıcı).
- `story/`: sezonlar, bölümler, yapay zekâ karakterinin replikleri.
- `runner/`: yerel kod çalıştırıcı istemcisi.

## İçerik hattı

```
kaynak PDF → (bir kez, Gemini) → temiz .md + konu özeti → KULLANICI İNCELER
          → .md → Gemini → problem şablonları (JSON)
          → çözücü/derleyici doğrular → kör çözüm karşılaştırması → önbellek → oyun
```

- PDF'teki şemalar önemli (devre şemaları, grafikler); metin çıkarıp bırakma, görsel okumayı kullan.
- Kullanıcı `.md` çıktısını onaylamadan şablon üretimi başlamasın.
- Doğrulanamayan soru havuza girmez; kavramsal sorularda kör çözüm uyuşması + LLM incelemesi yeterli sayılır.
- Oyunda "bu soru hatalı" düğmesi olsun; işaretlenen soru havuzdan çıkar.
- Her derste soru ZOR olmalı (orta-zor üstü): çok adımlı, ters problemler (çıktıdan girdi bulma),
  formüle doğrudan sokulamayan durumlar.

## API anahtarı

- İlk kez "konu ekle" denildiğinde sor (açılışta değil; "şimdilik atla" olsun). Ayarlardan değiştirilebilir.
- Anahtar koda, repoya, loglara girmez. Tarayıcıda yerel olarak saklanır. `.env` varsa `.gitignore`'da.
- Saklama biçimi: yalnız `localStorage` (`derin-muhendis.llm.apiKey`); dışa aktarılan yedeğe girmez,
  ekranda yalnız son 4 karakter görünür, hata metinlerinde maskelenir. Ayarlar'da "Bağlantıyı sına" var.

## LLM entegrasyonu (karar notları, Ekim 2026 dokümanına göre)

- Sağlayıcı: Gemini, yalnız `src/llm/client.ts`. Model varsayılanı `gemini-3.8-flash`; Ayarlar'dan
  değiştirilebilir (isim eskiyince koda dokunmadan güncellenir). Değiştirmeden önce güncel dokümana bak.
- API: **Interactions API** (`POST /v1beta/interactions`, GA; `generateContent` legacy). SDK yok, düz
  `fetch`; anahtar `x-goog-api-key` başlığında. `store: false` (ders PDF'leri sağlayıcıda saklanmaz).
- `thinking_level: "low"` (3.8 Flash `minimal`i kabul etmez; düşünme token'ları çıktı bütçesinden yer).
- PDF satır içi base64 `document` parçası; sağlayıcı sayfaları görüyle okur (devre şemaları dahil).
  Üst sınır 50 MB / 1000 sayfa. **40 sayfa üstünde** "konulara bölün" uyarısı; sayfa sayısı
  güvenilir sayılamazsa (0 ya da `/ObjStm`) "bilinmiyor" denir ve uyarı **15 MB** üstüne göre verilir.
- Yapılandırılmış çıktı (`response_format` + JSON şema) yalnız biçimi daraltır; değerleri kod doğrular.
- Kesilme kuralı: yanıt `status: "incomplete"`, yarım JSON ya da boş .md ise sonuç "eksik" işaretlenir
  ve **onaylanamaz**. Eksik .md asla sessizce kabul edilmez.
- Şablon üretiminde LLM yalnız mevcut problem türlerinin parametre şemasında aday önerir (seri-paralel
  topolojisi ve çözüm zinciri sabit); her aday 20 tohumda mevcut doğrulayıcıdan geçmeden havuza girmez.
- Test: `?llm=mock` sahte istemciyle bütün hat ağsız sınanır; otomatik testler gerçek API çağırmaz.

## Oyun döngüsü

1. İstasyon hub'ında dolaş (3D). Bozuk bir panel/kapı/makineye yaklaş.
2. **Kısa brifing:** o konunun özeti gösterilir (konu kartından).
3. **Arıza = ardışık aşamalar**, her aşama farklı bir dersten olabilir
   (örn. 1. güç devresi onar → 2. kontrol kodundaki hatalı trace'i düzelt → 3. salınımı kararlı yap).
   Aşamalar hikâye olarak bağlı, sayısal olarak bağımsız. (Veri bağlı zincirler ileride.)
4. Sınırlı ölçüm/ipucu araçları vardır; ipucu kaynak harcatır.
5. **Sonuç:** simülasyon/çözücü fiziksel sonucu hesaplar.
6. **Olay raporu:** ne seçildi, ne oldu, doğrusu neydi, hesap nasıl. Asıl öğrenme burada.

### Hata sonuçları

- Sonuç havuzu hatanın fiziğinden gelir (çözücü hesaplar): aşırı akım → yanma/sigorta; yetersiz akım →
  motor dönmez/kapı takılır; kısa devre → sigorta atar. Kod: bellek hatası → AI çekirdeği çöker,
  sonsuz döngü → panel donar, sınır hatası → sensör yanlış okur.
- Rastgelelik sadece havuz içinde; hata büyüdükçe ağır sonuç olasılığı artar.
- Hasar kalıcı ama oyun bitmez: oksijen/güç/su kaynakları tükenir; çok kötü giderse bölüm kapanır, tekrar denenir.
- Önceki hatalar hikâyede iz bırakır (örn. sızdıran kapı).

## Kod aşaması türleri

Çalıştırıcı GEREKTİRMEYEN (üretim sırasında bir kez gerçek derleyiciyle çalıştırılıp kaydedilir):
hatalı trace düzelt (doğru izlemeden otomatik bozulur), trace tablosunu doldur, çıktıyı tahmin et, hatayı bul.
Çalıştırıcı GEREKTİREN: hata ayıklama (kodu düzelt), fonksiyon yazma.

- Çalıştırıcı kapalıysa o aşama "bekleyen onarım" olur; hikâye akışı bozulmaz.
- C'de tanımsız davranış içeren sorular tekrar çalıştırılıp tutarlılık kontrol edilir; tutarsızsa elenir
  (bilerek öğretilenler ayrı işaretle ve açıklamayla gelir).
- İlk sürümde programlar küçük (20-30 satır).

### Yerel çalıştırıcı güvenlik kuralları

- Sadece `127.0.0.1`'e bağlan; sadece oyunun origin'inden gelen isteği kabul et.
- Zaman ve bellek sınırı zorunlu. Ayrı geçici klasör, mümkünse ağsız (bubblewrap/Docker).
- LLM'in ürettiği kod çalıştırılmadan önce kullanıcı tarafından gözden geçirilmiş olmalı.
- Kurulum betiği derleyicilerin (gcc, dotnet, javac) varlığını kontrol edip eksiği söylesin.

## Hikâye ve ton

- Sezon yapısı. **Sezon 1:** okyanus dibinde terk edilmiş araştırma istasyonu; dışarıdan çağrı geldi,
  mühendis gönderildi. İstasyonun yapay zekâsı çalışıyor ama bir şey saklıyor. Ton: hafif gizemli.
- Alt sistemler: güç (devre dersleri), basınç/kapılar (diferansiyel denklemler),
  AI çekirdeği (veri yapıları, C#), sensör/haberleşme kayıtları (olasılık). Mühendislik matematiği yardımcı araç.
- Kullanıcının yüklediği her konu havuzda bir **arıza kartı** olarak durur; sezonlar bu havuzdan çeker.
  Yeni sezon eski kartları da kullanabilir (tekrar doğal gelir).
- İstasyon yapay zekâsı: ipucu verir, hikâyeyi taşır. İlk sürümde repliklerin tamamı önceden yazılmış
  (şablon/JSON), çalışma anında LLM çağrısı YOK.

## Grafik kuralları (3D hub)

- Gölgeler sabit: sabit nesneler için gölge haritası bir kez hesaplanır, sonra dondurulur
  (`shadowMap.autoUpdate = false`, yüklemede `needsUpdate = true`).
- Hareketli nesnelere blob (sahte) gölge.
- Dinamik ışıklar (alarm, kıvılcım) gölge üretmez; aynı anda en fazla birkaç tane.
- Sis (fog) ile su altı atmosferi ve çizim maliyeti düşürme. Low-poly hazır varlıklar (CC0) kullan.
- Bulmacalar asla 3D içinde yapılmaz; yaklaşınca 2D panel açılır.

## Çalışma şekli

- Büyük değişikliklerden önce plan sun, onay bekle.
- Çözücüler için birim testi yaz: bilinen cevaplı problemlerle doğrula.
- Yeni problem türü eklerken: çözücü + doğrulayıcı + hata sonucu havuzu + olay raporu şablonu birlikte gelir.
- İçerik koddan ayrı (JSON/markdown): yeni konu eklemek kod yazmayı gerektirmesin.
