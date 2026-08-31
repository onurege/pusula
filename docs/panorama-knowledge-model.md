# Panorama AI Support Brain — Business Knowledge Model

> **Amaç:** Panorama ürününü *anlayan* tek bir bilgi katmanı. Chatbot değil; Web Chat, WhatsApp, L1 Agent Assist, Ticket Generation, Root Cause Analysis ve Tool Calling'in **ortak beynidir**.
>
> **Temel kural:** Bu model kullanıcı diliyle konuşur. Kullanıcıya asla `TBLMUSTERI` denmez — **"Müşteri Kartı"** kavramı anlaşılır. Teknik tablo/kolon adları yalnızca en alttaki, gizli **tool-calling eşleme** katmanında yaşar; hiçbir zaman yüzeye çıkmaz.

---

## 0. Tasarım İlkeleri ve Katman Mimarisi

### 0.1 Beş ilke
1. **Dil sınırı (Language Boundary).** İki dünya vardır: *İş dili* (Sipariş, Belgeleştir, İrsaliye) kullanıcıya bakar; *Teknik dünya* (tablolar, parametreler, kolonlar) sadece makineye bakar. Knowledge Object bu ikisini içeride birbirine bağlar, dışarıda yalnız iş dilini gösterir.
2. **Tek obje modeli (Single Object Model).** Yedi ontoloji ayrı silolar değildir; hepsi tek bir **Knowledge Object** şemasının farklı *yüzleridir* (§7). RAG, Case Retrieval ve Tool Calling **aynı objeyi** farklı alanlarından okur.
3. **Katmanlı ama bağlı (Layered but Linked).** Her katman ayrı beslenir ama ID referanslarıyla birbirine örülür (§0.4). Bir hata objesi → bir sürece → bir ekrana → bir iş kavramına → çözülmüş ticket kümesine bağlanır.
4. **Kanıt-öncelikli (Provenance-first).** Her bilgi parçası nereden geldiğini (doküman/ticket/release note/dictionary) ve güven düzeyini taşır. AI "uydurmaz", **kaynak gösterir** (§9).
5. **Kanaldan bağımsız (Channel-agnostic).** Model hiçbir kanala özel değildir. Aynı obje L1 ekranında "çözüm adımı", WhatsApp'ta "kısa yanıt", RCA'da "kök neden düğümü" olur.

### 0.2 Katman haritası
```
        ┌───────────────────────────────────────────────┐
        │        KNOWLEDGE OBJECT MODEL  (§7)            │  ← birleştirici obje
        │   tüm katmanları tek şemada bağlar             │
        └───────────────────────────────────────────────┘
              ▲        ▲        ▲        ▲        ▲       ▲
   ┌──────────┴─┐ ┌────┴───┐ ┌──┴────┐ ┌─┴─────┐ ┌┴─────┐ ┌┴──────┐
   │ Business   │ │  UI    │ │Process│ │ Error │ │Version│ │ Case  │
   │ Ontology   │ │Ontology│ │Ontol. │ │Ontol. │ │Ontol. │ │Ontol. │
   │  (§1)      │ │  (§2)  │ │ (§3)  │ │ (§4)  │ │ (§5)  │ │ (§6)  │
   └────────────┘ └────────┘ └───────┘ └───────┘ └───────┘ └───────┘
              ▲
   ┌──────────┴──────────────────────────────────────────┐
   │  GİZLİ EŞLEME KATMANI (Data Dictionary — sadece      │
   │  tool-calling; kullanıcıya asla görünmez)            │
   └──────────────────────────────────────────────────────┘
```

### 0.3 Kaynak → Katman besleme matrisi
| Veri kaynağı | Business | UI | Process | Error | Version | Case |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| 1. Kullanım dokümanları | ●●● | ●●● | ●●● | ● | | ● |
| 2. Versiyon fark dok. (8.16–8.31) | ● | ● | ● | ● | ●●● | |
| 3. Çözülmüş ticketlar (~5700) | ● | ● | ●● | ●●● | ● | ●●● |
| 4. Database Data Dictionary | ●● (gizli map) | ● | ● | | | |
| 5. (ileride) UI ekran görüntüleri | | ●●● | ●● | ● | | |

`●●●` birincil kaynak · `●` zenginleştirici. Bu matris ingestion pipeline'ının hangi kaynaktan hangi objeyi ürettiğini belirler.

