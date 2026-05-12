# Komuta Köprüsü — Tasarım Rationale

*UNIQUE AI Reports · Pernod Ricard Türkiye Pilotu*
*Mockup versiyonu: v3 · 30 Nisan 2026*

---

## 1. Amaç

### Bu ekran kimin için?

**Birincil kullanıcı**: PR Türkiye **CEO veya Satış Direktörü**. Maslak ofisinde sabah laptop'u açıp 30 saniyede "bugün nerede duruyoruz, neye dikkat etmeliyim" sorusuna cevap arayan kişi.

**İkincil kullanıcı**: PR Group HQ (Paris) — Türkiye yönetiminin aylık board sunumunda hammadde olarak kullanacağı görsel.

**Kim için DEĞİL**: Saha temsilcisi, bölge müdürü, distribütör operatörü. Onların kendi radarları var (Sahacı Cep Konsolu, Bölge Drilldown, Outlet Mikroskobu vs). Komuta Köprüsü mikro-yönetim için değil, **stratejik nabız tutma için**.

### Cevaplanmayı amaçladığımız 3 ana soru

1. **"Bugün nasıl gidiyoruz?"** — bu ay ciro, hedefe yakınlık, premium mix
2. **"Geçmişe göre durum ne?"** — geçen yıl, 2 yıl, son aylar karşılaştırması
3. **"Önümüzde ne var?"** — yaklaşan takvim olayları, anomaliler, aksiyon önerileri

Ekran yukarıdan aşağı doğru bu üç soru ekseninde okunuyor.

---

## 2. Tasarım Felsefesi

### "Salesforce'a karşı" değil "Salesforce'tan etkileyici"

PR Group globalde Salesforce Consumer Goods Cloud'a (CGC) geçiyor. PR Türkiye Univera Panorama kullanıyor. Pozisyonumuz:

> *"Salesforce'un yapamadığı şeyleri" satmıyoruz. Salesforce'un dashboard'larının **en etkileyici versiyonunu Türkiye spirits piyasası için yeniden tasarlıyoruz** — Türkçe, takvim-aware, satış noktası bazlı, premium mix odaklı, Univera Panorama veri kaynağıyla beslenen.*

Bu yüzden mockup'ta Salesforce Sales Manager Home + CRM Analytics + Tableau Pulse referansları gizlice içeride duruyor — KPI strip, kanal donut, leaderboard, AI insight bar. Her biri Türkiye gerçeğine adapte edilmiş.

### Bloomberg Terminal estetiği, premium spirits ruhu

Renk paleti seçimi kasıtlı:

- **Dark theme (#0d1117 ana zemin)** — finansal terminal hissi. CEO masasında, ışıklı bir ofiste, gözü yormayan, profesyonel duruş. "Excel'le yapmıyoruz" mesajı.
- **Champagne gold (#d4a857) ana vurgu rengi** — premium spirits estetiği. Whiskey, kanyak, şampanya çağrışımı. PR'ın global "premiumization" hikayesinin renk dili.
- **Mor (#c084fc)** = lüks markalar (Royal Salute, Perrier-Jouët), aynı zamanda **Ramazan göstergesi** — dini bayram dönemine kibar görsel kod
- **Yeşil (#3fb950)** = büyüme, fırsat, turistik sezon
- **Kırmızı (#f85149)** = risk, düşüş, anomali, "bugün" işareti
- **Mavi (#58a6ff)** = Off-trade kanalı, nötr bilgi

Sektörel kod: spirits sunum kültüründe altın/mor kullanımı yaygın (Chivas, Royal Salute, Martell logoları). Ekran kültürel kodla "kendine ait" hissetiyor — generic SaaS dashboard'undan farklı.

### Yoğunluk seviyesi: dolu ama nefes alabilir

Tek ekranda 5 KPI + harita + donut + takvim şeridi + 2 büyük panel + heatmap + leaderboard + portföy tablosu + AI insight var. **Kasıtlı yoğun**.

Bloomberg Terminal mantığı: yönetici tek ekrana 10 saniye baktığında 10 farklı sinyal alabilmeli. Tüm bilgi *tek ekran scroll'da*, sekme değiştirmeden. Yoğun ama hiyerarşi var: KPI'lar → bağlam (harita, mix) → karşılaştırma (takvim, matris, heatmap) → kişi/portföy → AI yorum.

İnce ayraç çizgiler, padding, boş alanlar — nefes aldıran katmanlar.

---

## 3. Bileşen Bileşen Mantık

### 3.1. Header

- Sol: UNIQUE marka + ekran adı ("Komuta Köprüsü") + rol etiketi ("CEO / Satış Direktörü Görünümü")
- Orta: Breadcrumb — kapsam, periyot, marka filtresi
- Sağ: Canlı veri rozeti + kullanıcı + rol

**Niye böyle?** CEO ekranı açtığında ilk yaptığı şey "doğru ekrandayım" doğrulaması. Rol etiketli, periyot belli — güven katmanı.

**Canlı veri rozeti** kritik: yöneticinin hafızasında "**bu rakamlar ne kadar günceldir?**" sorusu sürekli vardır. Yeşil titreşim "şu an" hissi veriyor.

### 3.2. Filtre Bar

5 dropdown chip + sağda 3 toggle:
- **Reel TL** (TÜFE arındırılmış)
- **ÖTV-net görünüm**
- **Takvim hizalı (Ramazan-aware)**

**Niye bu 3 toggle?** Türkiye spirits piyasası yöneticisinin kafasında sürekli olan 3 soru:
- "Gerçekten büyüyor muyuz yoksa enflasyon mu?" → Reel TL
- "Vergiyi çıkarınca markaya kalan ne?" → ÖTV-net
- "Geçen yılla kıyaslarken Ramazan farkını ayrı tuttuk mu?" → Takvim hizalı

Bu üç toggle ekranı **PR-specific** yapıyor — generic dashboard'larda yok.

### 3.3. KPI Strip (5 kart)

| Kart | Sayı | Mini-Görsel | Hangi soruya cevap |
|---|---|---|---|
| Toplam Net Ciro | ₺142,8M | 12 aylık spark | "Ne kadar para?" |
| Hedef Tutturma | %94 | Progress bar | "Hedefe yakın mıyız?" |
| Premium Mix | %38,4 | 3-bar oranı | "PR Group hikayesi" |
| Aktif Satış Noktası | 8.743 | Spark | "Operasyonel sağlık" |
| Ortalama Sepet | ₺16.330 | Spark | "Müşteri başına derinleşiyor muyuz?" |

**Niye 5, ne 4 ne 6?** 4 az kalıyor (eksik hikaye), 6 zihin yorucu. 5 — CEO'nun ekranda ezbere takip ettiği "sayı seti".

**Niye satış noktası sayısı + ortalama sepet birlikte?** İkisi birlikte "**hem büyüyoruz hem zenginleşiyoruz**" mesajı veriyor. Müşteri tabanı büyüyor (nokta) + her noktadan daha çok para alıyoruz (sepet) → sağlıklı büyüme. Sadece ciro büyümesi yanıltıcı olur (enflasyon faktörü).

### 3.4. Conditional Takvim Banner

KPI strip'in altında, **sadece önemli takvim olayı 30 gün içindeyse** görünüyor. Şu an: "28 gün sonra Kurban Bayramı".

**Tasarım kararı**: Bayram metriği KPI strip'e koymadık çünkü:
- Her gün gösterilmesi gerekmiyor (sadece yaklaşırken)
- KPI seviyesi metrik değil, takvim *olayı*
- Geçen yıl rakamlarını ezberletmek yerine **bağlam veriyoruz**

**Niye banner formatı?** Scroll yapmadan görünmesi gerekiyor — "28 gün sonra Kurban Bayramı, hatırla" sinyali ekran açılır açılmaz alınmalı. Aşağıdaki Yaklaşan Sezon paneli detayı içeriyor.

**State machine**:
- 30+ gün uzak → banner yok
- 30–7 gün → görünür (şu anki durum)
- 7–0 gün → vurgulu hâle gelir
- Bayram günleri → "bugünkü etki" göstergesi
- Bayram sonrası 7 gün → "performans özeti" varyantı
- Sonra → arşive iner

### 3.5. Harita (Türkiye + KKTC)

8 ana bölge + KKTC, her birinde YoY % rakamı. **Yoğunluk + renk** çift kodlu:
- Yeşil = +%15+ büyüme (İstanbul, Antalya, Bodrum, KKTC)
- Altın = +%5 ile +%15 (Ankara, İzmir, Marmara)
- Kırmızı + ⚡ = anomali (Karadeniz −%4)

**Niye YoY, mutlak ciro değil?** CEO için "büyüme momentumu" mutlaktan değerli. İstanbul zaten en büyük; bunu söylemek hikaye değil. **+%21 büyüyor olması** ise hikaye.

**Sekmeler**: Ciro YoY / Premium % / Bayram Etkisi — aynı haritanın 3 katmanı. CEO'nun düşünce akışı: "büyüme nerede? premium nerede yoğun? bayram en çok hangi bölgeyi vurdu?"

**KKTC ayrı çizildi**. PR Türkiye operasyonu KKTC'yi de kapsıyor, sektörel jargon "Türkiye + KKTC" der. Salesforce CGC default haritalarında bu ayrım yok.

### 3.6. Kanal Mix Donut + 12 Aylık Trend

Donut: HORECA / Off-trade / Otel / MOT / **KKTC** ayrı segment. Trend: 12 aylık bar; Mart Ramazan ayı yarı opak — geçen aydaki bayram etkisi görsel olarak ayrışıyor.

**Niye KKTC ayrı segment?** Bağımsız iş ünitesi mesajı. PR yöneticisi için KKTC %4 (₺5,7M) — küçük ama kendi başına kanal.

**Niye bar grafik, line değil?** 12 ay = 12 dikey sütun — Ramazan'ın hangi ay olduğunu işaretlemek için bar daha okunaklı.

### 3.7. Takvim Şeridi (mockup'ın diferansiyatörü)

12 aylık timeline, üzerinde:
- **2 trend çizgisi**: bu yıl (parlak altın) + geçen yıl (silik kesikli gri). Üst üste hizalı.
- **Olay marker'ları**: Yaz Pik, 29 Ekim, Yılbaşı, 14 Şubat, Ramazan, Bugün
- **Sezon bantları**: Mayıs–Eylül yeşil (turistik), Mart 2026 mor (Ramazan)
- **Bugün noktası**: kırmızı pulse, en sağda

**Niye Salesforce'ta yok?** Çünkü Salesforce takvim mantığı Western/Hristiyan — Christmas, Easter, Black Friday standart. Ramazan, Kurban Bayramı, Cumhuriyet Bayramı yok. Ramazan her yıl 11 gün geri kayan kayan ay — generic dashboard için hizalama zor.

**Niye iki çizgi üst üste?** Türkiye spirits piyasası **takvim-sensitive**. "Geçen yıl Mart'ta düştük, bu yıl da düştü" demek yetmez. "Geçen yıl Ramazan'da %14 düştük, bu yıl Ramazan Mart'taydı ama %8 düştük" — bu hikaye. Şerit bunu görsel olarak söylüyor.

**Hiyerarşi**: Bu yıl çizgisi **parlak ve dolgun**, geçen yıl **silik kesikli**. Yöneticinin gözü doğal olarak bu yıla gidiyor, fark gerektiğinde geçen yıla bakıyor.

### 3.8. Yaklaşan Sezon Paneli (Kurban Bayramı)

Sol büyük panel. Yapısı:
- **Eyebrow**: "⏳ Yaklaşan Pik"
- **Başlık**: "Kurban Bayramı 2026"
- **Tarih + sayım**: "27–30 Mayıs · 28 gün kaldı"
- **Geçen yıl etkisi tablosu**: 4 segment kırılımı
- **Tahmin cümlesi**: "Bu yıl etkisi +₺22M (Reel TL)"
- **Pencere uyarısı**: kırmızı kutu, "Pre-stocking penceresi 14 Mayıs'ta kapanıyor"

**Niye bu kadar detaylı?** Banner sinyaldir; bu panel "**bu sefer hazırlıklı mıyız?**" sorusunun cevabıdır. "Bodrum +%62" gibi somut sosyal kanıt.

**Niye kırmızı uyarı?** 14 günlük pencere kaçırılırsa ciro yapılamaz. Korkutucu değil ama dikkat çekici.

### 3.9. Marka × Dönem Matrisi

5 zaman dilimi × 8 marka:

| Marka | Bu Ay (vurgulu) | Geçen Ay (Ramazan 🌙) | 3 Ay Önce | Geçen Yıl Aynı Ay | 2 Yıl Önce | Trend |

**Niye 5 sütun?** Yöneticinin zihninde 3 zaman ekseni var:
1. **Şimdi** (Bu Ay)
2. **Kısa vade** (Geçen Ay, 3 Ay Önce) — "trend bozuldu mu?"
3. **Uzun vade** (Geçen Yıl, 2 Yıl Önce) — "yapısal mı geçici mi?"

5 sütun bu üç ekseni de gösteriyor.

**Niye Ramazan ikonu (🌙)?** Mart 2026 Geçen Ay sütununda. Yönetici "Mart neden düşük" diye sormadan cevabı veriyor — bağlam ipucu.

**Trend kolonu emoji-ile**: 🚀 (premium büyüme), 📈 (sağlam), 📊 (stabil), 📉 (düşüş). Yoğun bilgiye hızlı tarama imkanı.

**Niye Royal Salute / Glenlivet / Martell trend "🚀"?** PR Group "premiumization" mesajının Türkiye versiyonu görsel olarak ön planda. CEO Paris sunumunda bu satırı doğrudan kullanır.

### 3.10. Bölge × Marka YoY Heatmap

8 bölge × 6 marka grid + bölge ortalaması. Renk yoğunluğu = YoY % değişim. 6 derece (cold → fire).

**Niye 6 marka?** 10 marka göz yorucu, 4 eksik kalıyor. 6 — top markalar + premium kapsamı.

**⚡ anomali işareti**: Karadeniz × Jameson −%22 (bölge ortalaması +%0,5). Görsel olarak fısıltı: "**buraya bak**".

**Niye Salesforce'ta tam karşılığı yok?** Salesforce CRM Analytics'te benzer heatmap yapılabilir ama Türkiye spirits için **ön ayarlı yok**; geliştirici kurmalı. Biz default'tan veriyoruz.

### 3.11. Bölge Müdürü Sıralaması

8 müdür, hedef tutturma % bar grafik. Top 3'te altın/gümüş/bronz badge.

**Niye leaderboard formatı?** Çünkü PR Türkiye **bonus kültürü** olan bir organizasyon. Yöneticilerin kafasında sıralama metaforu zaten var; ekranda görmek doğal.

**Niye renk kodlu**: Yeşil > %95 (top performer), altın %85–95 (warn), kırmızı < %85 (intervention).

**Hangi rolü görüyor?** Burada Satış Direktörü "kimin desteğe ihtiyacı var" sorusuna cevap arıyor. Tek tık → bölge drilldown ekranı açılabilir (henüz mockup'ta yok).

### 3.12. Marka Portföyü · 2 Yıllık Yörünge

Tablo: Marka × (Nis 2026 / Nis 2025 / Nis 2024 / YoY / 2-yıl Δ / Mini-spark).

**Niye 3 sütun zaman + 2 sütun delta?** Çünkü PR Group "premiumization" hikayesi **çok yıllık yörünge**. Tek YoY %18 büyüme iddiası yetersiz; "2 yılda %37 büyüdü" daha güçlü hikaye.

**3-bar mini sparkline**: Her marka için 2024/2025/2026 görsel kanıt. Royal Salute'un %79 büyüme yörüngesi grafikten okunabiliyor.

**Premium/Lux tag'leri**: Görsel hiyerarşi. PR Group hikayesi bu kategorilerde, vurgu istiyor.

### 3.13. AI Insight Bar

Alt şerit. 3 paragraf + 3 aksiyon butonu:

1. **2 yıllık premium yörünge** (CEO mesajı, Paris hikayesi)
2. **Ramazan toparlanma karşılaştırması** (takvim-aware analiz)
3. **⚡ Karadeniz Jameson anomalisi** (aksiyon gerektiren)

**Niye 3 paragraf?** Daha az = yüzeysel, daha çok = okunmaz. 3 paragraf = "1 dakikalık günlük brief" mantığı.

**Niye paragraflar bu sırada?**
- 1. paragraf = **olumlu strateji haberi** (CEO ego'su, Paris)
- 2. paragraf = **olumlu nüans** (Ramazan toparlanma)
- 3. paragraf = **acil aksiyon** (anomali)

İnsan psikolojisi: iyi-iyi-kötü sırası kötü haberi kabul edilebilir kılar. "Bardak dolu sonra eksik" yapısı.

**Aksiyon butonları**:
- "Hikayenin tamamını oku" — uzun versiyon
- "Karadeniz Jameson aksiyonunu Can Öztürk'e ata" — tek-tık görev oluşturma
- "Kurban Bayramı sezon planını başlat" — workflow tetikleme

Tek satırda "bilgi → karar → aksiyon" döngüsünü kapatıyor.

---

## 4. Salesforce'tan Aldıklarımız vs Yeniden Düşündüklerimiz

### Aldıklarımız (referans / format)

| Salesforce'ta | Bizim ekranda | Neyi koruduk |
|---|---|---|
| Sales Manager Home KPI strip | Üst 5 kart | Tek bakışta nabız ilkesi |
| CRM Analytics Territory Performance | Türkiye haritası | Coğrafi sıcaklık katmanı |
| Tableau Pulse AI summary | AI Insight Bar (alt) | Doğal dil yorum + aksiyon önerisi |
| CGC dashboard leaderboard | Bölge Müdürü sıralaması | Kompetisyon formatı |
| Trade Promotion ROI dashboard | Marka × Dönem matrisi | Çok-zaman karşılaştırma |

### Yeniden düşündüklerimiz (PR Türkiye'ye özgü)

| Bizim ekranda | Salesforce'ta yok / zayıf | Niye |
|---|---|---|
| Reel TL toggle | Yok (custom geliştirme) | Türkiye enflasyon ortamı |
| ÖTV-net toggle | Yok | Türkiye vergi yapısı |
| Takvim hizalı toggle | Yok (Western takvim) | Ramazan kayma |
| Türkiye Takvim Şeridi | Yok | Ramazan/Kurban/Cumhuriyet kayma |
| KKTC ayrı kanal | Custom field | Sektörel taksonomi |
| Premium Mix vurgusu | Generic mix | PR Group "premiumization" |
| Conditional bayram banner | Yok | Türkiye takvim-event mantığı |
| Yaklaşan Sezon panel | Yok | Sezon-aware proaktivite |
| HORECA / Off-trade / Otel / MOT / KKTC kanal taksonomisi | Custom picklist | TR spirits varsayılan |

---

## 5. Demo Akışında Bu Ekran

**5 dakikalık PR pitch'inin 0:30–2:00 arası**:

> *"Pazartesi sabah PR Türkiye Satış Direktörü ofise gelip laptop'u açtığında bunu görüyor. Üst şeritte 5 sayı — Nisan ciromuz ₺142M, hedefin %94'üne ulaştık, premium mix %38, satış noktası ve sepet büyüklüğü ikisi de büyüyor. 28 gün sonra Kurban Bayramı geliyor — geçen yıl Bodrum otelleri +%62 büyümüştü, pre-stocking penceresi 14 Mayıs'ta kapanıyor. Haritada İstanbul ve Antalya yeşil, Karadeniz kırmızı; Karadeniz × Jameson −%22 anomali, sistem fark etti."*

> *"Burada Türkçe takvim hizalama yapıyoruz — Ramazan her yıl 11 gün geri kayıyor, geçen yılla kıyaslamak için takvimi hizalamak gerekiyor. Salesforce CGC'de Western takvim standart, Ramazan custom geliştirme. Reel TL toggle ile TÜFE arındırarak rakamı görebiliyoruz — gerçek büyüme nedir, sahte enflasyon büyümesi nedir."*

> *"2 yıllık portföy yörüngesinde Royal Salute +%79, Glenlivet +%68, Martell +%51. Bu PR Group 'premiumization' hikayesinin Türkiye'deki en güçlü slayt'ı — Paris board sunumunda direkt kullanılabilir."*

**Hangi cümleler "wow" yaratıyor**:
- "Takvim hizalama — Ramazan kayan ay" (Salesforce zayıflığı)
- "Reel TL toggle" (Türkiye gerçeği)
- "Karadeniz Jameson anomalisi sistem fark etti" (AI değeri)
- "Paris sunumuna direkt slayt" (CEO ego'su)

---

## 6. Ne Yapmadık ve Niye

### Mikro-aksiyon listeleri çıkardık
İlk versiyonda "Top 5 Risk Outlet" + "Top 5 Fırsat Outlet" panelleri vardı. **Bunlar bölge müdürü görevi, CEO değil**. CEO için bu seviye gürültüdür. Mikro aksiyonlar ayrı ekranda (Risk Radarı, Boşluk Avcısı).

### Kuruluş bazlı KPI koymadık
"Sahacı sayısı", "ziyaret tamamlanma %" gibi operasyonel metrikler yok. **Operasyonel sağlık ≠ stratejik nabız**. Operasyonel metrikler Sales Manager radar'ında.

### Bayram detayını KPI strip'e koymadık
İlk versiyonda "Ramazan Etkisi" + "Kurban Bayramı'na 28 gün" kartları vardı. **KPI strip her gün aynı 5 metriği göstermeli**, takvim olayı conditional banner'a düştü. KPI = sürekli; banner = durumsal.

### Real-time stream görünümü değil
Dakika başı güncellenen ticker tarzı bir görünüm yapmadık — yöneticinin günde bir-iki kez baktığı ekran, dakikalık değişim ihtiyaç değil. "4 dk önce senkron" yeterli güven.

### Slack/Teams entegrasyonu önermedik (bu mockup'ta)
Push notification UX'i ayrı bir tasarım kararı — Komuta Köprüsü "pull" ekranı, "push" katmanı için ayrı düşünceye ihtiyaç var.

---

## 7. Bir Sonraki Adımlar

### Mockup tarafında
- **Foresight Pro + Senaryo Stüdyosu** — "ÖTV %15 artarsa premium ciroma ne olur" simülatörü
- **Outlet Mikroskobu** (satış noktası deep-dive) — yönetici bir noktaya tıklayınca ne görüyor
- **Bölge Drilldown** — leaderboard'tan tıklayınca açılan bölge müdürü görünümü
- **Mobil versiyon** — CEO'nun telefonunda nasıl durur

### Build sıralaması (P0 paket, 4–6 hafta)
1. KPI strip + harita + donut → mevcut Dashboard modülünün üstüne katman
2. Marka × Dönem matrisi + heatmap → Sorgular modülünün backend'i kullanılabilir
3. Takvim şeridi → Foresight modülünün takvim katmanıyla bağlanır
4. AI Insight Bar → mevcut Stok Radar / Foresight insight engine'i ile beslenir

### Veri ihtiyaçları
- Univera Panorama'dan: satış noktası bazlı günlük sell-out, kanal etiketi, GPS koordinat
- Hesaplanmış boyutlar: TÜFE-arındırılmış TL, ÖTV-net TL, Ramazan hizalı tarih
- Takvim master tablosu: Ramazan tarihleri (5 yıllık), bayram günleri, turistik sezon bantları
- AI Insight üretimi: Gemini ile Türkçe NL brief composer (mevcut Foresight prompt'u temel alınabilir)

### Test edilmesi gereken hipotezler
1. CEO/SD ekranı gerçekten günde 1+ kez açıyor mu? (Adoption metric)
2. "Reel TL toggle" gerçekten kullanılıyor mu, yoksa default'ta mı kalıyor?
3. Takvim hizalı görünüm wow yaratıyor mu, yoksa kafa karıştırıyor mu?
4. AI Insight aksiyon butonları tıklanıyor mu? (En kritik adoption sinyali)

---

## 8. Özet

**Komuta Köprüsü, PR Türkiye CEO/Satış Direktörü'nün sabah masasına oturduğunda 30 saniyede günü anlaması için tasarlandı.**

Salesforce CGC + CRM Analytics + Tableau Pulse format dilini kullanarak — ama Türkiye spirits piyasasının 3 gerçeğine adapte ederek:

1. **Enflasyon + ÖTV** → Reel TL / ÖTV-net toggle'lar
2. **Kayan dini takvim** → Takvim Şeridi, Ramazan-aware karşılaştırma
3. **Premium odaklı portföy hikayesi** → 2 yıllık yörünge tablosu, premium mix vurgusu

Hedef his: "**Yeni bir araç değil, daha akıllı bir asistan**." Yöneticinin zaten kafasında olan soruları sormadan cevaplıyor; bilmediği bir şeyi (anomali) önüne koyuyor; gelecek için (Kurban Bayramı) hatırlatıyor; aksiyona tek tıkta dönüştürülüyor.

**Demo'da satılan tek cümle**: *"Bu ekranı her sabah açın. Paris'e götüreceğiniz cevaplar buradadır."*
