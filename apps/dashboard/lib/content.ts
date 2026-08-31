/**
 * İçerik override katmanı — demo admin panelinin düzenlediği UI metinleri.
 *
 * Her metin `t(map, key, fallback)` ile okunur: override varsa onu, yoksa
 * çağıranın verdiği varsayılanı (genelde config değeri) döndürür. Override'lar
 * tenant-bazlı bir JSON dosyada tutulur (runtime state, git-dışı).
 *
 * Server component'ler `getContentMap()` (senkron fs) ile okur; client tarafı
 * `ContentProvider` + `useContent()` ile aynı haritayı alır. Yazma: admin
 * server action (`app/actions/content.ts`).
 */
import fs from "node:fs";
import path from "node:path";

export type ContentMap = Record<string, string>;

/** Override dosyası yolu — cwd (apps/dashboard) altında, tenant bazlı. */
export function contentFilePath(): string {
  const tenant = process.env.TENANT || "default";
  return path.join(process.cwd(), ".content-overrides", `${tenant}.json`);
}

/** Override haritasını oku (senkron; yoksa boş). Server-only. */
export function getContentMap(): ContentMap {
  try {
    const raw = fs.readFileSync(contentFilePath(), "utf8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as ContentMap) : {};
  } catch {
    return {};
  }
}

/** Override haritasını yaz (merge; boş/null değer siler → varsayılana döner). */
export function writeContentMap(patch: Record<string, string | null>): ContentMap {
  const cur = getContentMap();
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete cur[k];
    else cur[k] = v;
  }
  const p = contentFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cur, null, 2), "utf8");
  return cur;
}

/** Override → fallback (config/varsayılan). Boş override yok sayılır. */
export function t(map: ContentMap | undefined, key: string, fallback: string): string {
  const v = map?.[key];
  return v != null && v !== "" ? v : fallback;
}

/** Genel server-side içerik çözücü — override varsa onu, yoksa def. */
export function cs(key: string, def: string): string {
  return t(getContentMap(), key, def);
}

// --- Panel (modül/kutu) yardımcıları — server component'ler için -------------
/** Panel başlığı override'ı (`<key>.title`), yoksa def. */
export function panelTitle(key: string, def: string): string {
  return t(getContentMap(), `${key}.title`, def);
}
/** Panel gizli mi (`<key>.hidden` === "1"). */
export function panelHidden(key: string): boolean {
  return getContentMap()[`${key}.hidden`] === "1";
}

// ---------------------------------------------------------------------------
// Admin registry — düzenlenebilir anahtarların bölüm/etiket/varsayılan tanımı.
// Admin paneli bunu gruplayarak render eder. `configBacked` olanların gerçek
// varsayılanı tenant config'ten gelir (admin bunu placeholder gösterir).
// ---------------------------------------------------------------------------
export type ContentField = {
  key: string;
  label: string;
  /** Varsayılan (free-text anahtarlar için). configBacked ise runtime'da config'ten gelir. */
  default?: string;
  /** Uzun metin (textarea) mi? */
  multiline?: boolean;
  /** Değeri config'ten gelen alan (marka adı, birim vb.) — admin config değerini placeholder gösterir. */
  configBacked?: boolean;
};
export type ContentSection = { title: string; fields: ContentField[] };