### 0.4 Kimlik ve referans sistemi (tüm katmanları örer)
Her obje **namespace'li stabil ID** taşır — insan-okur, versiyonlanabilir:
```
BIZ.satis-faturasi          UI.satis.siparis-ekrani        PROC.siparisten-faturaya
ERR.kayit-yapilamiyor       VER.8.24                        CASE.belgelestirme-yetki
PARAM.otomatik-belgelestir  TBL.fatura-basligi (gizli)
```
Objeler birbirine **tiplenmiş ilişkilerle** bağlanır (yön önemlidir):
| İlişki | Anlam | Örnek |
|---|---|---|
| `parent_of` / `child_of` | hiyerarşi | Cari → Müşteri |
| `related_to` | zayıf ilişki | İskonto ↔ Promosyon |
| `precedes` / `follows` | süreç sırası | Sipariş → İrsaliye |
| `triggers` | tetikler | Belgeleştir → E-İrsaliye |
| `occurs_in` | nerede yaşar | Hata → Ekran |
| `resolves` | çözer | Çözüm adımı → Hata |
| `introduced_in` / `changed_in` / `removed_in` | sürüm yaşam döngüsü | Belgeleştir → 8.24 |
| `manifests_as` | belirti | İş kavramı → Kullanıcı ifadesi |
| `governed_by` | kural/parametre | Belgeleştir → Otomatik belgeleştirme parametresi |

Bu ilişki sözlüğü sabittir; yeni ilişki eklemek yönetişim kararı gerektirir (§9).

---

## 1. Business Ontology — İş Kavramları

**Amaç.** Panorama'nın konuştuğu tüm iş kavramlarını (Sipariş, İrsaliye, Tahsilat, Cari, Rota…) tek bir anlam ağı olarak tanımlamak. Bu, AI'ın "kelime"yi değil **kavramı** anlamasını sağlar.

**Neden gerekli.** Kullanıcı "cari bakiye tutmuyor" dediğinde AI'ın *Cari = Müşteri'nin finansal yüzü* olduğunu, Tahsilat ve Fatura ile ilişkili olduğunu bilmesi gerekir. Kavram ağı olmadan RAG yalnızca kelime eşleştirir; ontoloji ile **anlam üzerinden** gezinir.

**Kaynak.** Birincil: kullanım dokümanları. Zenginleştirme: ticket dili (kullanıcının kavramı nasıl adlandırdığı) + Data Dictionary (gizli tablo eşlemesi).

**AI nasıl kullanır.** (a) Kullanıcı ifadesini doğru kavrama *bağlar* (intent grounding). (b) İlişkili kavramları getirerek bağlamı genişletir. (c) Tool Calling'de kavramı gizli tabloya çevirir ("müşteri bakiyesi" → doğru sorgu).

### Kavram şeması (her iş kavramı için)
```
id · entity (iş adı) · module · aliases[] · description
parent · children[] · related_entities[] · lifecycle_state (aktif/kaldırıldı)
user_phrasings[]  (kullanıcının dediği haller)
technical_anchor  (gizli: hangi belge/kavram tabloya karşılık gelir)
```

### Modül taksonomisi (kavramların üst kırılımı)
`Satış · Sipariş Yönetimi · Sevkiyat/Lojistik · Faturalama · Finans/Cari · Stok · Ürün & Fiyat · İndirim/Kampanya · Saha Satış (SFA) · Servis/Teknik Servis · Sözleşme/Kontrat · CRM · Raporlama (Panorama) · Kullanıcı & Yetki · Parametre & Sistem · E-Belge/Entegrasyon`

