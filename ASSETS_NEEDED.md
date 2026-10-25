# Eksik ya da kullanılamayan varlıklar

Bu dosya, oyunun daha iyi görünmesi/duyulması için gereken ama şu an olmayan (ya da lisansı doğrulanamadığı
için kullanılmayan) varlıkları listeler. Geçici çözüm sütunu, o arada oyunda ne kullanıldığını söyler.

## Lisansı belirsiz — kullanılmıyor

| Ne | Nerede | Sorun | Ne yapılmalı |
|---|---|---|---|
| IndustrialPack (CableDrum, Car_Jack, ElectricalBox, ElectricalBox02, ExplosiveBarrel, Gas_can, Gas_Cylinder, PalletTruck, Platform_Trolley, Water_Barrel, WorkLight, Worklight02; FBX + PNG) | `~/oyun-kaynak-assetler/modeller/IndustrialPack/` (İndirilenler/IndustrialPack.rar'dan) | Pakette lisans dosyası yok; web'de aynı dosya adlarıyla bir kaynak bulunamadı | Kaynak sayfayı ve lisansı (tercihen CC0) bildir; doğrulanırsa güç ve hava kilidi odalarında elektrik kutusu, gaz tüpü, çalışma lambası olarak kullanılabilir |

## Eksik model / doku / ses

| Ne | Hangi oda / olay | Geçici çözüm |
|---|---|---|
| Duvara monte elektrik panosu / sigorta kutusu (kapaklı) | Güç dağıtımı, tehdit olayı (sigorta bulmacası) | Mevcut `Prop_AccessPoint` terminali + duvar süsleri |
| Büyük yaratık (uzaktan geçen siluet, düşük poligon) | Dış sahne, tehdit olayı | Dış sahnedeki kodla üretilmiş kuyruklu gövde (exterior.ts) |
| Dalış kıyafeti / kask askısı | Hava kilidi | Dolaplar (`Prop_Locker`) |
| Sonar ekranı / radar konsolu modeli | Sensör/sonar odası | `Prop_Desk_*` + kodla çizilen sonar ekranı |
| Kısa metalik gıcırtı / gövde basınç sesi | Hava kilidi, basınç olayları | `creature_rumble` (alçak geçiren) |
| Elektrik vızıltısı (sürekli hum döngüsü) | Güç dağıtımı | Yok (sessiz) |
| Sürekli buhar tıslaması döngüsü | Güç, AI çekirdeği | Kısa buhar püskürmeleri (`steam_1–3`) aralıklı |
| Kanallarda akan su döngüsü (uzun) | Hava kilidi | `drip_loop` (7 s) |
| Küçük denizaltı (Müren) dış ve iç modeli, CC0 | Prolog, koridor penceresinden enkaz | Kodla kurulan gövde, cam kubbe, kızaklar; kabin düz plakalar (`hub/cockpit.ts`) |
| Telsiz cızırtısı, dalış kıyafeti nefesi, gövde gıcırtısı (kayıt), CC0 | Prolog | Kodla üretilen sesler (`audio/synth.ts`): filtrelenmiş beyaz gürültü, testere dişi |
| Dalış kıyafeti başlığı kenarı / cam çizik dokusu | Prolog (taban) | CSS katmanı (radyal geçiş + buğu animasyonu) |
| Birinci şahıs kollar/eller (iskeletli, CC0; ör. Quaternius ya da Kenney karakter paketinden el) | Her an (bilek cihazı, panele uzanma, fener) | Kodla kurulan kutu-silindir kollar ve eldiven (`hub/viewmodel.ts`) |