export const CONTENT_REGISTRY: ContentSection[] = [
  {
    title: "Marka & Genel",
    fields: [
      { key: "brand.productName", label: "Ürün / marka adı", configBacked: true },
      { key: "brand.logoMark", label: "Logo rozet harfleri (logo görseli yoksa)", configBacked: true },
    ],
  },
  {
    title: "Navigasyon Etiketleri",
    fields: [
      { key: "nav.ozet", label: "Özet", default: "Özet" },
      { key: "nav.cockpit", label: "Cockpit", default: "Cockpit" },
      { key: "nav.harita", label: "Harita", default: "Harita" },
      { key: "nav.yonetim", label: "Yönetim", default: "Yönetim" },
      { key: "nav.satis", label: "Satış", default: "Satış" },
      { key: "nav.segment", label: "Segment", default: "Segment" },
      { key: "nav.marka", label: "Marka", default: "Marka" },
      { key: "nav.stok", label: "Stok", default: "Stok" },
      { key: "nav.saha", label: "Saha", default: "Saha" },
      { key: "nav.risk", label: "Risk", default: "Risk" },
      { key: "nav.iskonto", label: "İskonto", default: "İskonto" },
    ],
  },
  {
    title: "Ekran Başlıkları",
    fields: [
      { key: "page.cockpit.title", label: "Cockpit başlığı", default: "Operasyon Genel Görünümü" },
      { key: "page.yonetim.title", label: "Yönetim başlığı", default: "Yönetim Kurulu" },
      { key: "page.satis.title", label: "Satış başlığı", default: "Satış Performansı" },
      { key: "page.segment.title", label: "Segment başlığı", default: "Müşteri Segmentasyon" },
      { key: "page.marka.title", label: "Marka başlığı", default: "Marka & SKU Performansı" },
      { key: "page.stok.title", label: "Stok başlığı", default: "Stok Tükenme" },
      { key: "page.saha.title", label: "Saha başlığı", default: "Distribütör & Saha Operasyon" },
      { key: "page.risk.title", label: "Risk başlığı", default: "Müşteri Aktivasyon & Risk" },
      { key: "page.iskonto.title", label: "İskonto başlığı", default: "Ticari Yatırım & İskonto" },
      { key: "page.ozet.title", label: "Özet sayfası başlığı (— Yönetim Paneli)", default: "Yönetim Paneli" },
    ],
  },
  {
    title: "KPI Kart Etiketleri",
    fields: [
      { key: "kpi.yonetim.ciro", label: "Yönetim · Toplam Net Ciro", default: "Toplam Net Ciro" },
      { key: "kpi.yonetim.aktif", label: "Yönetim · Aktif Müşteri", default: "Aktif Müşteri" },
      { key: "kpi.yonetim.konsantrasyon", label: "Yönetim · Top 10 Konsantrasyon", default: "Top 10 Konsantrasyon" },
      { key: "kpi.yonetim.stratejik", label: "Yönetim · Stratejik Marka Payı", default: "Stratejik Marka Payı" },
      { key: "kpi.satis.temsilci", label: "Satış · Top Temsilci Sayısı", default: "Top Temsilci Sayısı" },
      { key: "kpi.satis.yeni", label: "Satış · Yeni Müşteri (90g)", default: "Yeni Müşteri (90g)" },
      { key: "kpi.satis.sepet", label: "Satış · Güncel Ort. Sepet", default: "Güncel Ort. Sepet" },
      { key: "kpi.marka.ciro", label: "Marka · Toplam Net Ciro", default: "Toplam Net Ciro" },
      { key: "kpi.marka.aktif", label: "Marka · Aktif Müşteri", default: "Aktif Müşteri" },
      { key: "kpi.marka.top5", label: "Marka · Top 5 Marka Payı", default: "Top 5 Marka Payı" },
      { key: "kpi.marka.stratejik", label: "Marka · Stratejik Marka Payı", default: "Stratejik Marka Payı" },
      { key: "kpi.stok.kritik", label: "Stok · Kritik + Risk", default: "Kritik + Risk" },
      { key: "kpi.stok.tukenme", label: "Stok · İlk Tükenme", default: "İlk Tükenme" },
      { key: "kpi.stok.pozitif", label: "Stok · Pozitif Stok SKU", default: "Pozitif Stok SKU" },
      { key: "kpi.stok.devir", label: "Stok · Devir Hesaplanan", default: "Devir Hesaplanan" },
      { key: "kpi.saha.ziyaret", label: "Saha · Son 7g Ziyaret", default: "Son 7g Ziyaret" },
      { key: "kpi.saha.unique", label: "Saha · Unique Müşteri", default: "Unique Müşteri" },
      { key: "kpi.saha.aktiftemsilci", label: "Saha · Aktif Temsilci", default: "Aktif Temsilci" },
      { key: "kpi.saha.donusum", label: "Saha · Dönüşüm Oranı", default: "Dönüşüm Oranı" },
    ],
  },
  {
    title: "Ekran Açıklamaları (boşsa varsayılan uzun metin)",
    fields: [
      { key: "page.yonetim.desc", label: "Yönetim açıklaması", multiline: true, default: "Portföy sağlığı tek ekranda — Top müşteri konsantrasyonu, marka katkıları ve iskonto." },
      { key: "page.satis.desc", label: "Satış açıklaması", multiline: true, default: "Distribütör ve saha temsilcisi performansı — leaderboard, drop size, yeni müşteri." },
      { key: "page.segment.desc", label: "Segment açıklaması", multiline: true, default: "Müşteri Tipi, Ek Grubu ve segment kırılımları yan yana." },
      { key: "page.marka.desc", label: "Marka açıklaması", multiline: true, default: "Marka portföyü, SKU şampiyonları, penetrasyon ve stratejik marka zoom." },
      { key: "page.stok.desc", label: "Stok açıklaması", multiline: true, default: "SKU stoklarının kaç gün yeteceği, tahmini tükenme ve devir hızı." },
      { key: "page.saha.desc", label: "Saha açıklaması", multiline: true, default: "Günlük/haftalık ziyaret trendleri, kapsama ve sipariş dönüşümü." },
      { key: "page.risk.desc", label: "Risk açıklaması", multiline: true, default: "Aktif/sessiz ayrımı, stratejik marka sessizliği, yeniden kazanım hedefleri." },
      { key: "page.iskonto.desc", label: "İskonto açıklaması", multiline: true, default: "İskonto yatırımı uçtan uca: brüt→iskonto→net, trend, marka & müşteri ROI." },
    ],
  },
];