### Örnek kavram objeleri (özet)
| Kavram | Modül | Alias | Parent | İlişkili |
|---|---|---|---|---|
| **Satış Siparişi** | Sipariş | Sipariş, order | — | İrsaliye, Fatura, Müşteri, Ürün, Fiyat Listesi |
| **Belgeleştir** | Sipariş/Sevkiyat | Belgeleştirme, belge kesme | *(aksiyon-kavram)* | Sipariş→İrsaliye/Fatura, Parametre, Yetki |
| **İrsaliye** | Sevkiyat | Sevk belgesi, dispatch | — | Sipariş, E-İrsaliye, Fatura |
| **E-İrsaliye / E-Fatura** | E-Belge | e-belge, GİB | İrsaliye/Fatura | Entegrasyon, Fatura |
| **Satış Faturası** | Faturalama | Fatura | — | İrsaliye, Tahsilat, Cari |
| **Tahsilat** | Finans | Ödeme, collection | — | Fatura, Cari, Çek/Senet |
| **Cari** | Finans | Cari hesap, bakiye | Müşteri (finansal yüz) | Tahsilat, Fatura, İade |
| **İade** | Satış/Sevkiyat | Return, mal iadesi | — | Fatura, Stok, Claim |
| **Müşteri (Müşteri Kartı)** | CRM | Nokta, müşteri, bayi | — | Cari, Rota, Ziyaret, Dist |
| **Distribütör** | Organizasyon | Dist, dağıtıcı | — | Müşteri, Bölge, Depo |
| **Bayi** | Organizasyon | Tali bayi, alt bayi | Distribütör | STG, Müşteri |
| **Ürün** | Ürün & Fiyat | SKU, malzeme | — | Fiyat Listesi, İskonto, Marka, Stok |
| **Fiyat Listesi** | Ürün & Fiyat | Fiyat, pricing | — | Ürün, İskonto, Sözleşme |
| **İskonto** | İndirim | İndirim, discount | — | Promosyon, Fiyat Listesi, Kampanya |
| **Promosyon / Kampanya** | İndirim | Promo, kampanya | — | İskonto, Claim, STG |
| **STG** | Saha/Ticaret | Sekonder satış, sell-through | — | Bayi, Promosyon, Claim |
| **Claim** | Finans/Ticaret | Hakediş, prim talebi | — | Promosyon, İade, Cari |
| **Rota** | Saha Satış | Route, gezi planı | — | Ziyaret, Temsilci, Müşteri |
| **Ziyaret** | Saha Satış | Visit, uğrama | — | Rota, Sipariş, Temsilci |
| **Servis / Teknik Servis** | Servis | Arıza, bakım | — | İş Emri, Kontrat, Ürün |
| **İş Emri** | Servis | Work order | Servis | Teknik Servis, Personel |
| **Kontrat / Sözleşme** | Sözleşme | Anlaşma, contract | — | Fiyat Listesi, Servis, Müşteri |

> Not: Kavramlar canlı listedir; ~%80'i dokümanlardan, kalanı ticket dilinden türetilir. Her kavrama **user_phrasings** (kullanıcının kullandığı yanlış/argo ifadeler dahil) eklenir — Case & Error ontolojisinin bağlanma noktası budur.

---

## 2. UI Ontology — Ekran Modeli

**Amaç.** Panorama'nın ekran/menü/sekme/buton/alan/işlem hiyerarşisini modellemek. "Nerede yapılır?" sorusunun cevabı.

**Neden gerekli.** Destek biletlerinin çoğu *yer* problemidir: "Bu ekranı bulamıyorum", "Belgeleştir butonu gri". AI çözümü anlatırken kullanıcıyı **doğru ekrana, doğru sekmeye, doğru butona** yönlendirebilmelidir. Ayrıca ileride ekran görüntüleri (kaynak 5) bu ontolojiye demirlenir.

**Kaynak.** Kullanım dokümanları (ekran adları, menü yolları) + ileride UI ekran görüntüleri (visual grounding). Ticketlar hangi ekranın sorunlu olduğunu söyler.

**AI nasıl kullanır.** (a) "Navigasyon yanıtı" üretir: `Satış > Siparişler > [Belgeleştir]`. (b) Ekran görüntüsü geldiğinde nesneyi tanır (screen anchoring). (c) Hata objesini `occurs_in` ile ekrana bağlar.

### UI hiyerarşi tipleri
```
Screen (ekran)
  ├─ Menu Path (menü yolu)      ör. Satış > Siparişler
  ├─ Tab (sekme)                ör. Genel / Kalemler / Ödeme
  ├─ Field (alan)               ör. Vade Tarihi, İskonto %
  ├─ Action (buton/işlem)       ör. Kaydet, Belgeleştir, İptal
  └─ State (durum)              ör. buton pasif/gri, alan zorunlu
```
Her UI objesi: `id · screen_name · menu_path · parent_screen · tabs[] · key_actions[] · related_business_entities[] · related_processes[] · known_issues[]`.

