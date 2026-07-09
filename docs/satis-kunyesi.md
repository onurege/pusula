# Enroute Pusula — Satış Künyesi & Sözleşme Eki

> **Amaç.** Bu döküman, Enroute Pusula ürünü için satış sözleşmesi
> hazırlayacak kişiye teknik ve ticari kapsamı tek bakışta verir.
> Müşteri-bağımsız yazılmıştır; her prospect için 16. bölümdeki
> **Müzakere Değişkenleri** yaprağı doldurulur.

---

## 1. Yönetici Özeti

**Enroute Pusula**, Univera ERP üstünde çalışan, satış yönetimi ve saha
operasyonları için **10 ekranlı analitik dashboard + yapay zekâ destekli
karar asistanı**dır. Dağıtıcı şirketler (FMCG/alkollü içecek/gıda) için
canlı satış verisini Türkiye'nin 81 ili ve 5 ana bölgesi üzerinden
görsel olarak sunar; sahadaki temsilcinin, bölge müdürünün ve yönetim
kurulunun aynı veri kaynağından farklı detay seviyelerinde karar
almasını sağlar.

**Bugüne kadar kanıtlanmış kullanım:** Pernod ve Wietnauer dağıtım
ağlarında canlı; demo ortamında 3. tenant aktif.

---

## 2. Kapsam — Teslim Edilen Modüller

Tek bir kurulum, **10 dashboard + 1 AI asistan + 1 harita altyapısı**
içerir. Modüller bir araya geldiğinde tek tutarlı ürün; ayrı ayrı
fiyatlanabilir veya paket olarak verilebilir.

| # | Modül | Ne Verir |
|---|---|---|
| 1 | **Özet** | Tek ekran KPI hero — toplam ciro, aktif müşteri, top 10 konsantrasyonu, stratejik marka payı |
| 2 | **Cockpit** | Komuta merkezi — Türkiye haritası + bölge × ürün YoY heatmap + distribütör/temsilci leaderboard + takvim trendi |
| 3 | **Harita** | Şehir/il bazlı satış haritası; risk skoruna göre müşteri renklendirme + bölge drill-down |
| 4 | **Yönetim Kurulu** | Marka katkıları, top 50 müşteri analizi, segment kırılımı — yönetici özet ekranı |
| 5 | **Satış Performansı** | Distribütör + temsilci leaderboard, ortalama sipariş büyüklüğü, yeni müşteri kazanımı |
| 6 | **Müşteri Segmentasyon** | Müşteri tipi × marka heatmap, segment bazlı dağılım |
| 7 | **Marka & SKU** | Marka portföyü, top SKU, penetrasyon, stratejik marka zoom, 30g/90g/YTD karşılaştırma |
| 8 | **Saha Operasyon** | Temsilci ziyaret performansı, kapsama oranı, distribütör karşılaştırma |
| 9 | **Aktivasyon & Risk** | 90 günde aktif müşteri, sessizleşenler, stratejik marka sessizliği, risk skoru, yeniden kazanım listesi |
| 10 | **Ticari Yatırım & İskonto** | İskonto/ciro oranı, marka × iskonto etkinliği, müşteri ROI, segment iskonto kırılımı |
| 11 | **Finans Agent (AI)** | Heatmap'te anomaliye tıklayınca açılan AI drill-down: ne oldu, neden oldu, hangi müşteriler etkilendi |
| 12 | **Haftalık Aksiyon Drawer** | Sahadaki ekibin haftalık görev kuyruğu; ekranlardan tek tıkla aksiyon eklenir |

---

## 3. Çekirdek Yetenekler (Müşteri Karşısında Konuşulacak Ana Mesajlar)

- **Multi-tenant** — tek kurulum, birden fazla şirket; veri tabanları izole
- **Canlı veri** — Univera ERP MSSQL'e doğrudan bağlanır; nightly ETL yok
- **AI Finans Agent** — Anomaliyi tespit eder, kök nedeni açıklar, aksiyon önerir
- **Türkiye haritası** — Gerçek il polygon'ları, bölgesel renklendirme, drill-down
- **9LE/TL toggle** — Hacim (9-litre eşdeğer) ve TL ciro aynı ekranda
- **Dark/light tema** — Kullanıcı tercihi + OS otomatik
- **Mobil uyumlu** — Tablette ve telefonda çalışır (responsive)
- **Demo modu** — Tarih sabitlenebilir; satış sunumlarında tutarlı veri

