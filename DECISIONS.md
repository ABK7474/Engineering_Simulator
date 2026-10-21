# Kararlar (otonom oturumlardan)

Belirsiz kalan ve beklemeden verilen kararlar; her biri bir cümle. Tarih: ilgili oturum.

## 2026-10-22 — Varlıklar ve görsel zenginleştirme
- public/assets'e yanlışlıkla açılmış ham paketler (IndustrialPack, Ultimate Modular Sci-Fi, Kenney Space Kit, Kenney Conveyor Kit, yeni sesler) ~/oyun-kaynak-assetler altına taşındı; İndirilenler'deki arşivlere ve Masaüstü'ndeki eski kopyalara dokunulmadı.
- Kenney paketleri (düz renkli, farklı stil) şimdilik kullanılmadı; Quaternius MEGAKIT/Essentials/Ultimate Modular ile görsel tutarlılık seçildi.
- Ultimate Space Kit (İndirilenler, çizgi film tarzı gezegen/karakter paketi) istasyon içine uymadığı için açılmadı.
- Ultimate Modular Sci-Fi için FBX yerine OBJ → GLB dönüşümü kullanıldı (FBX çevirisi ölçek/eksen bozuk).
- Boyut bütçesi: 2048'lik PaddedWall dokuları 1024'e küçültüldü; tek prop için ayrı doku seti yüklenmedi.
- Oda giydirmesi elle konum yerine temaya göre deterministik üretilir (yeni oda = JSON'da tema adı); her temada karakteri garanti eden "zorunlu setler" vardır.
- Kontrol odasındaki elle konmuş büyük sandık ve dolap kaldırıldı; oda tema giydirmesine bırakıldı (masalar için yer açıldı).
- Işıklar sabit sayılı havuz (6 soğuk + 2 sıcak): ışık sayısı değişince three.js shader yeniden derlediği için oda geçişinde takılma olmasın diye.
- Kapalı metal kapının arkasındaki oda çizilmez; kamera uzak düzlemi 34 m (sis ~30 m'de görüntüyü yutuyor).
- Kodla üretilen kir/pas/tabela/ekran dokuları canvas ile; dış doku dosyası eklenmedi.
- Ağaç/BFS/DFS/sıralama, ds-trace'in C# alt küme IR'sine eklenmedi; dizi ve özyineleme gerektirdikleri için ayrı `algo-trace` türü oldu (aynı tek-onarım-noktası ölçütü, aynı sonuç havuzu).
- algo-trace'te bozuk satır hiçbir zaman ilk satır olmaz (başlangıçtan hemen sonraki hata çok kolay bulunuyordu).
- C# çıktı tahmini şablonları LLM'le değil elle yazıldı; yanılgılar kod yaması olarak tanımlanır ve çıktıları da gerçek derleyiciyle hesaplanır, böylece rapor "yazdığın çıktı şu yanılgının çıktısı" diyebilir.
- C# çıktıları `npm run gen:cs` ile content/generated/cs-output.json'a yazılır; şablon değişip yeniden üretilmezse kod özeti tutmaz ve test kırılır.
- Oyun açılışında dünya aşamaları 1 tohumla denetlenir (6 odada 3 tohum ≈ 1 sn sürüyordu); 20 tohumluk tam doğrulama world.test.ts'te.
