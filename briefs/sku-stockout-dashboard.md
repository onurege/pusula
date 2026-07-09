# Product Brief — SKU Stok Tükenme Dashboard'u

> Business Intake katmanının (Perri -> Patton/Cohn -> Wiegers -> Cagan) kısa prompt'tan ürettiği analiz edilmiş ürün tanımı.
> Bu belge İş-kapısı'nda kullanıcı onayına sunulur. Onaylanmadan teknik ekip başlamaz.

**Kısa prompt (kullanıcıdan):** "Projeyi analiz et, neler yapabildiğini anla ve elimizdeki veriler ile stok devir hızı yapılabilir mi raporla." Ek yanıt: "İnsanlar SKU'ların stoklarının ne zaman biteceğini ilk bakışta anlamalarını sağlayacak bir dashboard istiyorum. Bunlara sen karar ver. Miktar bazlı."
**Tarih:** 2026-07-06 · **Durum:** Onay bekliyor

---

## 1. Problem & Bağlam  *(PM — SCQA)*
- **Situation:** Enroute RAG projesi, veritabanı şemasını okuyup SQL çalıştırabilen ve rapor üretebilen bir çekirdeğe; MCP, REST API ve Next.js dashboard taşıyıcılarına sahip.
- **Complication:** Kullanıcıların SKU stoklarının ne zaman biteceğini ilk bakışta anlaması gerekiyor. Bu ihtiyaç yalnızca "stok devir hızı" değil, operasyonel olarak "tükenme riski" ve "kaç gün yeter" görünürlüğü istiyor.
- **Question:** Eldeki verilerle SKU bazında miktar bazlı stok tükenme dashboard'u ve stok devir hızı üretilebilir mi?
- **Answer (özet çözüm):** Teknik analiz, şemada SKU, mevcut stok miktarı ve tarihli çıkış/satış hareketi alanlarını arayacak. Bu alanlar varsa miktar bazlı "günlük ortalama tüketim", "kalan gün", "tahmini tükenme tarihi" ve "miktar bazlı stok devir hızı" hesaplanabilir. Ortalama stok geçmişi yoksa stok devir hızı sınırlı güvenle verilir; tükenme dashboard'u yine mevcut stok + tüketim hızıyla üretilebilir.

## 2. Hedef Kullanıcı / Persona  *(PO)*
Operasyon, satın alma, kategori ve depo ekipleri. Ana iş: SKU'ların ne kadar süre yeteceğini hızlıca görmek, kritik ürünleri öne almak ve satın alma/ikmal aksiyonunu önceliklendirmek.

## 3. İş Sonucu (Outcome) & Başarı Metriği  *(PM)*
- **Outcome:** Kullanıcılar riskli SKU'ları tablo okumadan, ilk ekranda fark eder ve ikmal aksiyonlarını daha erken başlatır.
- **North Star metrik:** Kritik stok riski taşıyan SKU'ların dashboard'da doğru risk bandıyla görünme oranı.
- **Destekleyici KPI'lar:** Kritik SKU tespit süresi, "veri yetersiz" SKU oranı, hesaplanabilir SKU oranı, dashboard yüklenme süresi, kullanıcıların filtreyle aksiyona ulaşma süresi.

## 4. Story Map  *(PO)*
```
Backbone (aktiviteler):  Veriyi eşleştir  ->  Riski hesapla  ->  Dashboard'da göster  ->  Aksiyona indir
  Görevler:              - SKU alanları       - Tüketim hızı      - Risk bantları         - Filtre/sıralama
                         - Stok miktarı       - Kalan gün         - Tükenme tarihi        - CSV/rapor çıktısı
                         - Çıkış hareketleri  - Veri güveni       - Veri yetersiz durumu  - Detay SQL izi
```

## 5. Kullanıcı Hikayeleri & Kabul Kriterleri  *(PO — Beck'in testine girdi)*
- **US-1** — Bir operasyon kullanıcısı olarak SKU'ların kalan stok gününü görmek istiyorum, çünkü hangi ürünlerin önce biteceğini hızlıca anlamam gerekiyor.
  - **Kabul:** Given SKU için mevcut stok ve son 90 günlük net çıkış miktarı hesaplanabiliyor / When dashboard açılır / Then SKU için kalan gün, tahmini tükenme tarihi ve risk bandı görünür.
- **US-2** — Bir satın alma kullanıcısı olarak kritik SKU'ları risk bandına göre sıralamak istiyorum, çünkü ikmal önceliğini belirlemem gerekiyor.
  - **Kabul:** Given birden fazla SKU hesaplanmıştır / When kullanıcı "kritik" filtresini seçer / Then en az kalan güne sahip SKU'lar önce listelenir.
- **US-3** — Bir veri sorumlusu olarak hesaplanamayan SKU'ları ayrı görmek istiyorum, çünkü eksik alanları veya yetersiz hareket geçmişini düzeltebilirim.
  - **Kabul:** Given SKU'da mevcut stok veya tüketim hareketi eksiktir / When dashboard hesaplama yapar / Then SKU "veri yetersiz" durumuyla ve eksik neden etiketiyle görünür.