---

## 4. Veri Kaynakları & Bağlantı

| Kaynak | Tip | Yön |
|---|---|---|
| Univera ERP MSSQL | Operasyonel veri tabanı | **Salt okunur (read-only)** |
| SQLite cache | Yerel önbellek (5dk RAM + disk) | Yazma — sadece cache |
| Google Gemini AI (opsiyonel) | LLM | Sadece prompt; veri payload gönderilmez |
| `data/geo/tr-province-region.json` | Türkiye il-bölge master | Statik, ürünle gelir |

**Veri sözleşmesi:** Ürün MSSQL'e **hiçbir koşulda yazmaz**; INSERT/UPDATE/
DELETE/DDL kesinlikle yoktur. Tek istisna: müşteri açık onayıyla
oluşturulan tek bir AI çıktısı tablosu (örn. `MUSTERI_AI`) — bu da müşteri
talebiyle aktive edilir.

---

## 5. Müşteri Yükümlülükleri (Kurulum İçin Gerekli)

Müşteri tarafından sağlanması gereken minimum girdiler:

1. **MSSQL erişimi** — read-only kullanıcı + connection string
2. **VPN/network erişimi** — Univera ERP'ye dış erişim için
3. **Master tabloların güncel olması** — TBLDIST, TBLDISTEKGRUP, TBLMUSTERIGRUP, TBLURUN, TBLURUNGRUP, TBLMUSTERIEKSAHA
4. **Stratejik marka listesi** — hangi markalar "öncelikli takipte"
5. **9LE katsayıları (opsiyonel)** — TBLURUNEKSAHA saha 26 dolu değilse, ürün hacmi `DBLLITRE × 0.7L` referans formülüyle hesaplanır
6. **Demo verisi** — pilot dönem için isteğe bağlı tarih sabitleme
7. **Kabul testi katılımcıları** — yönetim + saha + IT'den birer kişi

---

## 6. Teslim ve Kabul Kriterleri

Her modül için "tamam" tanımı aşağıdaki 4 adımda kontrol edilir:

1. **API yanıt** — Modülün backend endpoint'i HTTP 200 dönüyor, JSON şeması beklenen alanları içeriyor
2. **UI render** — Dashboard ekranı boş alan/error göstermeden veriyi gösteriyor
3. **Smoke test** — Müşterinin sağladığı 5 rastgele metric (örn. "İstanbul ciro son 30g", "Top 3 marka payı") müşterinin kendi ERP'sinden manuel hesabıyla eşleşiyor (%2 tolerans)
4. **Kullanıcı onayı** — Müşteri sahası en az 1 hafta günlük kullanım sonunda yazılı onay veriyor

**Faturalama tetikleyicisi:** Her modül için 4 adım tamamlandığında ilgili kalem fatura edilebilir.

---

## 7. Mimari Özet

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Next.js 16 + React 19 RSC, mobil/desktop)        │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────────────────┐
│  Dashboard SSR (Node.js, port 3000)                         │
│   └─ HTTP fetch + 5dk RAM cache (tag-based revalidate)     │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────────────────────┐
│  API (Hono on Node.js, port 8080)                           │
│   ├─ Multi-tenant config (env prefix: W_*, P_*, D_*)        │
│   ├─ Snapshot cache (SQLite, versioned per metric)          │
│   └─ MSSQL bağlantı havuzu (mssql npm)                      │
└────────────────────┬────────────────────────────────────────┘
                     │ TDS (TCP 1433, salt okunur)
