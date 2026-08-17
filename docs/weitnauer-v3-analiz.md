# Weitnauer v3 — Değişiklik Analizi (kod haritası)

44 talebin (`docs/weitnauer-v3-talepler.md`) kod tabanına bağlanmış hali.
Her madde: **dosya:satır · mevcut durum · yapılacak iş**. Tenant: `wietnauer`.

## Mimari — kritik ön bilgiler (çoğu maddeyi etkiler)
- **V3 sayfalar server component**, `@/lib/api.ts` üzerinden Hono API'den veri çeker, **query param GEÇİRMEZ** → filtre yok. İstisna: **STOK** (`StokDistSelect.tsx` + `searchParams` + `lib/api.ts` `distId`) = **çalışan referans desen**, tüm dropdown/filtreler buna göre yapılmalı.
- **Cockpit** = `app/v3/cockpit/page.tsx` sadece `app/komuta/page.tsx`'i re-export eder → tüm cockpit UI'ı `komuta/page.tsx`'te; veri `packages/core/src/komuta.ts`.
- **Dist scope/izolasyon zaten var** (her core snapshot `distId`/`allowedDistKods` + `inScope`; `makeV3Handler` `?distId=` geçiriyor). Eksik olan: (a) snapshot'ın dropdown için **dist listesi** döndürmemesi, (b) sayfada **UI/searchParams**, (c) `lib/api.ts`'te param.
- **"now" parametrik** (`now.ts` + `resolveNowAnchor`, NOW_MODE=max-invoice) ama **pencere genişliği sabit** — tüm fetcher'lar `DATEADD(day,-30,sqlNow())` gibi hard-code.

---

# 🧱 OMURGA (1) — ortak altyapı (çoğu madde buna bağlı, ÖNCE yapılmalı)

### md2 · Global filtre çubuğu (Bölge·Kanal·Ürün Grubu·Dönem) — **DEMO/statik**
`app/komuta/page.tsx:186-232` (`FilterBar`). Satır **199-203**: 5 chip tamamen statik `<span className="filter-chip">`, onClick/state YOK. Çalışan tek şeyler: Reel/ÖTV/Unit toggle'ları (206-228).
**Yapılacak:** 5 chip'i gerçek dropdown'a (client component) çevir → seçim URL query param'ına yaz (`StokDistSelect` deseni). Sonra `komuta/page.tsx` searchParams'tan oku → `getKomutaSnapshot` opts'a ekle (`komuta.ts:1857-1868` imzasında `bolge/kanal/urunGrubu/period` **YOK**) → ~12 fetcher SQL WHERE'ine filtre enjekte.

### md2,11,21,42,44 · Dönem seçimi (Son30g/MTD/YTD/Q1-Q3 + serbest tarih) — **YOK, sıfırdan**
Tüm fetcher'lar sabit gün penceresi: `komuta.ts:280-281,537-552` + `fetchPeriodScales:1037-1066`; V3: `wietnauer-satis.ts:148-158`, `wietnauer-stok.ts:16-17` (WINDOW_DAYS=90/180) vb. `getKomutaSnapshot` ve V3 imzalarında `period/dateFrom/dateTo` **YOK**.
**Yapılacak:** Tüm snapshot imzalarına `period:{from,to}` ekle; SQL'deki `-30` literalleri parametreye; cache key'e (`komuta.ts:1893-1899`) period ekle; MTD/YTD/Q1-Q3 preset'leri UI'da from/to'ya çevir.

### md6,7,16,26,34 · Birim TL ↔ Hacim (70cl) — **komuta'da GİZLİ + formül yanlış; V3'te YOK**
Komuta'da mekanizma var (`komuta.ts:233` `ValueUnit`, `unitValueExpr:988-1008`) ama:
- Hacim formülü `komuta.ts:1001` = `DBLLITRE/9.0` (Pernod 9LE). **md7 kararı:** `Σ(DBLMIKTAR × DBLLITRE)`, `DBLLITRE=cl/70`. `/9.0` grep ile 10+ yerde.
- Toggle wietnauer'da gizli: `tenant/configs/wietnauer.ts:42-47` `showInToggle:false`; `UnitToggle.tsx:30` `if(!showInToggle) return null`.
- **V3 snapshot'larda birim YOK** (`wietnauer-satis/marka/metrics` sadece TL).
**Yapılacak:** (a) wietnauer config `showInToggle:true`, `short:"70cl"`; (b) `komuta.ts` hacim ifadelerini tenant-parametrik (70cl doğrudan `DBLLITRE`), merkezileştir; (c) V3 snapshot'lara `unit` param + hacim hesabı.