// Panel (modül/kutu) registry — admin panelinde ekran-ekran başlık + göster/gizle.
export type PanelDef = { key: string; defaultTitle: string };
export type PanelScreen = { screen: string; panels: PanelDef[] };
export const PANEL_REGISTRY: PanelScreen[] = [
  {
    screen: "Yönetim Kurulu",
    panels: [
      { key: "panel.yonetim.brands", defaultTitle: "Marka Katkıları" },
      { key: "panel.yonetim.topdist", defaultTitle: "Top Distribütör Analizi" },
    ],
  },
  {
    screen: "Satış Performansı",
    panels: [
      { key: "panel.satis.rep", defaultTitle: "Satış Temsilcisi Leaderboard" },
      { key: "panel.satis.drop", defaultTitle: "Drop Size (Nokta Başına Ciro)" },
      { key: "panel.satis.new", defaultTitle: "Yeni Müşteri Kazanımı" },
      { key: "panel.satis.avg", defaultTitle: "Ortalama Sipariş Büyüklüğü Trendi" },
    ],
  },
  {
    screen: "Marka & SKU",
    panels: [
      { key: "panel.marka.portfolio", defaultTitle: "Marka Portföyü" },
      { key: "panel.marka.topsku", defaultTitle: "Top 10 SKU" },
      { key: "panel.marka.penetration", defaultTitle: "Marka Penetrasyonu" },
    ],
  },
  {
    screen: "Saha Operasyon",
    panels: [
      { key: "panel.saha.daily", defaultTitle: "Günlük Ziyaret Trendi" },
      { key: "panel.saha.coverage", defaultTitle: "Aktif Müşteri Kapsama" },
      { key: "panel.saha.rep", defaultTitle: "Temsilci Performansı" },
      { key: "panel.saha.conversion", defaultTitle: "Ziyaret → Sipariş Dönüşümü" },
      { key: "panel.saha.distcompare", defaultTitle: "Distribütör Karşılaştırma" },
    ],
  },
  {
    screen: "Aktivasyon & Risk",
    panels: [
      { key: "panel.risk.active", defaultTitle: "90 Gün Aktif Müşteri" },
      { key: "panel.risk.silent", defaultTitle: "Sessizleşen Müşteriler" },
      { key: "panel.risk.strategic", defaultTitle: "Stratejik Marka Sessizliği" },
      { key: "panel.risk.tier", defaultTitle: "Risk Tier Dağılımı" },
      { key: "panel.risk.recovery", defaultTitle: "Yeniden Kazanım Fırsatları" },
    ],
  },
  {
    screen: "Müşteri Segmentasyon",
    panels: [
      { key: "panel.segment.eksaha", defaultTitle: "Müşteri Tipi" },
      { key: "panel.segment.ekgrup", defaultTitle: "Müşteri Ek Grubu" },
      { key: "panel.segment.cross", defaultTitle: "Müşteri Tipi × Marka" },
    ],
  },
  {
    screen: "Ticari Yatırım & İskonto",
    panels: [
      { key: "panel.iskonto.customer", defaultTitle: "Müşteri ROI · Top 20" },
      { key: "panel.iskonto.monthly", defaultTitle: "Aylık İskonto Trendi" },
      { key: "panel.iskonto.brand", defaultTitle: "Marka × İskonto Etkinliği" },
      { key: "panel.iskonto.segment", defaultTitle: "Segment Kırılımı" },
    ],
  },
  {
    screen: "Stok Tükenme",
    panels: [
      { key: "panel.stok.stockout", defaultTitle: "İlk Bitecek SKU'lar" },
      { key: "panel.stok.brandrisk", defaultTitle: "Marka Bazında Stok Riski" },
      { key: "panel.stok.quality", defaultTitle: "Veri Güveni" },
    ],
  },
];

