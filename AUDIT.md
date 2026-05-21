# Komuta Köprüsü · Bölge YoY Denetim Raporu

- **Tarih (denetim)**: 2026-05-12T10:58:28Z
- **Snapshot generatedAt**: 2026-05-12T10:56:25.412Z (refresh=0 cache hit)
- **API durumu**: localhost:8080/api/komuta → HTTP 200, OK
- **VPN/DB**: bltDBTest.unicloud.local çözüldü, MSSQL bağlanıldı
- **Mod**: nominal-gross (Reel TL = false, ÖTV-net = false)
- **DB sunucu saati**: 2026-05-12 13:58:28 (TR)
- **Karşılaştırma**: 4 sayısal alan (ciro, ciroPrev, deltaPct) + 2 distSayisi semantiği

## Özet

| Sonuç | Sayı |
|---|---|
| Toplam denetlenen bölge | 9 |
| FAIL (>%1 sapma) | 0 |
| WARN (%0.1–%1 sapma) | 0 |
| OK (<%0.1 sapma) | 9 |

**Hesap motoru OK** — bağımsız sorgu ile dashboard'un her 9 bölgesindeki 3 sayısal alan (ciro, ciroPrev, deltaPct) birebir aynı çıktı (0.0000% sapma).

**Ancak iki ciddi yapısal bulgu var** (hesap doğru ama gösterge yanıltıcı):

1. **`distSayisi` regions payload'unda YOK.** Frontend `row.distSayisi` çağırıyor → undefined render.
2. **YoY uniform -%75 paterni, gerçek demand collapse değil, veri cutoff'tan kaynaklı.** "Son 30 gün" penceresinin neredeyse tamamı (26 takvim günü) DB'de boş — 17 Nisan 2026'dan sonra yüklenmiş veri yok (29 Nisan'da 1, 11 Mayıs'ta 1 fatura dışında). "Önceki" penceresi ise tam 26 işgünü içeriyor. Bu **apples-to-oranges** kıyas.

## Bulgular

### FAIL · Yapısal #1 — `regions[i].distSayisi` field eksik

| Alan | Göstergedeki | Bağımsız | Sapma |
|---|---|---|---|
| distSayisi (KomutaRegionRow) | **field yok** | EGE=9, ORTA ANADOLU=8, AKDENIZ=7, IST-AVRUPA=3, GÜNEY DOGU ANADOLU=5, IST-ASYA=2, MARMARA=4, DOGU KARADENIZ=4, KIBRIS=1 | N/A — alan yok |

**Sebep**: `packages/core/src/komuta.ts:356–404` içindeki `fetchRegions()` sorgusu sadece `bolge, ciro, ciroPrev` döndürüyor; `distSayisi` SELECT'te yok. Tip tanımı `KomutaRegionRow` (komuta.ts:98–103) zaten `distSayisi` içermiyor.

Frontend `apps/dashboard/app/komuta/page.tsx:1071` şunu render ediyor:

```tsx
{row.bolge} <span className="reg-sub">{row.distSayisi} distribütör</span>
```

`row.distSayisi` her zaman `undefined` → ekrana **"undefined distribütör"** veya boş yazıyor. Heatmap satırı (`KomutaHeatmapRow.distSayisi`, komuta.ts:145) doğru çalışıyor — orada distSayisi var. Ama bölgeler listesi farklı bir tipten besleniyor.

**Onarım** (önerilen):

1. `packages/core/src/komuta.ts:356` — `fetchRegions()` sorgusuna `distSayisi` ekle:
   - Aktif distribütör için: `LEFT JOIN (SELECT TXTGRUP, COUNT(*) AS distSayisi FROM dbo.TBLDIST WHERE BYTDURUM = 0 GROUP BY TXTGRUP) ad ON ad.TXTGRUP = dg.TXTKOD`
   - Veya son 30g satışı olan distribütör (eğer "aktif" derken son trafiği kastediliyorsa).