### md2 · YoY dinamik — **VAR ama pencere sabit**
`komuta.ts:537-552` (bölge), `1286-1306` (heatmap), `1150-1154` (matrix), `1518-1520` (portfolio) — hep "son30g ↔ geçen yıl 30g" sabit.
**Yapılacak:** Dönem parametrik olunca (md2) YoY pencereleri `period.from-1yıl / to-1yıl` türetilsin — md2 ile aynı refactor.

### md3 · Reel TL (IAS29/TÜFE) — **komuta'da VAR; V3'te YOK**
Altyapı hazır: `data/inflation/tufe-tr.json`, `inflation.ts` (`getMultiplier`), `komuta.ts:1650 applyReelTL`, UI `page.tsx:206-213` + API `server.ts:841`. **V3 snapshot'larda `applyReelTL` çağrılmıyor.**
**Yapılacak:** Reel toggle'ı global bar'a taşı; her V3 snapshot'a `reelTL` + kendi value alanlarına deflasyon uygula. TÜFE json güncelliği kontrol (Mayıs 2025 tarihli).

### md19,20,42,43,44 · Dist filtresi (Tümü/Aktif/Pasif) — **dist-seçim kısmen; durum ayrımı YOK**
Her yerde `d.BYTDURUM=0` **hard-code** (pasif dist zaten dışlanıyor → "Tümü/Pasif" seçeneği yok). Dist seçimi sadece STOK'ta UI'lı.
**Yapılacak:** `d.BYTDURUM=0` literalini `distStatus` param'ına çevir; global bar'a Tümü/Aktif/Pasif; snapshot opts'a ekle.

### md16,17,18,29,30,36,37 · "Diğer" + dip toplam deseni — **çok kısıtlı VAR**
Sadece `komuta.ts` kanal-mix'te (`fetchChannelMonthly:755`, `fetchChannelByCustomerType:832`). Marka vb. sadece `.slice(0,N)` ile **kesip atıyor**, Diğer/dip yok.
**Yapılacak:** Yeniden kullanılabilir "Top-N + Diğer + dip toplam" yardımcısı (SQL rollup + UI `<tfoot>`); marka/matrix/heatmap/portföy panellerine uygula.

---

# ⚙️ SİSTEM (2)

### md1 · Refresh butonu → gece job — **VAR, tamam**
Gece 03:00 job (`server.ts:1121 refreshAllSnapshots` — komuta+8 V3+harita mirror) + boot warm + `NOW_MODE` bu oturumda eklendi. Buton: `global-refresh-button.tsx`.
**Yapılacak:** Sadece UI kararı — buton kaldırılacaksa `global-refresh-button` + `komuta/page.tsx:161` "↻ Yenile" linkini kaldır. Altyapı hazır.

### md4 · AI "Bu sabahın yorumu" — **VAR ama GEMINI, Claude değil**
`komuta.ts:3` `import {generate} from "./gemini.js"`; `:1604 generate(...)` briefi üretir; gece job'ında snapshot'la cache'lenir (davranış doğru, model yanlış). UI `page.tsx:73-88 AiInsightBar`, fallback `:84` "Gemini servisi…".
**Yapılacak:** `generate` çağrısını Claude'a (Anthropic SDK, yeni `claude.ts`) çevir; `analyzeRegionAnomaly` (`server.ts:988`, `finance-agent.ts`) da Gemini → değerlendir. Fallback metni güncelle.

### md5,10 · Yetkilendirme — **veri-scope VAR; panel-görünürlük + admin panel YOK**
Sağlam veri-scope temeli: `auth.ts` (`authenticateUser`, `TenantScope`, `resolveTenantScope` sunucu-otoriter, `distFilterClause`). Ama: **panel/ekran-bazlı görünürlük altyapısı YOK**, **admin panel YOK** (`app/admin` yok), şehir/nokta-scope yok (dist üzerinden dolaylı).
**Yapılacak (sıfırdan):** (a) rol→ekran/panel görünürlük matrisi (config/tablo + JWT claim); (b) admin panel (`app/admin/*` — kullanıcı/rol/scope/panel yönetimi); (c) şehir/nokta scope'u `TenantScope`'a ekle.

---

# 🖥️ COCKPIT (3) — `komuta/page.tsx` + `komuta.ts`