**İş akışı görünümü (kullanıcının gördüğü yolculuk):**
```
Satış  →  Sipariş  →  Belgeleştir  →  Fatura  →  Tahsilat
(ekranlar arası köprü; her ok bir Action + bir Process adımına bağlanır)
```

**Örnek UI objesi (özet):** `UI.satis.siparis-ekrani` — Menü: Satış > Siparişler · Sekmeler: Genel, Kalemler, İskonto, Ödeme · Aksiyonlar: Kaydet, **Belgeleştir**, İptal, Kopyala · İlişkili kavram: Satış Siparişi · İlişkili süreç: `PROC.siparisten-faturaya` · Bilinen sorun: "Belgeleştir gri" → `ERR.belgelestir-pasif`.

---

## 3. Process Ontology — İş Süreçleri

**Amaç.** Uçtan uca iş akışlarını adım-adım modellemek. "Hangi sırayla yapılır?"

**Neden gerekli.** Panorama sorunlarının çoğu **akış** sorunudur — bir adım atlanır, ön koşul sağlanmaz. AI'ın "önce irsaliye kesilmeli, sonra fatura" gibi sıralı mantığı bilmesi; hem rehberlik hem kök-neden analizi için şarttır.

**Kaynak.** Kullanım dokümanları (resmi akış) + ticketlar (gerçekte nerede takılıyor) + versiyon notları (akışın hangi sürümde değiştiği).

**AI nasıl kullanır.** (a) Adım-adım rehber üretir. (b) Kullanıcının hangi adımda takıldığını tespit eder (stage detection). (c) RCA'da "ön koşul sağlanmamış" hipotezini kurar. (d) Tool Calling'de bir sonraki adımın koşulunu doğrular.

### Süreç şeması
```
id · process_name · trigger · steps[ {sıra, adım, ekran, ön_koşul, çıktı, olası_hata} ]
  · variants[] (e-belge açık/kapalı gibi)  · governed_by_parameters[]  · related_entities[]
```

### Örnek süreç: `PROC.siparisten-faturaya`
```
Sipariş  →  Belgeleştir  →  İrsaliye  →  E-İrsaliye  →  Fatura  →  Tahsilat
```
| # | Adım | Ekran | Ön koşul | Olası hata |
|---|---|---|---|---|
| 1 | Sipariş oluştur | Satış > Sipariş | Müşteri aktif, fiyat listesi var | Fiyat bulunamadı |
| 2 | **Belgeleştir** | Sipariş | Yetki + stok + parametre | "Kayıt yapılamıyor" |
| 3 | İrsaliye | Sevkiyat | Belgeleşmiş sipariş | Stok yetersiz |
| 4 | E-İrsaliye | E-Belge | Entegrasyon açık, mükellef | GİB reddi |
| 5 | Fatura | Faturalama | İrsaliye onaylı | Vade/tutar hatası |
| 6 | Tahsilat | Finans | Fatura kesilmiş | Cari kapanmıyor |

**Diğer süreç aileleri (aynı şablonla çıkarılır):** İade süreci, Promosyon/Claim hakediş süreci, Saha satış (Rota→Ziyaret→Sipariş), Servis (Talep→İş Emri→Kapanış), Cari mutabakat, Fiyat/İskonto tanımlama, Kullanıcı & yetki tanımlama, E-belge kurulum.

---

## 4. Error Ontology — Hata / Belirti Modeli

**Amaç.** Belirtiyi (kullanıcı ifadesi) → olası nedenlere → çözüme bağlamak. Semptom-tabanlı teşhis ağı.

**Neden gerekli.** Kullanıcı teknik dille konuşmaz: *"Kayıt yapılamıyor", "buton çalışmıyor", "sistem hata verdi"*. Aynı belirtinin 5 farklı kök nedeni olabilir (yetki / parametre / stok / entegrasyon / veri). AI'ın belirti→neden ayrımını yapabilmesi teşhisin kalbidir.

**Kaynak.** Birincil: ticketlar (gerçek belirti dili + gerçek çözüm). Zenginleştirme: dokümanlardaki hata mesajları, versiyon notlarındaki düzeltmeler.

**AI nasıl kullanır.** (a) Serbest metni bir hata objesine sınıflar. (b) Kök-neden dallarını olasılıkla sıralar. (c) Ekran/süreç/parametre bağlamıyla nedeni daraltır. (d) Çözüm adımlarını (resolution_steps) verir. (e) Çözülemezse Ticket Generation'a yapılandırılmış özet üretir.