2. `packages/core/src/komuta.ts:98–103` — `KomutaRegionRow` tipine `distSayisi: number` ekle.
3. `packages/core/src/komuta.ts:393–402` — map içinde `distSayisi: Number(r.distSayisi ?? 0)` döndür.

Hangi semantik istenirse istensin (aktif vs. satışlı), bağımsız sorgu sonuçlarımda **bu 9 bölge için ikisi aynı çıktı** — yani EGE'de 9 aktif dist var, hepsinin son 30g'de satışı VAR (boş gibi görünen pencerede bile). Yani semantik seçimi bu veri seti için fark yaratmıyor; gelecekte uyumsuz olabilir.

---

### WARN · Yapısal #2 — YoY uniform -%75 paterni, veri cutoff artefaktı

| Bölge | son ciro | önceki ciro | snapshot YoY | gün-normalize YoY |
|---|---:|---:|---:|---:|
| EGE | ₺135.54 M | ₺454.01 M | **-70.1%** | **+55.2%** |
| ORTA ANADOLU | ₺119.92 M | ₺562.71 M | -78.7% | +10.8% |
| AKDENIZ | ₺98.37 M | ₺367.15 M | -73.2% | +39.3% |
| IST-AVRUPA | ₺84.87 M | ₺336.18 M | **-74.8%** | **+31.3%** |
| GÜNEY DOGU ANADOLU | ₺58.73 M | ₺239.34 M | -75.5% | +27.6% |
| IST-ASYA | ₺46.34 M | ₺218.98 M | -78.8% | +10.0% |
| MARMARA | ₺33.19 M | ₺129.38 M | -74.3% | +33.4% |
| DOGU KARADENIZ | ₺31.55 M | ₺137.00 M | -77.0% | +19.8% |
| KIBRIS | ₺15.63 M | ₺73.56 M | -78.7% | +10.5% |

**Hesap motoru doğru** — bağımsız sorgu birebir aynı çıkıyor. Ama "son 30 gün" penceresinin tabanı:

```
son  (2026-04-12 → 2026-05-12, 30 gün): yalnızca 7 günde fatura,
     ETKİN ~5 işgünü (13–17 Nisan), 17 Nisan'dan sonra:
       29 Nisan: 1 fatura (₺100)
       11 Mayıs: 1 fatura (₺99)
     Toplam: ₺624 M

önceki (2025-04-12 → 2025-05-12): 26 etkin işgünü dolu, toplam ₺2,518 M.
```

Yani 5 günü 26 güne kıyaslıyoruz. Composite YoY -%75.22; **gün-normalize edilince +%23 composite YoY** (sağlıklı büyüme).

**IST-AVRUPA özelinde ham doğrulama** (talep edilen):
- Son pencere: 1.987 fatura satırı, ₺84.87M, **trh aralığı 13–16 Nisan 2026** (4 işgünü).
- Önceki pencere: 10.031 fatura satırı, ₺336.18M, **trh aralığı 14 Nisan – 12 Mayıs 2025** (26 işgünü).
- Snapshot deltaPct: -74.7551%. Bağımsız hesap: aynı. **Hesap doğru.**
- Gerçek YoY (gün-normalize): +%31.3 — yani IST-AVRUPA aslında BÜYÜYOR, çöküyor değil.

**Sebep**: TBLMSDFATURA içine 17 Nisan 2026'dan sonra düzenli veri yüklenmemiş. 18–28 Nisan ve 1–10 Mayıs günleri tamamen boş. Bu, bir veri yükleme/ETL pipeline cutoff'u (ya da gerçekten faturalanmamış dönem — ama bu durumda da gösterge "veri yok" demeli).

**Onarım önerileri**:

1. **Sentinel kontrol**: `fetchRegions` çıktısında "son" pencerenin işgün sayısını kontrol et; ≤ önceki/2 ise UI'da uyarı bandı bas: *"Son 30 günde yalnızca N işgünü veri var. YoY yanıltıcı olabilir."*
2. **Stale-data badge**: `MAX(TRHISLEMTARIHI)` < `GETDATE() - 3 day` ise "Veri son güncelleme: X gün önce" rozeti.
3. **Day-of-week eşleştirmesi (önerilen kalıcı çözüm)**: "Önceki" pencereyi de aynı sayıda işgünüyle hizala (ör. `son` ile aynı sayıda en güncel işgünüyle başla, geriye 365 gün ileri kaydır).
4. **Snapshot'a metadata**: `regions` payload'ına `windowDays: { son: 5, onceki: 26 }` benzeri alan ekle ki frontend bunu görsel olarak gösterebilsin.

---

## Edge case kontrolleri

### `ciroPrev = 0` bölgeleri
Snapshot'ta hiçbir bölgenin `ciroPrev = 0`'ı yok. Tüm 9 bölgenin geçen yıl pencerede satışı vardı (en küçük: KIBRIS = ₺73.56M).

### `deltaPct = null` bölgeleri
Hiçbiri null değil — hepsi `ciroPrev > 0`. Branş test edilemedi, ama formül `ciroPrev > 0 ? ... : null` (komuta.ts:396) doğru.

### IST-AVRUPA -%75 doğrulaması
Snapshot: ciro=₺84,869,097.58, ciroPrev=₺336,182,761.68, deltaPct=-74.7551%. Bağımsız sorgu: aynı (0% sapma). **Hesap doğru**, ham rakamlar yukarıda. Ancak son penceresinde sadece 13–16 Nisan 2026 var (4 işgünü), önceki penceresinde 14 Nisan – 12 Mayıs 2025 (26 işgünü). Demand collapse DEĞİL — **veri eksikliği**.

### Haritaya yerleşmeyen bölgeler
Tüm 9 bölge `findRegionPosition` ile koordinat alıyor:
- EGE → `EGE` (115, 180)
- ORTA ANADOLU → `ORTA ANADOLU` (300, 160)
- AKDENIZ → `AKDENIZ` (235, 220)
- IST-AVRUPA → `IST-AVRUPA` (95, 100)
- GÜNEY DOGU ANADOLU → "GUNEY DOGU ANADOLU" (425, 215) — diacritic strip OK
- IST-ASYA → `IST-ASYA` (155, 110)
- MARMARA (ISTANBUL DISI) → tam eşleşme (220, 130)
- DOGU KARADENIZ → `DOGU KARADENIZ` (450, 105)
- KIBRIS → `KIBRIS` (310, 285)

**Hiçbir bölge dışarıda kalmıyor.** Ama 95/100 (IST-AVRUPA) ile 120/100 (ISTANBUL) ve 155/110 (IST-ASYA/ISTANBUL ANADOLU) yakın koordinatlar — UI render'ında stagger zorlanırsa overlap olabilir; bu UI testi sırasında bakılmalı.

### `distSayisi` semantiği
Kod (Heatmap satırında, komuta.ts:660): `COUNT(DISTINCT dg.distKod)` — `dist_grup` CTE'sinin `BYTDURUM=0` filtreli **aktif dist'leri** üzerinden. JOIN'de TBLMSDFATURA -30g filtresi var, yani gerçekte **"son 30 gün'de satışı olan aktif distribütör sayısı"**. Bu veri setinde bu sayı, sadece BYTDURUM=0 ile aynı çıkıyor (her aktif distin son 30g'de en az 1 satışı var) — gelecekte sapacak. Regions payload'ında bu alan YOK (Bulgu #1).

### TR diacritic normalize
`normalizeForLookup` (page.tsx:375) Türkçe karakter strip ediyor: İ→I, Ş→S, Ç→C, Ğ→G, Ü→U, Ö→O. **"GÜNEY DOGU ANADOLU"** → `"GUNEY DOGU ANADOLU"` → REGION_POSITIONS'ta bu anahtar var → OK. Ancak DB'den gelen `"GÜNEY"` (büyük Ü) `trUpper` adımında üst karaktere zaten dönüşmüş halde geliyor. Çift büyük dönüşüm sorun yaratmıyor.