| Madde | Dosya:satır | Durum → Yapılacak |
|---|---|---|
| **md6** KPI ilk sıra Hacim | `komuta.ts:416-501` / `page.tsx:259-278` | TL modunda Hacim 1. değil → Hacim'i sabit index 0'a al, accent eşlemesi (`:241`) gözden geçir |
| **md8** Harita sabit | `TurkeyMapPolygon.tsx:92-98` | **ZATEN YAPILMIŞ** (scrollZoom/dragPan false) → sadece doğrula |
| **md14** Kanal Mix | `ChannelMixChart.tsx:77,80` / `page.tsx:96` / `komuta.ts:725` | "Son 12 Ay" hardcoded + pie yok → başlık temizle, dönem filtresine bağla, **pie ekle** (legacy donut `page.tsx:685-750` referans) |
| **md15** Müşteri Tipi | `page.tsx:110` / `komuta.ts:795` | Başlıkta "Son 12 Ay", ek grup (saha 8) doğru → başlık temizle + dönem bağla |
| **md16** Ürün Grubu×Dönem | `page.tsx:1111,1124` / `komuta.ts:1097-1156` | Başlıkta "Net Ciro Karş.", Diğer/dip yok, unit var → başlık kısalt + Diğer satırı + `<tfoot>` dip toplam |
| **md17** Heatmap Top8+Diğer | `komuta.ts:1256-1257` (grup TOP 6) | Grup 6, Diğer yok → grup TOP 8 + kalan "Diğer" sütun (hücre CASE `:1288-1292`) |
| **md18** Portföy Top8+Diğer | `komuta.ts:1476` (TOP 10) / `page.tsx:1390` | Top 10, Diğer yok → TOP 8 + Diğer (+dip); meta "Top 8 + Diğer" |
| **md34** Müşteri Tipi×Marka | — | **YOK, yeni geliştirme** → yeni `komuta.ts` fetcher (ek grup saha8 × marka, stratejik+Others, tarih, unit) + snapshot alanı + yeni panel + Hacim/Ciro toggle |

---

# 🗺️ HARİTA (4) — `map-page-body.tsx` + `map-filters.tsx` + `map.ts`

### md9 · Arama: ünvan + müşteri takip kodu + müşteri kodu
`map-filters.tsx:44-47` sadece `unvan`+`kisaAd` eşleştiriyor. `map.ts:1170-1209` SELECT'te `TXTKOD`/takip kodu **yok**, `map_customers`'a yazılmıyor.
**Yapılacak:** (1) `map.ts:1170` SELECT'e `m.TXTKOD` + takip kodu; (2) `map_customers` şema + `MapCustomer` type; (3) `map-filters.tsx:44-47` predikatına `kod/takipKod .includes`; (4) placeholder `:114`. *(takip kodunun gerçek kolon adı DB'de doğrulanmalı)*

### md11 · Üstte dönem filtresi → satış-aktivite filtresini değiştirir
`map-filters.tsx:178-188` "Satış aktivitesi (30g)" with/without, pencere **sabit 30g** (`map.ts:1184` sync anında hesap). Üstte dönem filtresi YOK.
**Yapılacak:** Dönem seçici ekle; `has_sales`'i dönemden bağımsızlaştır — sync'te çoklu pencere kolonu (`has_sales_30/90/ytd`) ya da runtime türetme.

### md19 · Aktif müşteri denetimi (BYTDURUM) — **DATA BUG, 23.738 fazla nokta**
🔴 `map.ts:1197-1209` ana müşteri SELECT'i: `WHERE m.DBLKOORDINATX>0 AND ...` — **`m.BYTDURUM` ve `d.BYTDURUM` filtresi YOK.** Pasif müşteriler + pasif dist altındakiler haritaya aktif giriyor. (Facet sorgusu `:1218-1223` `d.BYTDURUM=0` uyguluyor — tutarsız.)
**Yapılacak:** `:1208` WHERE'e `AND m.BYTDURUM=0 AND d.BYTDURUM=0` (kilitli karar). `map_customers` resync gerekir.

---

# 👤 MÜŞTERİ KARTI (5) — `customer-modal.tsx` + `map.ts`

### md12 · Risk skoru nasıl hesaplanıyor göster
Hesap: `map.ts:383-460 computeCustomerRiskScore`, ağırlıklar `:245-250` (momentum .40/behavioral .30/payment .20/engagement .10), tier `:365`. Kart `customer-modal.tsx:692-753 RiskScoreCard` bileşen barlarını gösteriyor ama **formülü/ağırlıkları açık göstermiyor**.
**Yapılacak:** Karta `InfoHint`/açılır açıklama (ağırlıklar, her bileşenin girdileri, tier eşikleri). Referans: `komuta/InfoHint.tsx`.