### Hata şeması (semptom → neden → çözüm ağacı)
```
id · symptom (kullanıcı ifadesi) · symptom_variants[] · technical_signals[] (log/kod)
occurs_in (ekran/süreç) · possible_root_causes[ {neden, olasılık, ayırt_edici_soru, kontrol} ]
resolution_steps[] · related_parameters[] · related_cases[] · fixed_in_version?
```

### Örnek: `ERR.kayit-yapilamiyor`
```
Belirti: "Kayıt yapılamıyor" / "kaydetmiyor" / "belgeleşmiyor"
occurs_in: Sipariş > Belgeleştir
Olası kök nedenler (ayırt edici soru → kontrol):
  1) Yetki        → "hangi kullanıcı?"          → rol/yetki kontrolü
  2) Parametre    → "otomatik belgeleştirme?"   → ilgili parametre
  3) Stok         → "stok var mı?"              → depo bakiyesi
  4) Ön koşul     → "sipariş onaylı mı?"        → süreç adımı 2
  5) Entegrasyon  → "e-belge mi?"               → GİB/servis durumu
→ resolution_steps: her dal için sıralı adım
```
Bu, kullanıcının verdiği örnekteki `"Kayıt yapılamıyor" → Yetki/Belgeleştir/Parametre → Çözüm` zincirinin formalize halidir.

---

## 5. Version Ontology — Sürüm Zaman Çizelgesi

**Amaç.** Özelliklerin hangi sürümde eklendiğini/değiştiğini/kaldırıldığını izlemek (8.16 → 8.31).

**Neden gerekli.** Destekte kritik bağlam: *"Sizde hangi sürüm var?"* Bir özellik 8.24'te geldiyse, 8.20 kullanan müşteriye "yok" demek gerekir; bir hata 8.27'de düzeldiyse "güncelleyin" demek çözümdür. Sürüm-farkındalığı yanlış tavsiyeyi engeller.

**Kaynak.** Birincil: versiyon fark dokümanları. Zenginleştirme: ticketlarda geçen "şu sürümde düzeldi" bilgisi.

**AI nasıl kullanır.** (a) Cevabı kullanıcının sürümüne göre koşullar (version-gating). (b) "Bu 8.24'te geldi, sizde X var" der. (c) Bir hatanın çözümü "güncelleme" ise onu önerir. (d) RCA'da "sürüm-kaynaklı" hipotezi ekler.

### Sürüm şeması
```
VER.<x.y> · release_date · summary
changes[ {tip: added|changed|removed|fixed, entity/feature, açıklama, related_error?} ]
```
### Örnek ilişki
```
Belgeleştir  ──introduced_in──▶  8.24 (Desteklendi)
E-İrsaliye toplu  ──changed_in──▶  8.29
"Kayıt yapılamıyor (stok)" ──fixed_in──▶  8.27
```
Her iş kavramı/özellik `introduced_in / changed_in / removed_in` bağıyla sürüme demirlenir; böylece Business & Error ontolojisi zaman-farkında olur.

---

## 6. Case Ontology — Ticket Intent Modeli

**Amaç.** ~5700 çözülmüş ticketı, aynı problemi anlatan kümelere indirgeyip her küme için **tek bir kanonik bilgi objesi** üretmek.

**Neden gerekli.** 350 farklı "belgeleştirme" ticketı = 1 tekrarlayan problem. Ham ticket aranabilir ama *öğretmez*. Kümeleme ile: en sık sorunlar, en iyi çözümler, tipik ifade varyasyonları ortaya çıkar. Bu, hem Case Retrieval'ın hem "self-service" cevaplarının temelidir.

**Kaynak.** Birincil: 5700 ticket. Bağlanma: her küme bir Business kavramına, bir Error objesine, bir Process adımına ve (varsa) bir sürüme demirlenir.

**AI nasıl kullanır.** (a) Yeni soruyu en yakın kanonik case'e eşler (case retrieval). (b) Kanıtlanmış çözümü önerir ("bu 350 vakada işe yaradı"). (c) Kümenin çözülme oranı/eskalasyon paternini L1 Assist'e sinyal verir. (d) Boşlukları (çözümsüz kümeler) yönetime raporlar.