// ---------------------------------------------------------------------------
// EKRAN-BAZLI admin modeli — her ekran kendi başlık/açıklama/KPI/modül grubunu
// taşır. Admin paneli sol menüden ekran seçer, sadece o ekranın alanları gelir.
// item.hideKey varsa aç/kapa toggle'ı gösterilir (KPI kartları + modüller).
// ---------------------------------------------------------------------------
export type AdminItem = {
  valueKey: string;
  label: string;
  default: string;
  hideKey?: string;
  multiline?: boolean;
  /** true → sadece aç/kapa toggle (ad değişimi desteklenmiyor). */
  toggleOnly?: boolean;
};
export type AdminGroup = { title: string; items: AdminItem[] };
export type AdminScreen = { id: string; name: string; groups: AdminGroup[] };

const kpiItem = (base: string, def: string): AdminItem => ({
  valueKey: base, label: def, default: def, hideKey: `${base}.hidden`,
});
const panelItem = (base: string, def: string): AdminItem => ({
  valueKey: `${base}.title`, label: def, default: def, hideKey: `${base}.hidden`,
});
const textItem = (key: string, label: string, def: string, multiline = false): AdminItem => ({
  valueKey: key, label, default: def, multiline,
});
const toggleItem = (base: string, label: string): AdminItem => ({
  valueKey: `${base}.title`, label, default: label, hideKey: `${base}.hidden`, toggleOnly: true,
});