### md13 · Foresight alanları → ikon-hikâye / anlaşılır isim
`customer-modal.tsx:872-898` 4 teknik etiket: "Risk sinyali / 14 günde olay / Düşmüş kategori / Segment fırsatı".
**Yapılacak:** `label` prop'larını (`:876,882,888,894`) anlaşılır isme çevir (ör. "Sipariş kesilen ürünler / Yaklaşan fırsat / Bıraktığı kategoriler / Benzer müşterilerin aldığı") + ikon. Veri yapısı aynı.

---

# 💰 SATIŞ (6) — `wietnauer-satis.ts` + `satis-performans/page.tsx`

- **md20** dist Tümü/Aktif/Pasif: snapshot dist listesi + `TBLDIST.BYTDURUM` yok (`fetchDistributorLeaderboard:137-174` sadece TBLMSDFATURA). → snapshot'a `distributors`+`durum`, page dropdown, `lib/api.ts` param.
- **md25** Distribütör leaderboard **KALDIR**: `page.tsx:97 <DistLeaderboardPanel>` sil. ⚠️ `snap.distLeaderboard` verisini **silme** — md26 KPI'ı ona bağlı.
- **md26** Top dist cirosu → Hacim: `SatisDistRow:45-62` sadece `ciro`. → fetcher'a `Σ(DBLMIKTAR×DBLLITRE)` (TBLMSDBELGEDETAY+TBLURUN join gerekir), KPI'ı unit'e bağla.
- **md27** Nokta başına satış hızı: `DropSizePanel` dist-bazlı (md27 değil). → snapshot'a `noktaBasinaSatisHizi=toplamCiro/aktifNokta`, üst şeride KPI tile.
- **md21** tarih+birim → omurga.

---

# 🏷️ MARKA (7) — `wietnauer-marka.ts` + `marka-sku/page.tsx`

- **md28** Excel dökümü: **YOK** → client "Excel indir" butonu + export endpoint (snapshot→xlsx).
- **md29** Top10 SKU + "Diğer": `aggregateTopSkus:294-331 .slice(0,10)`, `TopSkusPanel.tsx:46`. → core'da top10-dışı toplamı `topSkusOther`, panele Diğer+dip.
- **md30/md37** Penetrasyon + "Diğer"/dip: `aggregateBrandPenetration:405-435 .slice(0,20)`, `BrandPenetrationPanel.tsx:21 .slice(0,12)`. → gösterilmeyenleri Diğer'de topla + dip.
- **md31** 30g/90g/YTD karşılaştırma **KALDIR**: sil → `page.tsx:9,115`; `BrandWindowCompare.tsx`; core `fetchBrand3MonthYtdRaw:656-698`+`aggregate:701-739`+snapshot `windowComparison:119,846,856`+`RawMarkaBundle:756`+`Promise.all:795`.
- **md36** Portföy other+dip: `aggregateBrandPortfolio:220 .slice(0,20)`, `BrandPortfolioPanel.tsx:16 .slice(0,15)`. → Diğer + dip.

---

# 🧩 SEGMENT (8) — `wietnauer-segment.ts` + `musteri-segmentasyon/page.tsx`

- **md32** Cirosal segment **KALDIR**: sil → `page.tsx:11-14,82`; `CirosalSegmentPanel.tsx`; core `fetchCirosalSegmentRaw:382-442`+`aggregate:445-465`+snapshot `cirosal:101,685,695`+`RawSegmentBundle:620`+`Promise.all:651`.
- **md24** 3 kırılım (müşteri grup + ek grup): cirosal yerine 3. panel. `EkSahaPanel`=TBLMUSTERIGRUP, `EkGrupPanel`=ek grup; gerçek **Ek Saha 8** (TBLMUSTERIEKSAHA×TBLEKSAHASECENEK) ayrı fetcher olarak eklenmeli. Layout `seg-triple-grid:96-107` 3 sütun hazır.
- **md33** 🔴 "Tanımlı ek grup yok" **BUG**: `fetchEkGrupSegmentRaw:264-322`, m2m join `:270-277` (`bg.LNGGRUPKOD=CAST(eg.TXTKOD AS INT)`, `m.LNGKOD=bg.LNGMUSTERIKOD`) 0 satır dönüyor (config `wietnauer.ts:81 customerEkGrupLink:"m2m"`). → `TBLSBMUSTERIEKGRUPBAGLANTI` kolon adları DB'de doğrulanıp join düzeltilmeli.
- **md35** Ek grup/nokta harcanan iskonto: `EkGrupSegmentRow:63-75` iskonto yok, `grup_ciro:289-301` sadece net. → `SUM(f.DBLISKONTOTUTARI)` ekle, `aggregate:335-363` topla, panele kolon.

---