### Case (kanonik) şeması
```
id · intent (kanonik başlık) · cluster_size · representative_phrasings[]
maps_to_error · maps_to_process_step · maps_to_business_entity
canonical_resolution[] · resolution_success_rate · escalation_pattern
variants[] (nadir alt-durumlar) · open_gap? (çözüm netleşmemişse)
```
### Kümeleme yaklaşımı (kavramsal — kod değil)
1. **Sinyal çıkarımı:** her tickettan belirti ifadesi + ekran + çözüm + sürüm.
2. **Anlamsal gruplama:** yakın ifadeleri intent'e topla (embedding tabanlı, offline).
3. **Kanonikleştirme:** kümeye tek başlık + en iyi çözüm + ifade varyantları.
4. **Bağlama:** Error/Process/Business/Version objelerine link.
5. **Sağlık metriği:** çözüm başarı oranı, tekrar açılma, eskalasyon.
### Örnek
```
CASE.belgelestirme-yetki
  intent: "Belgeleştirme yapılamıyor (yetki)"   cluster_size: ~180
  maps_to_error: ERR.kayit-yapilamiyor (dal: Yetki)
  maps_to_process_step: PROC.siparisten-faturaya #2
  canonical_resolution: [rol kontrolü, yetki tanımı, yeniden dene]
  success_rate: yüksek   escalation_pattern: düşük
```

---

## 7. Knowledge Object Model — Birleştirici Obje

**Amaç.** Altı ontolojiyi tek, standart bir obje formatında birleştirmek. RAG, Case Retrieval ve Tool Calling **aynı objeyi** okur; her biri ilgilendiği alanı kullanır.

**Neden gerekli.** Ayrı silolar entegrasyon borcu yaratır. Tek şema: (a) çapraz-katman gezinmeyi, (b) tek retrieval hattını, (c) tutarlı kanıt/güven modelini mümkün kılar.

**AI nasıl kullanır.** Bir sorgu geldiğinde ilgili Knowledge Object(ler) getirilir; **RAG** `description/related_documents`'ı, **Case Retrieval** `related_cases`'i, **Tool Calling** `related_tables/related_parameters`'ı, **RCA** `possible_root_causes → resolution_steps`'i kullanır. Hepsi tek objeden beslenir.

### Standart obje (kullanıcının verdiği şablonun genişletilmiş, enterprise hali)
```yaml
id:                    # BIZ./UI./PROC./ERR./VER./CASE. namespace'li stabil ID
entity:                # iş adı (kullanıcı dili) — ör. "Belgeleştir"
object_type:           # business | ui | process | error | version | case
module:                # Satış / Finans / Sevkiyat ...
aliases:               # eş anlamlılar + kullanıcı argo ifadeleri
user_phrasings:        # gerçek kullanıcı cümleleri (ticketlardan)
description:           # iş-dili tanım (asla tablo adı geçmez)
keywords:              # retrieval için anahtar kelimeler
lifecycle_state:       # aktif | değişti | kaldırıldı
# --- İLİŞKİLER (tiplenmiş, §0.4) ---
related_entities:      # diğer iş kavramları
related_ui_locations:  # ekran/menü/buton
related_processes:     # süreç + adım no
related_documents:     # doküman referansları (RAG anchor)
related_versions:      # introduced/changed/fixed_in
related_cases:         # kanonik ticket kümeleri
common_errors:         # bağlı hata objeleri
# --- TEŞHİS / AKSİYON ---
business_rules:        # iş kuralları (ön koşul, kısıt)
possible_root_causes:  # {neden, olasılık, ayırt_edici_soru}
resolution_steps:      # sıralı çözüm
related_parameters:    # sistem parametreleri (yarı-gizli)
# --- GİZLİ TOOL-CALLING KATMANI (kullanıcıya asla gösterilmez) ---
related_tables:        # Data Dictionary eşlemesi — yalnız sorgu üretimi için
query_hints:           # hangi filtre/join (ör. aktif kayıt kuralı)
# --- KANIT / YÖNETİŞİM ---
confidence_sources:    # [{source_type, ref, confidence}]
provenance:            # doküman/ticket/release/dictionary
last_reviewed:         # tarih + gözden geçiren
status:                # draft | verified | needs_review
```