export const ADMIN_SCREENS: AdminScreen[] = [
  {
    id: "genel", name: "Genel (marka + nav)",
    groups: [
      { title: "Marka", items: [
        textItem("brand.productName", "Ürün / marka adı", "Insider"),
        textItem("brand.logoMark", "Logo rozet harfleri", "FM"),
      ]},
      { title: "Navigasyon Etiketleri", items: [
        textItem("nav.ozet", "Özet", "Özet"),
        textItem("nav.cockpit", "Cockpit", "Cockpit"),
        textItem("nav.harita", "Harita", "Harita"),
        textItem("nav.yonetim", "Yönetim", "Yönetim"),
        textItem("nav.satis", "Satış", "Satış"),
        textItem("nav.segment", "Segment", "Segment"),
        textItem("nav.marka", "Marka", "Marka"),
        textItem("nav.stok", "Stok", "Stok"),
        textItem("nav.saha", "Saha", "Saha"),
        textItem("nav.risk", "Risk", "Risk"),
        textItem("nav.iskonto", "İskonto", "İskonto"),
      ]},
    ],
  },
  {
    id: "ozet", name: "Özet",
    groups: [{ title: "Başlık", items: [textItem("page.ozet.title", "Başlık (— öncesi kısım)", "Yönetim Paneli")] }],
  },
  {
    id: "cockpit", name: "Cockpit",
    groups: [
      { title: "Başlık", items: [textItem("page.cockpit.title", "Ekran başlığı", "Operasyon Genel Görünümü")] },
      { title: "KPI Kartları (aç/kapa + ad)", items: [
        panelItem("kpi.cockpit.hacim", "Toplam Hacim (70cl)"),
        panelItem("kpi.cockpit.ciro", "Toplam Net Ciro"),
        panelItem("kpi.cockpit.fatura", "Toplam Fatura"),
        panelItem("kpi.cockpit.top_marka", "Top Marka Payı"),
        panelItem("kpi.cockpit.musteri", "Aktif Satış Noktası"),
        panelItem("kpi.cockpit.sepet", "Ortalama Sepet"),
      ]},
      { title: "Modüller / Kutular (aç/kapa + ad)", items: [
        panelItem("panel.cockpit.kpistrip", "KPI Şeridi başlığı (Son 30 gün özet)"),
        panelItem("panel.cockpit.brief", "AI Yorum (Bu Sabahın Yorumu)"),
        toggleItem("panel.cockpit.map", "Bölge Haritası (Türkiye × YoY)"),
        panelItem("panel.cockpit.channelmonthly", "Kanal Mix · Son 12 Ay"),
        panelItem("panel.cockpit.channeltype", "Müşteri Tipi · Son 12 Ay"),
        toggleItem("panel.cockpit.calendar", "Takvim Hizalı Trend"),
        panelItem("panel.cockpit.matrix", "Ürün Grubu × Dönem Matris"),
        panelItem("panel.cockpit.heatmap", "Bölge × Ürün Grubu Heatmap"),
        panelItem("panel.cockpit.reps", "Top Satış Temsilcileri"),
        panelItem("panel.cockpit.dists", "Top Distribütörler"),
        panelItem("panel.cockpit.portfolio", "Ürün Grubu Portföyü"),
      ]},
    ],
  },
  {
    id: "yonetim", name: "Yönetim Kurulu",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.yonetim.title", "Ekran başlığı", "Yönetim Kurulu"),
        textItem("page.yonetim.desc", "Açıklama", "Portföy sağlığı tek ekranda.", true),
      ]},
      { title: "KPI Kartları (aç/kapa + ad)", items: [
        kpiItem("kpi.yonetim.ciro", "Toplam Net Ciro"),
        kpiItem("kpi.yonetim.aktif", "Aktif Müşteri"),
        kpiItem("kpi.yonetim.konsantrasyon", "Top 10 Konsantrasyon"),
        kpiItem("kpi.yonetim.stratejik", "Stratejik Marka Payı"),
      ]},
      { title: "Modüller / Kutular (aç/kapa + ad)", items: [
        panelItem("panel.yonetim.brands", "Marka Katkıları"),
        panelItem("panel.yonetim.topdist", "Top Distribütör Analizi"),
      ]},
    ],
  },
  {
    id: "satis", name: "Satış Performansı",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.satis.title", "Ekran başlığı", "Satış Performansı"),
        textItem("page.satis.desc", "Açıklama", "Distribütör ve saha temsilcisi performansı.", true),
      ]},
      { title: "KPI Kartları", items: [
        kpiItem("kpi.satis.temsilci", "Top Temsilci Sayısı"),
        kpiItem("kpi.satis.yeni", "Yeni Müşteri (90g)"),
        kpiItem("kpi.satis.sepet", "Güncel Ort. Sepet"),
      ]},
      { title: "Modüller / Kutular", items: [
        panelItem("panel.satis.rep", "Satış Temsilcisi Leaderboard"),
        panelItem("panel.satis.drop", "Drop Size (Nokta Başına Ciro)"),
        panelItem("panel.satis.new", "Yeni Müşteri Kazanımı"),
        panelItem("panel.satis.avg", "Ortalama Sipariş Büyüklüğü Trendi"),
      ]},
    ],
  },
  {
    id: "segment", name: "Müşteri Segmentasyon",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.segment.title", "Ekran başlığı", "Müşteri Segmentasyon"),
        textItem("page.segment.desc", "Açıklama", "Müşteri Tipi, Ek Grubu ve segment kırılımları.", true),
      ]},
      { title: "Modüller / Kutular", items: [
        panelItem("panel.segment.eksaha", "Müşteri Tipi"),
        panelItem("panel.segment.ekgrup", "Müşteri Ek Grubu"),
        panelItem("panel.segment.cross", "Müşteri Tipi × Marka"),
      ]},
    ],
  },
  {
    id: "marka", name: "Marka & SKU",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.marka.title", "Ekran başlığı", "Marka & SKU Performansı"),
        textItem("page.marka.desc", "Açıklama", "Marka portföyü, SKU şampiyonları, penetrasyon.", true),
      ]},
      { title: "KPI Kartları", items: [
        kpiItem("kpi.marka.ciro", "Toplam Net Ciro"),
        kpiItem("kpi.marka.aktif", "Aktif Müşteri"),
        kpiItem("kpi.marka.top5", "Top 5 Marka Payı"),
        kpiItem("kpi.marka.stratejik", "Stratejik Marka Payı"),
      ]},
      { title: "Modüller / Kutular", items: [
        panelItem("panel.marka.portfolio", "Marka Portföyü"),
        panelItem("panel.marka.topsku", "Top 10 SKU"),
        panelItem("panel.marka.penetration", "Marka Penetrasyonu"),
      ]},
    ],
  },
  {
    id: "stok", name: "Stok Tükenme",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.stok.title", "Ekran başlığı", "Stok Tükenme"),
        textItem("page.stok.desc", "Açıklama", "SKU stoklarının kaç gün yeteceği ve devir hızı.", true),
      ]},
      { title: "KPI Kartları", items: [
        kpiItem("kpi.stok.kritik", "Kritik + Risk"),
        kpiItem("kpi.stok.tukenme", "İlk Tükenme"),
        kpiItem("kpi.stok.pozitif", "Pozitif Stok SKU"),
        kpiItem("kpi.stok.devir", "Devir Hesaplanan"),
      ]},
      { title: "Modüller / Kutular", items: [
        panelItem("panel.stok.stockout", "İlk Bitecek SKU'lar"),
        panelItem("panel.stok.brandrisk", "Marka Bazında Stok Riski"),
        panelItem("panel.stok.quality", "Veri Güveni"),
      ]},
    ],
  },
  {
    id: "saha", name: "Saha Operasyon",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.saha.title", "Ekran başlığı", "Distribütör & Saha Operasyon"),
        textItem("page.saha.desc", "Açıklama", "Ziyaret trendleri, kapsama, sipariş dönüşümü.", true),
      ]},
      { title: "KPI Kartları", items: [
        kpiItem("kpi.saha.ziyaret", "Son 7g Ziyaret"),
        kpiItem("kpi.saha.unique", "Unique Müşteri"),
        kpiItem("kpi.saha.aktiftemsilci", "Aktif Temsilci"),
        kpiItem("kpi.saha.donusum", "Dönüşüm Oranı"),
      ]},
      { title: "Modüller / Kutular", items: [
        panelItem("panel.saha.daily", "Günlük Ziyaret Trendi"),
        panelItem("panel.saha.coverage", "Aktif Müşteri Kapsama"),
        panelItem("panel.saha.rep", "Temsilci Performansı"),
        panelItem("panel.saha.conversion", "Ziyaret → Sipariş Dönüşümü"),
        panelItem("panel.saha.distcompare", "Distribütör Karşılaştırma"),
      ]},
    ],
  },
  {
    id: "risk", name: "Aktivasyon & Risk",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.risk.title", "Ekran başlığı", "Müşteri Aktivasyon & Risk"),
        textItem("page.risk.desc", "Açıklama", "Aktif/sessiz ayrımı ve yeniden kazanım hedefleri.", true),
      ]},
      { title: "Modüller / Kutular", items: [
        panelItem("panel.risk.active", "90 Gün Aktif Müşteri"),
        panelItem("panel.risk.silent", "Sessizleşen Müşteriler"),
        panelItem("panel.risk.strategic", "Stratejik Marka Sessizliği"),
        panelItem("panel.risk.tier", "Risk Tier Dağılımı"),
        panelItem("panel.risk.recovery", "Yeniden Kazanım Fırsatları"),
      ]},
    ],
  },
  {
    id: "iskonto", name: "Ticari Yatırım & İskonto",
    groups: [
      { title: "Başlık & Açıklama", items: [
        textItem("page.iskonto.title", "Ekran başlığı", "Ticari Yatırım & İskonto"),
        textItem("page.iskonto.desc", "Açıklama", "İskonto yatırımı uçtan uca: trend, marka & müşteri ROI.", true),
      ]},
      { title: "Modüller / Kutular", items: [
        panelItem("panel.iskonto.customer", "Müşteri ROI · Top 20"),
        panelItem("panel.iskonto.monthly", "Aylık İskonto Trendi"),
        panelItem("panel.iskonto.brand", "Marka × İskonto Etkinliği"),
        panelItem("panel.iskonto.segment", "Segment Kırılımı"),
      ]},
    ],
  },
];

/** Registry'deki tüm anahtarların düz listesi (varsayılanlarıyla). */
export function registryDefaults(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of CONTENT_REGISTRY)
    for (const f of s.fields) if (f.default != null) out[f.key] = f.default;
  return out;
}