## 6. Fonksiyonel-olmayan Gereksinimler  *(BA)*
- Performans: İlk MVP'de rapor sorguları mevcut read-only SQL sınırlarına uymalı; dashboard ilk yükleme hedefi p95 < 3 sn olmalı.
- Güvenlik: MSSQL tarafında sadece read-only kullanıcı ve mevcut sorgu koruması kullanılmalı; yazma yolu açılmamalı.
- Erişilebilirlik: Risk yalnızca renkle anlatılmamalı; metin etiketi ve sıralama kullanılmalı.
- Ölçeklenebilirlik: Hesaplama, SKU sayısı büyüdüğünde dönem/limit filtreleriyle çalışmalı; varsayılan görünüm kritik ve yaklaşan riskleri öne almalı.

## 7. Varsayımlar / Kısıtlar / Bağımlılıklar  *(BA)*
- **Varsayım:** SKU kimliği, mevcut stok miktarı ve tarihli stok çıkış/satış hareketi veritabanında bulunuyor veya şema açıklamalarından eşleştirilebiliyor.
- **Varsayım:** Miktar bazlı hesaplama kullanılacak; maliyet/COGS bazlı stok devir hızı bu tur kapsam dışı.
- **Kısıt:** MSSQL'e yazma yapılmayacak; rapor üretimi read-only SQL ile sınırlı kalacak.
- **Bağımlılık:** Gerçek yapılabilirlik kararı, schema snapshot'ta stok, ürün/SKU ve hareket tablolarının bulunmasına bağlı.
- **Seçilen hesap varsayımı:** Son 90 günlük net çıkış miktarı / 90 = günlük ortalama tüketim. Kalan gün = mevcut kullanılabilir stok / günlük ortalama tüketim. Tükenme tarihi = rapor tarihi + kalan gün. Miktar bazlı stok devir hızı = dönem net çıkış miktarı / dönem ortalama stok miktarı.
- **Belirsizlik:** Ortalama stok miktarı için günlük stok snapshot'ı veya dönem başı/dönem sonu stok üretilemiyorsa, stok devir hızı "tam kanıtlanamadı" olarak raporlanmalı; tükenme tahmini mevcut stok + tüketim hızıyla devam edebilir.

## 8. Önceliklendirme  *(PO — MoSCoW)*
- **Must:** SKU bazlı mevcut stok, son 90 günlük tüketim, kalan gün, tahmini tükenme tarihi, risk bandı, veri yetersiz nedeni.
- **Should:** Depo/lokasyon kırılımı, kategori/marka filtreleri, 30/60/90 günlük pencere seçimi.
- **Could:** CSV dışa aktarım, SKU detayında kullanılan SQL ve hareket özeti, yeniden çalıştırma aksiyonu.
- **Won't (bu tur):** MSSQL'e yazma, otomatik satın alma emri, maliyet bazlı COGS hesaplama, auth/audit genişletmesi.
- **MVP çekirdeği:** Read-only SQL ile eldeki veriden SKU bazında "ne zaman biter?" listesi ve risk öncelikli dashboard.

## 9. Discovery Log  *(soru disiplini çıktısı)*
| # | Soru | Kime | Cevap | Karar |
|---|---|---|---|---|
| 1 | Stok devir hızı raporu hangi iş kararını destekleyecek? | Kullanıcı | İnsanlar SKU stoklarının ne zaman biteceğini ilk bakışta anlamalı. | Dashboard odağı "tükenme riski" olarak çerçevelendi. |
| 2 | İlk raporda hangi dönem ve kırılımlar yer almalı? | Kullanıcı | Bunlara Atlas karar versin. | Varsayılan: SKU bazlı MVP, 90 günlük tüketim penceresi, opsiyonel depo/kategori kırılımları. |
| 3 | Formül maliyet bazlı mı miktar bazlı mı? | Kullanıcı | Miktar bazlı. | Miktar bazlı gün/kalan stok ve stok devir formülü seçildi. |

## 10. Değer / Risk Değerlendirmesi  *(Cagan — 4 büyük risk)*
- **Değer:** Yüksek; kullanıcıların ilk bakışta aksiyon önceliği alması doğrudan operasyonel karar kalitesini artırır.
- **Kullanılabilirlik:** Orta-yüksek; risk bandı, kalan gün ve tükenme tarihi doğru görsel hiyerarşiyle anlaşılır olmalı.
- **Fizibilite:** Orta; mevcut veri şeması SKU, stok miktarı ve tarihli çıkış hareketlerini içeriyorsa yüksek; yalnızca statik stok varsa stok devir hızı ve tükenme tahmini sınırlı kalır.
- **İş yaşayabilirliği:** Yüksek; read-only kısıtlarla uyumlu ve mevcut RAG/report altyapısına doğal oturuyor.
- **Öneri:** Geliştir yönünde teknik analize geç; önce şemada gerekli alanların varlığını kanıtla, sonra MVP dashboard için hesaplanabilir metrikleri netleştir.