### İki dünyanın tek objede buluşması (dil sınırı)
```
YÜZEY (kullanıcıya):   entity, description, resolution_steps, aliases  → "Müşteri Kartı"
ARKA PLAN (makineye):  related_tables, query_hints, related_parameters → gizli eşleme
```
`related_tables` alanı **Data Dictionary'ye köprüdür** — tablo/kolon adları burada, sadece Tool Calling motoru için durur; hiçbir yanıt metnine sızmaz.

---

## 8. AI Tüketim Mimarisi — Ortak Katmanın Kanallara Hizmeti

Tek Knowledge Object modeli, dört tüketiciyi de besler:

| Tüketici | Hangi alanları okur | Ne üretir |
|---|---|---|
| **RAG / Web Chat / WhatsApp** | description, related_documents, resolution_steps, aliases | İş-dili yanıt + kaynak |
| **Case Retrieval** | related_cases, user_phrasings, canonical_resolution | "Bu daha önce böyle çözüldü" |
| **L1 Agent Assist** | possible_root_causes, ayırt edici sorular, escalation_pattern | Ajana teşhis rehberi |
| **Ticket Generation** | entity, occurs_in, symptom, version | Yapılandırılmış bilet taslağı |
| **Root Cause Analysis** | process ön_koşullar, root_causes, related_parameters | Kök-neden hipotez ağacı |
| **Tool Calling** | related_tables, query_hints, related_parameters | Güvenli sorgu/aksiyon |

**Ortak retrieval hattı:** soru → intent grounding (Business) → ilgili objeler (ilişkilerle genişlet) → kanal-özel alanlar → yanıt + kanıt. Aynı obje, farklı yüzler.

---

## 9. Kanıt, Güven ve Yönetişim (Enterprise gereksinimleri)

- **Provenance zorunlu.** Her obje ve her çözüm adımı kaynağını taşır (doküman §, ticket ID, release note, dictionary). AI kaynaksız iddia üretmez; düşük güvende "emin değilim, eskale" der.
- **Güven skoru (confidence_sources).** Çok kaynaktan doğrulanan bilgi (doküman + 200 ticket + release note) yüksek; tek ticketa dayanan düşük güven taşır. Retrieval sıralaması ve "cevap ver / eskale et" eşiği buna bağlanır.
- **Bilginin kendi versiyonlaması.** Objeler `status: draft|verified|needs_review` + `last_reviewed` taşır. Panorama sürümü ilerledikçe (8.32…) objeler `needs_review` işaretlenir; insan doğrular.
- **Boşluk yönetimi.** `open_gap` işaretli case'ler ve kaynaksız kavramlar bir "bilgi borcu" listesi üretir — içerik ekibine geri besleme.
- **Dil sınırı denetimi.** Yayın öncesi kontrol: hiçbir yüzey alanında tablo/kolon/teknik kod geçmemeli. Bu, modelin kalite kapısıdır.
- **Değişmezler.** İlişki tipleri ve namespace'ler sabit sözlüktür; genişletme yönetişim kararıdır (kavram enflasyonunu önler).

---

## 10. Uygulama Yol Haritası (bilgi mimarisi kurulum sırası)

| Faz | İş | Çıktı |
|---|---|---|
| **F0** | Şema + ilişki sözlüğü + namespace'i dondur (§0, §7) | Knowledge Object standardı |
| **F1** | Business + UI ontolojisini dokümanlardan çıkar | Kavram + ekran omurgası |
| **F2** | Process ontolojisi + Data Dictionary gizli eşlemesi | Akışlar + tool-calling köprüsü |
| **F3** | Ticket kümeleme → Case + Error ontolojisi | Teşhis + kanonik çözümler |
| **F4** | Version ontolojisi ile zaman-farkındalık | Sürüm-koşullu cevaplar |
| **F5** | UI ekran görüntüleri ile visual grounding | Görsel demirleme |
| **F6** | Kanıt/güven/yönetişim + boşluk döngüsü | Sürdürülebilir AI Support Brain |

---

### Özet
Bu model, Panorama'yı **kavram düzeyinde** anlayan bir beyindir: kullanıcı iş diliyle konuşur, model içeride altı ontolojiyi tek objede birleştirir, teknik gerçekliği (tablolar/parametreler) yalnız gizli tool-calling katmanında tutar, ve her yanıtı kanıta bağlar. Tek katman; altı kanal; enterprise yönetişim.