Ama dikkat: kodda `"İstanbul" → "İSTANBUL" → "ISTANBUL"` zinciri var; DB'de zaten `"IST-AVRUPA"` formatında. Snapshot'taki **`"IST-AVRUPA"` ile `REGION_POSITIONS["IST-AVRUPA"]` eşleşmesi yapılabiliyor** çünkü literal anahtar tabloda mevcut. OK.

---

## OK bölgeler (özet)

9/9 bölgenin 3 sayısal alanı (ciro, ciroPrev, deltaPct) bağımsız sorguyla **birebir aynı**: EGE, ORTA ANADOLU, AKDENIZ, IST-AVRUPA, GÜNEY DOGU ANADOLU, IST-ASYA, MARMARA (ISTANBUL DISI), DOGU KARADENIZ, KIBRIS.

## Yöntem Notları

- **Bağımsız sorgu farkları** (kasıtlı):
  - Driver tablo TBLDISTGRUP (LEFT JOIN ile her grubu görür), `fetchRegions`'taki gibi `son` CTE değil. Sıfır cirolu grup olsaydı yine yakalanırdı.
  - distSayisi'ni iki ayrı CTE ile (aktif + satışlı) hesapladım, semantik gap'i ortaya çıkarmak için.
  - Pencere sınırları (DATEADD day -30, -365, -395) `fetchRegions` ile aynı — bilerek; eğer pencere mantığında bug varsa "ben de aynısını yapıp aynı yanlışı bulurum" değil, **aynı sınırda farklı join shape ile farklı sonuç çıkması bug'ı bulurdu**. Çıkmadı → window mantığı OK.
- **Filtreler kullanıldı**: `f.BYTTUR=0 AND f.BYTDURUM=0 AND d.BYTDURUM=0`. Snapshot ile aynı.
- **Test edilemeyen alanlar**: 
  - `deltaPct = null` branşı (hiçbir bölge ciroPrev=0 değil).
  - `ciroPrev = 0` davranışı (yine veri setinde örnek yok).
  - Geçen yıl tamamen aynı 5 işgünlük penceresine kırparsak ne çıkar (önerilen onarım test'inin temeli).

## Aksiyon Önerileri

1. **(P0, kullanıcı yanıltıcı)** Veri cutoff sorununu çöz — ya ETL pipeline'ı 11 Mayıs'a kadar getirilmeli, ya da dashboard "son güncelleme tarihi" rozeti göstermeli (`MAX(TRHISLEMTARIHI)`).
2. **(P0, görünür bug)** `KomutaRegionRow` tipine `distSayisi` ekle ve `fetchRegions` SQL'ine COUNT eklesin. Frontend'in `row.distSayisi` çağrısı şu an undefined döküyor.
3. **(P1)** YoY hesabını işgün-eşleştirmeli yap: "önceki" penceresini "son" penceresindeki gerçek veri var olan günlere hizala (DOW + tarih kaydırma). Ya da en azından `windowDays` metadata'sını payload'a ekle, frontend "5 gün / 26 gün karşılaştırılıyor" uyarısı bassın.
4. **(P2)** REGION_POSITIONS'ta IST-AVRUPA / ISTANBUL / IST-ASYA koordinatları çok yakın; UI overlay'de bumping politikası gözden geçirilmeli (yalnızca görsel, hesap etkilemez).
5. **(P2)** `KomutaHeatmapRow.distSayisi` semantiği "son 30g satışı olan aktif dist" demek; bu hesap doğru ama isim "distSayisi" yanıltıcı — `aktifSatisYapanDist` gibi rename veya tooltip ekle.

## Ek dosyalar

- `scripts/audit-regions-yoy.ts` — bağımsız doğrulama sorgusu (bu denetimde yazıldı, korumalı SELECT)
- `scripts/audit-regions-windows.ts` — pencere boşluk analizi (bu denetimde yazıldı, SELECT)