# 📦 STOK (9) — `wietnauer-stok.ts` + `stok-tukenme/page.tsx`

- **md38** Tüm SKU (pagination): `wietnauer-stok.ts:865 .slice(0,200)`; ekran sadece `topRows` gösteriyor. → slice yükselt/kaldır, tam SKU tablosu + client pagination.
- **md39** "Yoldaki miktar" KPI + "Yolda" kolonu **KALDIR**: `page.tsx:98-103` KpiTile; `:418` th + `:456` td. (core `openOrderQty` ROP hesabında kalabilir `:466-472`.)
- **md40** Marka stok riski tüm markalar: `buildBrandSummary:763 .slice(0,20)` → kaldır.
- **md42** Dist + tarih aralığı: dist VAR (`StokDistSelect`); tarih YOK (`WINDOW_DAYS=90/180 :16-17`). → tarih aralığını options+SQL'e parametreleştir, page kontrolü, `lib/api.ts:812` date param.

---

# 🚶 SAHA (10) — `wietnauer-saha.ts`

- **md41** Temsilci müşteri kolonu → aktif müşteri: `RepPerformancePanel.tsx:43,58 uniqueMusteri` = **ziyaret edilen** (`fetchRepPerformance:440,464 COUNT(DISTINCT LNGMUSTERIKOD)`). → temsilcinin son30g **fatura kesen** distinct müşterisi (TBLMSDFATURA join, `LNGSTKOD`), yeni alan `aktifMusteri`, panel kolonu.

---

# ⚠️ RİSK (11) — `wietnauer-aktivasyon.ts` + `aktivasyon-risk/page.tsx`

- **md43** Dist filtresi: core `getWietnauerAktivasyonSnapshot:570-626` distId **zaten destekliyor**, ama snapshot dist listesi döndürmüyor; `lib/api.ts:800` param yok. → snapshot'a `distributors` (`fetchActiveCustomers90dRaw:174`'ten türet), page searchParams+dropdown, `lib/api.ts` distId.

---

# 🎯 İSKONTO (12) — `wietnauer-iskonto.ts` + `ticari-yatirim/page.tsx`

- **md44** Tarih aralığı + dist filtresi: `ticari-yatirim/page.tsx` parametresiz. Desen = STOK md42 ile birebir (dropdown + tarih parametreleştirme).

---

# 📊 YÖNETİM (13) — `wietnauer-metrics.ts` + `yonetim-kurulu/page.tsx`

- **md22** Top Müşteri → Top Distribütör analizi: `page.tsx:118 <TopCustomersPanel>`, core `fetchTopCustomers:98-128`+`TopCustomer:32-45`+snapshot `topCustomers:78,361-373`. → yeni `fetchTopDistributors` (TBLDIST GROUP BY, ciro DESC), snapshot `topDistributors`, panel dağıtıcı tablosuna dönüştür, `top10Pay` türevi `:60-62` güncelle.
- **md23** Top dist alanı: aktif müşteri + **FKMS**: → yeni tipe `aktifMusteriSayi` (dist altı BYTDURUM=0 distinct müşteri) + `fkms` (`COUNT(DISTINCT f.LNGMUSTERIKOD)` fatura kesen), panele kolonlar.

---

# 📋 Öncelik & sıra

**Faz 0 — Data-correctness bug'ları (küçük, yüksek etki, omurgadan bağımsız)**
- 🔴 **md19** harita BYTDURUM (`map.ts:1208`) — yanlış nokta sayısı
- 🔴 **md33** segment ek grup join (`wietnauer-segment.ts:270-277`) — boş panel
- **md7** 70cl formülü doğrulama (`komuta.ts:1001`)

**Faz 1 — Hızlı kazanımlar (tek dosya, string/slice/kaldır)**
md6, md8(doğrula), md14/15/16 başlık temizliği, md17, md18, md40, md13, md25/md31/md32 (kaldır)

**Faz 2 — OMURGA (bloklayıcı — çoğu maddeyi açar)**
md2 global filtre bar + dönem seçimi + serbest tarih → YoY dinamik → birim (70cl) V3'e → Reel TL V3'e → dist Tümü/Aktif/Pasif → "Diğer"+dip toplam yardımcısı

**Faz 3 — Omurgaya bağlı ekran işleri**
md26, md27, md21, md29, md30, md34, md35, md36, md37, md38, md39, md41, md42, md43, md44, md22, md23, md9, md11, md12, md24, md28(excel)

**Faz 4 — Büyük altyapı**
md4 (Gemini→Claude), md5/md10 (admin panel + panel-bazlı görünürlük — sıfırdan)