┌────────────────────▼────────────────────────────────────────┐
│  Univera ERP MSSQL — müşteri tarafında                      │
└─────────────────────────────────────────────────────────────┘
```

**Teknoloji yığını:** Next.js 16 (frontend), Hono + Node.js (API),
mssql + SQLite (veri katmanı), MapLibre GL (harita), Recharts (grafikler),
TailwindCSS (stil), Google Gemini (opsiyonel AI).

**Deployment seçenekleri:** On-premise (müşteri sunucusunda Docker) veya
SaaS (sağlayıcı bulut altyapısında, izole tenant).

---

## 8. Lisans, Fikri Mülkiyet, Veri Sahipliği

> Bu bölümün her satırı sözleşme yazıcısı tarafından netleştirilmelidir.
> Aşağıdaki noktalar ürün gerçekliğini yansıtır:

- **Kaynak kod sahibi:** Geliştirici (telif: Univera/sağlayıcı). Müşteriye **kullanım hakkı** verilir.
- **Müşteri verisi:** %100 müşteriye aittir. Sağlayıcı bu veriyi başka müşteriye veya 3. tarafa aktarmaz.
- **AI prompt'ları:** Gemini'ye agregasyon sonuçları (sayısal özetler) gönderilir, ham kişisel veri **gönderilmez**. AI tamamen kapatılabilir.
- **Çıkış senaryosu:** Müşteri kullanım hakkını sonlandırırsa veri snapshot'ı (CSV/JSON) dışa aktarılır.
- **Kaynak kod escrow:** Sağlayıcı iflas vb. durumda kod escrow opsiyonu sözleşmeye eklenebilir.

---

## 9. Güvenlik & Uyum

- **Read-only DB** — SQL injection riski yok; tüm sorgular `assertReadOnly` guard'ından geçer
- **Audit log** — Tüm cache entry'leri ve API çağrıları SQLite'a loglanır
- **KVKK uyumu** — Kişisel veri (kişi adı/TC/iletişim) saklanmaz; sadece şirket unvanı ve satış agregasyonu
- **Secret yönetimi** — Tüm credential'lar `.env` dosyasında; repo'ya commit edilmez
- **HTTPS** — Üretimde zorunlu; on-prem kurulumda reverse proxy (nginx/caddy) önerilir
- **Erişim kontrolü** — Kurumsal SSO (SAML/OIDC) entegre edilebilir; varsayılan yok

---

## 10. SLA & Destek (Önerilen Çerçeve)

| Kategori | Hedef | Açıklama |
|---|---|---|
| Uptime | %99.5 | Aylık planlı bakım hariç |
| Severity 1 (sistem down) | 4 saat ilk yanıt | Üretim tamamen erişilemiyor |
| Severity 2 (ciddi hata) | 24 saat ilk yanıt | Bir veya birkaç modül çalışmıyor |
| Severity 3 (minor) | 72 saat ilk yanıt | Görsel/UX/edge case |
| Sürüm güncelleme | Aylık release | Major versiyon yılda 1-2 |
| Maintenance window | Pazar 04:00-06:00 TR | 1 hafta önceden bildirim |

---

## 11. Fiyatlandırma Boyutları (Sayısal Değer YOK — Müzakere Edilir)

Sözleşme tutarı aşağıdaki **6 değişkenin** kombinasyonuyla belirlenir:

1. **Tenant sayısı** — kaç ayrı şirket/marka aynı kurulumda?
2. **Aktif kullanıcı sayısı** — eş zamanlı oturum
3. **Veri hacmi** — fatura/yıl, distribütör sayısı
4. **Refresh sıklığı** — 5 dk standart; gerçek-zamanlı isteniyor mu?
5. **AI kullanım hacmi** — Finans Agent çağrı/ay
6. **Modül seçimi** — 10'unun hangileri? Paket vs à la carte

Lisans modeli seçenekleri:
- **SaaS aylık abonelik** (sağlayıcı host)
- **On-premise yıllık lisans** (müşteri host)
- **Perpetual + maintenance** (tek seferlik + yıllık destek)
- **Per-tenant veya per-seat** (kullanıcı bazlı)
- **Pilot → production** (3-6 ay pilot, sonra ana sözleşme)

---

## 12. Kapsam Dışı (Sözleşmeye Yazılması Önerilir)

Aşağıdakiler **ürün kapsamında değildir**; ayrıca skoplanır:

- ERP'ye yazma / ERP modifikasyonu
- Saha cihaz entegrasyonu (el terminali, barkod, IoT)
- Ses/görüntü AI (OCR, transkripsiyon)
- Mobile native uygulama (iOS/Android)
- 3rd-party CRM entegrasyonu (Salesforce, Hubspot, vb.)
- Datawarehouse/BI tool entegrasyonu (PowerBI, Tableau)
- Otomatik e-posta/SMS bildirimleri
- Çoklu dil desteği (şu an sadece Türkçe)
- ERP dışı veri kaynakları (Excel upload, manuel veri girişi)

---

## 13. Değişiklik Talebi Süreci

1. Müşteri yazılı talep gönderir (yeni ekran, yeni metric, yeni filter, vb.)
2. Sağlayıcı 5 iş günü içinde efor tahmini verir
3. Müşteri onayı sonrası geliştirme planına alınır
4. Standart geliştirici saat/günlük ücreti üzerinden faturalanır
5. Major değişiklikler ana sözleşmenin ek protokolü olarak imzalanır

---

## 14. Süre, Yenileme, Çıkış

- **Süre:** Müzakere edilir (12/24/36 ay yaygın)
- **Otomatik yenileme:** Sözleşmeye opsiyon; varsayılan 60 gün öncesinde bildirim
- **Erken çıkış:** Şartlar müzakereye açık
- **Veri taşınabilirliği:** Çıkışta tüm snapshot'lar JSON/CSV olarak teslim edilir
- **Kod escrow:** Opsiyonel; sağlayıcı iflas vb. durumlar için

---

## 15. Ekler

- [ ] Ekran görüntüleri (Özet, Cockpit, Harita)
- [ ] Roadmap (yaklaşan 3 ay)
- [ ] Mevcut referans müşteriler (referans verme izni alındıysa)
- [ ] Demo URL ve giriş bilgisi (talep üzerine)
- [ ] Mimari diyagram (yüksek çözünürlüklü PDF)
- [ ] KVKK / Veri İşleme Sözleşmesi şablonu

---

## 16. Müzakere Değişkenleri Yaprağı (Her Prospect İçin Doldurulur)

> Bu sayfa **tek başına çıktı alınır** ve müzakere sürecinde günceltlenir.

**Prospect bilgileri**

| Alan | Değer |
|---|---|
| Şirket adı | ___________________ |
| Sektör | ___________________ |
| Distribütör sayısı | ___________________ |
| Tahmini yıllık fatura sayısı | ___________________ |
| Karar verici | ___________________ |
| Hedef go-live tarihi | ___________________ |

**Kapsam seçimi**

| Modül | Dahil mi? | Notlar |
|---|---|---|
| Özet | ☐ | |
| Cockpit | ☐ | |
| Harita | ☐ | |
| Yönetim Kurulu | ☐ | |
| Satış Performansı | ☐ | |
| Müşteri Segmentasyon | ☐ | |
| Marka & SKU | ☐ | |
| Saha Operasyon | ☐ | |
| Aktivasyon & Risk | ☐ | |
| Ticari Yatırım & İskonto | ☐ | |
| Finans Agent (AI) | ☐ | |
| Haftalık Aksiyon Drawer | ☐ | |

**Lisans modeli**

- ☐ SaaS aylık
- ☐ On-prem yıllık
- ☐ Perpetual + maintenance
- ☐ Pilot → production
- ☐ Diğer: ___________________

**Fiyatlandırma değişkenleri**

| Değişken | Değer |
|---|---|
| Tenant sayısı | _______ |
| Aktif kullanıcı | _______ |
| Refresh sıklığı | _______ |
| AI çağrı/ay | _______ |
| Süre (ay) | _______ |

**Açık riskler / özel istekler**

```
[serbest metin]
```

---

> **Hazırlayan:** [İsim]  ·  **Tarih:** [____]  ·  **Versiyon:** v1.0
