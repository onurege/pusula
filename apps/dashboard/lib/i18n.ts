/**
 * Locale katmanı — demo dashboard için TR/EN dil seçimi.
 *
 * Mevcut içerik-override sistemine (`lib/content.ts`, tenant admin panelinin
 * yazdığı serbest metinler) DOKUNMAZ; onun yanına ayrı, hafif bir katman
 * olarak eklenir. Çağıran taraf iki sistemi kendi bağlamında birleştirir:
 * içerik override'ı varsa o kazanır (admin'in kasıtlı seçimi), yoksa bu
 * modül locale'e göre TR varsayılan ya da küratörlü EN karşılığı döner.
 *
 * Kapsam (Faz A dalga 1): navbar nav etiketleri + `/v3` landing.
 * Kapsam (Faz A dalga 2): `/v3` altındaki 8 demo dashboard'unun başlık,
 * bölüm/panel başlığı, KPI etiketi + alt-metni, boş-durum metni, kolon
 * başlığı + ortak bileşenler (Dönem filtresi, Birim toggle). Cockpit/Harita
 * ve kullanıcı-çipi bu turda kapsam dışı — TR'de kalır.
 *
 * Sözlükte olmayan anahtarlar için `t()` her zaman `trDefault`'u döner —
 * kapsam dışı ekranlar TR'de kalmaya devam eder, bozulmaz.
 *
 * İçerik override kompozisyonu: sayfalar zaten `cs(key, trDefault)` /
 * `panelTitle(key, trDefault)` (bkz. `lib/content.ts`) kullanıyorsa, o
 * çağrılar DEĞİŞTİRİLMEZ — yalnızca ikinci argüman `t(locale, key, trDefault)`
 * ile sarılır: `cs(key, t(locale, key, trDefault))`. Override varsa `cs()`
 * zaten onu döner (kazanır); yoksa `cs()`'in fallback'i artık locale'e göre
 * TR/EN olur. Böylece iki sistem birbirine dokunmadan bileşir.
 */

export type Locale = "tr" | "en";

export const LOCALE_COOKIE = "insider_locale";

/**
 * Server component bağlamında istek cookie'sinden locale oku (yoksa "tr").
 *
 * `lib/api.ts`'teki `readAuthToken()` ile aynı desen: `next/headers` DİNAMİK
 * import edilir + try/catch ile sarılır. Böylece bu dosya client component'
 * lerden (`useLocale`, navbar) de güvenle import edilebilir — "next/headers"
 * yalnızca gerçekten server'da çalışırken, çağrıldığı anda yüklenir; client
 * paketine statik olarak girmez.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(LOCALE_COOKIE)?.value === "en" ? "en" : "tr";
  } catch {
    return "tr";
  }
}

/**
 * Anahtar → küratörlü İngilizce karşılık. Türkçe metin burada TEKRARLANMAZ;
 * her çağrı zaten kendi TR varsayılanını taşır (bkz. `t()`), bu sözlük
 * yalnızca EN tarafını tutar.
 */
export const EN: Record<string, string> = {
  // --- Ortak: V3PageHeader (tüm V3 sayfaları) ---
  "v3.header.updated": "last updated",

  // --- Navbar — UserChip (rol etiketi + çıkış tooltip) ---
  "navbar.role_merkez": "HQ",
  "navbar.role_distributor": "Distributor",
  "navbar.logout": "Log out",

  // --- Navbar — V3 nav etiketleri (nav.* anahtarları içerik registry'siyle
  // aynı isim uzayını paylaşır; admin bu anahtarı override ederse o kazanır) ---
  "nav.ozet": "Summary",
  "nav.cockpit": "Cockpit",
  "nav.harita": "Map",
  "nav.yonetim": "Executive",
  "nav.satis": "Sales",
  "nav.segment": "Segment",
  "nav.marka": "Brand",
  "nav.stok": "Stock",
  "nav.saha": "Field",
  "nav.risk": "Risk",
  "nav.iskonto": "Discount",

  // --- /v3 landing (demo defaultLanding) ---
  "v3.landing.eyebrow": "V3 · Summary",
  "v3.landing.metaTitle": "V3 Summary",
  "page.ozet.title": "Executive Dashboard",
  "v3.landing.desc":
    "Eight dashboards, eight questions: executive summary, sales performance, customer segments, brand contribution, stock depletion, field operations, customer health, and trade investment. Each card opens its own page.",
  "v3.landing.badge.ready": "Ready",
  "v3.landing.badge.soon": "Coming soon",

  "v3.landing.card.yonetim.title": "Executive Board",
  "v3.landing.card.yonetim.desc":
    "Top 10/20/50 customers, brand contribution, discount KPIs. The CEO's morning view.",
  "v3.landing.card.satis.title": "Sales Performance",
  "v3.landing.card.satis.desc":
    "Distributor/team/rep performance, drop size, active + new customer acquisition.",
  "v3.landing.card.segment.title": "Customer Segmentation",
  "v3.landing.card.segment.desc":
    "Three segment dimensions side by side — channel x revenue x discount cross.",
  "v3.landing.card.marka.title": "Brand & SKU",
  "v3.landing.card.marka.desc":
    "Brand penetration, Top 5 SKUs, dedicated zoom panels for strategic brands.",
  "v3.landing.card.stok.title": "Stock Depletion",
  "v3.landing.card.stok.desc":
    "Days of stock remaining per SKU, projected stockout date, and 90-day volume turnover.",
  "v3.landing.card.saha.title": "Field Operations",
  "v3.landing.card.saha.desc":
    "Daily/weekly visit trends, coverage, and order conversion.",
  "v3.landing.card.risk.title": "Activation & Risk",
  "v3.landing.card.risk.desc":
    "Customers going dormant, strategic brand silence, win-back opportunities.",
  "v3.landing.card.iskonto.title": "Trade Investment & Discount",
  "v3.landing.card.iskonto.desc":
    "Discount spend, brand x effectiveness, customer/segment ROI.",

  // --- 8 V3 dashboard sayfa başlığı (page.*.title — content.ts registry
  // ile AYNI anahtar, cs() zaten fallback olarak bunu alır) ---
  "page.satis.title": "Sales Performance",
  "page.segment.title": "Customer Segmentation",
  "page.marka.title": "Brand & SKU Performance",
  "page.stok.title": "Stock Depletion",
  "page.saha.title": "Distributor & Field Operations",
  "page.risk.title": "Customer Activation & Risk",
  "page.iskonto.title": "Trade Investment & Discount",
  "page.yonetim.title": "Executive Board",

  // --- Ortak: GlobalDonemFilter (tüm 8 V3 ekranında) ---
  "donem.label": "Period",
  "donem.son30g": "Last 30d",
  "donem.mtd": "This Month",
  "donem.ytd": "This Year",
  "donem.q1": "Q1",
  "donem.q2": "Q2",
  "donem.q3": "Q3",
  "donem.serbest": "Custom",
  "donem.apply": "Apply",
  "donem.loading": "loading…",
  "donem.err_range": "Start date cannot be after end date.",
  "donem.from_aria": "Start date",
  "donem.to_aria": "End date",

  // --- Ortak: SatisUnitToggle (TL ↔ hacim) ---
  "unit.label": "Unit",
  "unit.tl_hint": "Revenue (net amount) view",

  // --- Satış Performansı ---
  "page.satis.eyebrow": "Dashboard 02",
  "page.satis.error": "Data unavailable:",
  "page.satis.error_hint": "Check VPN or verify the MSSQL connection.",
  "kpi.satis.topdist_hacim": "Top Distributor Volume",
  "kpi.satis.topdist_ciro": "Top Distributor Revenue",
  "kpi.satis.topdist_sub_perflist": "performance list",
  "kpi.satis.temsilci": "Top Rep Count",
  "kpi.satis.yeni": "New Customers (90d)",
  "kpi.satis.sepet": "Current Avg. Basket",
  "panel.satis.rep": "Sales Rep Leaderboard",
  "panel.satis.drop": "Drop Size (Revenue per Outlet)",
  "panel.satis.new": "New Customer Acquisition",
  "panel.satis.avg": "Average Order Size Trend",
  "panel.satis.velocity": "Sales Velocity",
  "panel.satis.distlb": "Distributor Leaderboard",
  "panel.satis.distlb_empty": "No invoice records found for the last 30d.",
  "panel.satis.distlb_sub": "Last 30d net revenue · {n} distributors · vs previous 30d delta",
  "col.ciro_30g": "Revenue (30d)",
  "col.fatura": "Invoice",
  "delta.new": "new",
  "delta.title": "%{pct} change vs previous 30 days",
  "col.temsilci": "Rep",
  "col.distributor": "Distributor",
  "col.bolge": "Region",
  "col.ciro": "Revenue",
  "col.musteri": "Customer",
  "col.ort_sepet": "Avg. Basket",
  "col.delta": "Δ",
  "col.pay": "Share",

  // --- Müşteri Segmentasyon ---
  "page.segment.eyebrow": "Dashboard 03",
  "page.segment.error": "Data unavailable:",
  "page.segment.error_hint": "Check VPN or verify the MSSQL connection.",
  "panel.segment.musterigrubu": "Customer Group",
  "panel.segment.eksaha": "Customer Type",
  "panel.segment.ekgrup": "Customer Sub-Group",
  "panel.segment.cross": "Customer Type × Brand",
  "panel.segment.iskonto": "Discount Breakdown — Sub-Group / Outlet",
  "seg.empty": "No data yet",
  "seg.empty_ekgrup": "No sub-groups defined yet",
  "seg.cross.empty": "Cross-segment data unavailable.",
  "seg.cross.col_musteritipi": "Customer Type",
  "seg.cross.col_tipavg": "Type Avg.",
  "col.musteri_th": "Customer",
  "col.ekgrup_th": "Sub-Group",
  "col.iskonto": "Discount",
  "col.oran": "Rate",
  "undefined_label": "(Undefined)",

  // --- Marka & SKU ---
  "page.marka.eyebrow": "Dashboard 04",
  "page.marka.error": "Data unavailable:",
  "page.marka.error_hint": "Check VPN or verify the MSSQL connection. An API restart may be required.",
  "kpi.marka.ciro": "Total Net Revenue",
  "kpi.marka.aktif": "Active Customers",
  "kpi.marka.top5": "Top 5 Brand Share",
  "kpi.marka.stratejik": "Strategic Brand Share",
  "marka.export": "Export to Excel",
  "marka.export_title": "Download the brand portfolio and Top SKU tables as CSV (opens directly in Excel)",
  "panel.marka.portfolio": "Brand Portfolio",
  "panel.marka.topsku": "Top 10 SKUs",
  "panel.marka.penetration": "Brand Penetration",
  "panel.marka.strategic": "Strategic Brand Zoom",
  "col.marka": "Brand",
  "col.sku": "SKU",
  "col.penetrasyon": "Penetration",

  // --- Stok Tükenme ---
  "page.stok.eyebrow": "Dashboard 08",
  "page.stok.error": "Data unavailable:",
  "page.stok.error_hint": "Check VPN or verify the MSSQL connection.",
  "kpi.stok.kritik": "Critical + Risk",
  "kpi.stok.tukenme": "First Stockout",
  "kpi.stok.pozitif": "SKUs With Stock",
  "kpi.stok.devir": "Turnover Computed",
  "panel.stok.stockout": "First SKUs to Run Out",
  "panel.stok.brandrisk": "Stock Risk by Brand",
  "panel.stok.quality": "Data Confidence",
  "col.kritik": "Critical",
  "col.risk": "Risk",
  "col.izle": "Watch",
  "col.saglikli": "Healthy",
  "col.stok": "Stock",
  "col.satis90g": "90d Sales",
  "col.ort_kalan": "Avg. Remaining",
  "stok.quality.signal": "SKU with stock movement signal",
  "stok.quality.zero": "SKU showing zero stock",
  "stok.quality.negative": "SKU showing negative stock",
  "stok.quality.unreliable": "SKU unreliable for turnover",
  "stok.quality.incoming": "SKU with open-order signal",
  "stok.quality.leadtime": "SKU with lead time configured",
  "stok.quality.nodemand": "SKU with no 90d sales",

  // --- Saha Operasyon ---
  "page.saha.eyebrow": "Dashboard 05",
  "page.saha.error": "Data unavailable:",
  "page.saha.error_hint": "Check VPN or verify the MSSQL connection.",
  "kpi.saha.ziyaret": "Last 7d Visits",
  "kpi.saha.unique": "Unique Customers",
  "kpi.saha.aktiftemsilci": "Active Reps",
  "kpi.saha.donusum": "Conversion Rate",
  "panel.saha.daily": "Daily Visit Trend",
  "panel.saha.coverage": "Active Customer Coverage",
  "panel.saha.rep": "Rep Performance",
  "panel.saha.conversion": "Visit → Order Conversion",
  "panel.saha.distcompare": "Distributor Comparison",
  "col.ziyaret": "Visits",
  "col.kapsama": "Coverage",

  // --- Aktivasyon & Risk ---
  "page.risk.eyebrow": "Dashboard 06",
  "page.risk.error": "Data unavailable:",
  "page.risk.error_hint": "Check VPN or verify the MSSQL connection.",
  "panel.risk.active": "90 Day Active Customers",
  "panel.risk.silent": "Customers Going Silent",
  "panel.risk.strategic": "Strategic Brand Silence",
  "panel.risk.tier": "Risk Tier Distribution",
  "panel.risk.recovery": "Win-Back Opportunities",

  // --- Ticari Yatırım & İskonto ---
  "page.iskonto.eyebrow": "Dashboard 07",
  "page.iskonto.error": "Data unavailable:",
  "page.iskonto.error_hint": "Check VPN or verify the MSSQL connection.",
  "panel.iskonto.customer": "Customer ROI · Top 20",
  "panel.iskonto.monthly": "Monthly Discount Trend",
  "panel.iskonto.brand": "Brand × Discount Effectiveness",
  "panel.iskonto.segment": "Segment Breakdown",
  "iskonto.kpi.title": "Discount Investment",
  "iskonto.kpi.sub": "Last 30d · Invoice header basis",
  "iskonto.kpi.status_good": "healthy",
  "iskonto.kpi.status_warn": "high — review",
  "iskonto.kpi.status_neutral": "sector average",
  "iskonto.kpi.brut": "Gross revenue",
  "iskonto.kpi.minus": "− Discount",
  "iskonto.kpi.net": "Net revenue",

  // --- Yönetim Kurulu ---
  "page.yonetim.eyebrow": "Dashboard 01",
  "page.yonetim.error": "Data unavailable:",
  "page.yonetim.error_hint": "Check VPN or verify the MSSQL connection.",
  "kpi.yonetim.ciro": "Total Net Revenue",
  "kpi.yonetim.aktif": "Active Customers",
  "kpi.yonetim.konsantrasyon": "Top 10 Concentration",
  "kpi.yonetim.stratejik": "Strategic Brand Share",
  "panel.yonetim.brands": "Brand Contributions",
  "panel.yonetim.topdist": "Top Distributor Analysis",

  // --- Global: WeeklyActionsDrawer (floating "Bu hafta" drawer, her ekranda) ---
  "weekly.trigger_aria": "This week's to-dos ({count})",
  "weekly.trigger_label": "This week",
  "weekly.title": "This week's to-dos",
  "weekly.subtitle": "Collect AI suggestions and finance agent actions here.",
  "weekly.close_aria": "Close",
  "weekly.footer_count": "{count} actions",
  "weekly.footer_storage": "stored in localStorage",
  "weekly.clear_all": "Clear all",
  "weekly.empty_title": "Nothing here yet.",
  "weekly.empty_desc":
    "Add finance agent suggestions from Cockpit or 14-day foresight actions from the customer modal here.",
  "weekly.source_finance": "Finance Agent",
  "weekly.source_manual": "Manual",
  "weekly.remove_aria": "Remove action",
  "weekly.confirm_clear": "Are you sure you want to delete all actions?",
  "weekly.time_now": "now",
  "weekly.time_min_ago": "{n}m ago",
  "weekly.time_hr_ago": "{n}h ago",
  "weekly.time_day_ago": "{n}d ago",

  // --- Komuta Köprüsü (Cockpit body — app/komuta/page.tsx canlı bölümleri) ---
  "komuta.all": "All",
  "komuta.brief.empty_sub": "The commentary is generated once during the nightly update (03:00) and stays the same all day. It will arrive automatically at the next update.",
  "komuta.brief.empty_title": "Today's AI commentary isn't ready yet.",
  "komuta.calendar.days_until": "{name} in {days} days",
  "komuta.calendar.eyebrow": "Calendar · This Year vs Last Year Aligned",
  "komuta.calendar.feb14": "Feb 14",
  "komuta.calendar.hint": "Last 12 months vs the same window 12 months ago. Source: TBLMSDFATURA SUM(DBLNETTUTAR), BYTTUR=0 AND BYTDURUM=0. Ramadan/Summer bands come from the calendar master; Today is the month of the last sync date.",
  "komuta.calendar.last_year": "Last Year",
  "komuta.calendar.new_year": "New Year's Day",
  "komuta.calendar.oct29": "Oct 29",
  "komuta.calendar.plan_cta": "View season plan →",
  "komuta.calendar.ramadan": "Ramadan",
  "komuta.calendar.summer_peak": "Summer Peak",
  "komuta.calendar.this_year": "This Year",
  "komuta.calendar.today": "Today",
  "komuta.calendar.upcoming_hint": "Last year's effect is in the Upcoming Season panel",
  "komuta.channelmix.category": "channel mix",
  "komuta.channelmix.empty": "{category} data isn't ready yet. Click",
  "komuta.channelmix.empty_cta": "Refresh data",
  "komuta.channelmix.empty_suffix": "at the top right to pull the last 12 months' monthly breakdown.",
  "komuta.channelmix.monthly_total": "{label} · Monthly Total",
  "komuta.channelmix.pie": "Pie",
  "komuta.channelmix.source_note": "Customer group (TBLMUSTERIGRUP.TXTAD) × month breakdown, last 12 months. Top 5 channels shown; the rest rolled into \"Other\".",
  "komuta.channelmix.title": "Channel Mix",
  "komuta.channelmix.total": "total",
  "komuta.channelmix.type_filter_default": "Customer Type",
  "komuta.channeltype.category": "group breakdown",
  "komuta.channeltype.filter_label": "Group Breakdown",
  "komuta.channeltype.source_note": "Customer group breakdown: Prestige / Premium Plus / Premium / Standart Plus / Standart distribution (TXTGRUPKIRILIMKOD), last 12 months.",
  "komuta.ctb.bottom_total": "Bottom Total",
  "komuta.ctb.empty": "No customer type × brand data.",
  "komuta.ctb.hint": "Last 30d · Top 8 brands (by revenue) + \"Other\" · unit: {unit} · bottom row is the total across all customer types.",
  "komuta.demo.badge": "Demo mode",
  "komuta.demo.hint": "Demo mode — sample data",
  "komuta.dists.empty": "No distributor data.",
  "komuta.fa.add_aria": "Add this analysis to the weekly action list",
  "komuta.fa.add_label": "📋 Add to actions",
  "komuta.fa.added_aria": "This analysis was added to the weekly action list",
  "komuta.fa.added_label": "✓ Added",
  "komuta.fa.ai_details_hint": "summary / root cause / action in finance language",
  "komuta.fa.ai_details_summary": "Gemini detailed analysis",
  "komuta.fa.chart.channel_title": "Customer Group Breakdown",
  "komuta.fa.chart.dist_title": "Distributor Breakdown",
  "komuta.fa.chart.last_year_30": "Last year, same 30d",
  "komuta.fa.chart.product_group_title": "Product Group Breakdown",
  "komuta.fa.chart.sku_title": "SKU Breakdown ({group})",
  "komuta.fa.chart.subtitle": "Last 30d (green = growing · red = declining) vs same 30d last year (gray) · revenue ₺",
  "komuta.fa.details_below": "· see the charts below for details.",
  "komuta.fa.error_title": "Analysis unavailable:",
  "komuta.fa.eyebrow": "Finance Agent · Regional Analysis",
  "komuta.fa.generated_at": "Generated",
  "komuta.fa.kind.customer_group": "customer group",
  "komuta.fa.kind.distributor": "distributor",
  "komuta.fa.kind.product_group": "product group",
  "komuta.fa.kpi.active_customers": "Active customers",
  "komuta.fa.kpi.last30": "Last 30d",
  "komuta.fa.kpi.last_year_30": "Last year, 30d",
  "komuta.fa.kpi.lost_customers": "Lost customers",
  "komuta.fa.kpi.lost_customers_base": "bought last year, not this year",
  "komuta.fa.kpi.net_revenue": "net revenue",
  "komuta.fa.kpi.same_window": "same window",
  "komuta.fa.kpi.this_vs_last_year": "this year / last year",
  "komuta.fa.launcher_hint": "Regional analysis with the Finance Agent · Paid content",
  "komuta.fa.loading": "Finance agent is working — decomposing regional data, then Gemini will generate commentary...",
  "komuta.fa.map_cta": "Show at-risk customers on the map",
  "komuta.fa.no_data": "No data",
  "komuta.fa.paid_content": "Paid content",
  "komuta.fa.picker_hint": "Anomalies (red) are on top. Click one to have the finance agent decompose YoY.",
  "komuta.fa.picker_title": "Choose a region to analyze",
  "komuta.fa.product_group_label": "Product group",
  "komuta.fa.reanalyze_hint": "Re-run analysis",
  "komuta.fa.refresh": "Refresh",
  "komuta.fa.scope.plain": "'s revenue",
  "komuta.fa.scope.with_product": "'s {group} product group revenue",
  "komuta.fa.title": "Finance Agent",
  "komuta.fa.trend.down": "dropped",
  "komuta.fa.trend.flat": "was flat",
  "komuta.fa.trend.up": "grew",
  "komuta.fa.unknown_error": "Unknown error.",
  "komuta.fa.weekly_action_reason": "Finance Agent root-cause analysis",
  "komuta.fa.weekly_action_text": "Root-cause analysis for the finance anomaly in {region} is complete; review at-risk customers on the map.",
  "komuta.filter.all_distributors": "All Distributors",
  "komuta.filter.group": "Group",
  "komuta.filter.product": "Product",
  "komuta.filter.product_group": "Product Group",
  "komuta.filter.region": "Region",
  "komuta.footer.reports": "UNIQUE AI Reports · Univera data source · last queried:",
  "komuta.footer.view": "View: CEO / Sales Director",
  "komuta.header.desc": "Univera Distributor Operations · CEO / Sales Director view",
  "komuta.header.last30": "Last 30 Days",
  "komuta.heatmap.cell_cta": "{region} × {group} — open finance analysis",
  "komuta.heatmap.col_region_avg": "Region Avg.",
  "komuta.heatmap.dist_count": "{n} distributors",
  "komuta.heatmap.meta": "Last 30d vs Last Year Same 30d",
  "komuta.hint.dists.base": "SUM(DBLNETTUTAR) per distributor + COUNT invoices",
  "komuta.hint.dists.note1": "Filter: f.BYTTUR=0, f.BYTDURUM=0, d.BYTDURUM=0",
  "komuta.hint.dists.note2": "Region label (TBLDISTEKGRUP.TXTAD) shown in the list row",
  "komuta.hint.dists.title": "Distributor ranking",
  "komuta.hint.heatmap.base": "SUM(DBLNETFIYAT × DBLMIKTAR) per region × group cell",
  "komuta.hint.heatmap.note1": "Top 8 regions × Top 8 groups + Other (by detail revenue total)",
  "komuta.hint.heatmap.note2": "yoyPct = (current − previous)/previous × 100; bucket class (fire/hot/warm/flat/cool/cold) from the Komuta CSS palette",
  "komuta.hint.heatmap.note3": "Only red (cool/cold) cells are clickable → Finance Agent modal",
  "komuta.hint.heatmap.title": "Heatmap YoY calculation",
  "komuta.hint.heatmap.window": "Last 30d vs -395..-365d (same window last year)",
  "komuta.hint.kpi.base": "SUM(DBLNETTUTAR) (Revenue), COUNT (Invoices), SUM(DBLMIKTAR × ek_saha_26) (Volume = 9L)",
  "komuta.hint.kpi.note1": "Filter: BYTTUR=0 AND BYTDURUM=0 (approved sales invoice)",
  "komuta.hint.kpi.note2": "9L multiplier: TBLURUNEKSAHA field 26 \"9 LT Value\" (Pernod's official coefficient; populated for 701 products)",
  "komuta.hint.kpi.note3": "Fallback (if the extra field is empty): falls back to the classic DBLLITRE / 9 calculation",
  "komuta.hint.kpi.note4": "In demo mode, GETDATE() calls are rewritten to the DEMO_DATE env value",
  "komuta.hint.kpi.source": "TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUNEKSAHA (for 9L)",
  "komuta.hint.kpi.title": "KPI calculation",
  "komuta.hint.kpi.window": "Last 30 days vs previous 30 days (delta % calc)",
  "komuta.hint.matrix.base": "SUM(DBLNETFIYAT × DBLMIKTAR) detail-based + normalized to invoice total via PeriodScales",
  "komuta.hint.matrix.note1": "Detail revenue differs from the invoice total by ~5-15%; the invoice/detail ratio (PeriodScales) is computed and applied per period",
  "komuta.hint.matrix.note2": "Don't add LNGDISTKOD=u.LNGDISTKOD to the TBLURUNGRUP join (both NULL → the JOIN comes up empty)",
  "komuta.hint.matrix.note3": "In Real TRY mode, the CPI multiplier is applied per period",
  "komuta.hint.matrix.note4": "Top 8 groups + \"Other\" (sum of the rest) + bottom \"Total\" row",
  "komuta.hint.matrix.title": "Matrix calculation",
  "komuta.hint.matrix.window": "5 periods: this month, last month, 3 months ago, same month last year, same month 2 years ago",
  "komuta.hint.portfolio.note1": "Tier classification (luxury/premium/core/value) by keyword match on the product group name",
  "komuta.hint.portfolio.note2": "yoyPct = (current − lastYear)/lastYear × 100",
  "komuta.hint.portfolio.note3": "twoYrPct = (current − twoYearsAgo)/twoYearsAgo × 100",
  "komuta.hint.portfolio.note4": "In Real TRY mode, base values are converted to today's TRY via the CPI multiplier",
  "komuta.hint.portfolio.title": "Portfolio calculation",
  "komuta.hint.portfolio.window": "3 periods: last 30d, same 30d last year (-395..-365d), same 30d 2 years ago (-760..-730d)",
  "komuta.hint.reps.base": "SUM(DBLNETTUTAR) per rep + COUNT invoices",
  "komuta.hint.reps.note1": "Filter: f.BYTTUR=0, f.BYTDURUM=0, s.BYTDURUM=0 (active rep)",
  "komuta.hint.reps.title": "Sales rep ranking",
  "komuta.hint.top10_desc": "Top 10; sorted by revenue DESC",
  "komuta.hint.window_30d": "Last 30 days",
  "komuta.infohint.base": "Base",
  "komuta.infohint.default_title": "How was this calculated?",
  "komuta.infohint.source": "Source",
  "komuta.infohint.sql_summary": "SQL summary",
  "komuta.infohint.window": "Window",
  "komuta.kpi.no_data": "KPI data unavailable.",
  "komuta.leaderboard.meta": "Last 30d · sorted by revenue",
  "komuta.map.city_count": "{n} cities: {list}{more}",
  "komuta.map.debug_summary": "City breakdown by region (debug · {n} classic regions)",
  "komuta.map.mapping_note": "City → region mapping",
  "komuta.map.mapping_note_suffix": "same master as the /map page.",
  "komuta.map.no_data": "no data",
  "komuta.map.polygon_hint": "Click a province polygon to go to /map",
  "komuta.map.regions_with_sales": "{n}/8 regions have sales",
  "komuta.map.title": "Turkey + TRNC · Region × YoY",
  "komuta.matrix.col_2yr_ago": "2 Years Ago",
  "komuta.matrix.col_3mo_ago": "3 Months Ago",
  "komuta.matrix.col_group": "Product Group",
  "komuta.matrix.col_last_month": "Last Month",
  "komuta.matrix.col_last_year": "Last Year",
  "komuta.matrix.col_this_month": "This Month",
  "komuta.matrix.col_this_month_sub": "last 30d",
  "komuta.matrix.col_trend": "Trend",
  "komuta.matrix.empty": "No product group data.",
  "komuta.matrix.meta": "Top 8 + Other + Total",
  "komuta.meta_title": "Cockpit",
  "komuta.metric.ciro": "Revenue",
  "komuta.metric.hacim": "Volume",
  "komuta.mode.nominal": "Nominal TRY",
  "komuta.mode.reel": "Real TRY",
  "komuta.periyot.label": "Period",
  "komuta.periyot.p12": "Last 12 Months",
  "komuta.periyot.p3": "Last 3 Months",
  "komuta.periyot.p6": "Last 6 Months",
  "komuta.periyot.ytd": "This Year",
  "komuta.portfolio.col_1yr_ago": "1 year ago",
  "komuta.portfolio.col_2yr_ago": "2 years ago",
  "komuta.portfolio.col_2yr_delta": "2yr Δ",
  "komuta.portfolio.col_last30": "Last 30d",
  "komuta.portfolio.empty": "No portfolio data.",
  "komuta.portfolio.meta": "Top 8 groups + Other",
  "komuta.reel.back_cta": "Back to Nominal TRY →",
  "komuta.reel.banner_desc": "Historical values were converted to today's money using the CPI multiplier.",
  "komuta.reel.banner_sub": "YoY and 2-year % values were recalculated on a real basis — inflation-adjusted true growth.",
  "komuta.reel.banner_title": "Real TRY view active",
  "komuta.reel.title_hint": "Converts historical values to today's money using the CPI multiplier",
  "komuta.reel.toggle_label": "Real TRY (CPI)",
  "komuta.reps.empty": "No rep data.",
  "komuta.time_day_ago": "{n}d ago",
  "komuta.time_hr_ago": "{n}h ago",
  "komuta.time_min_ago": "{n}m ago",
  "komuta.time_now": "just now",
  "komuta.unit.adet": "units",
  "komuta.unit.tl_hint": "All values in Turkish Lira",
  "komuta.unit.toggle_hint": "TL ↔ {unit} unit toggle. All Komuta calculations re-run based on the selected unit.",
  "komuta.unit_label": "Unit",
  "komuta.view_label": "View",
  "page.cockpit.title": "Operations Overview",
  "panel.cockpit.brief": "UNIQUE AI · This Morning's Take",
  "panel.cockpit.channelmonthly": "Channel Mix",
  "panel.cockpit.channeltype": "Customer Group Breakdown · Last 12 Months",
  "panel.cockpit.customertypebrand": "Customer Group Breakdown × Brand",
  "panel.cockpit.dists": "Top Distributors",
  "panel.cockpit.heatmap": "Region × Product Group · YoY Change Heatmap",
  "panel.cockpit.kpistrip": "Last 30 Days Summary",
  "panel.cockpit.matrix": "Product Group × Period",
  "panel.cockpit.portfolio": "Product Group Portfolio · 2-Year Trajectory",
  "panel.cockpit.reps": "Top Sales Reps",

  // --- Harita (Map body — components/map-page-body.tsx + map-specific bileşenler) ---
  "map.back_to_region": "Back to region view",
  "map.breadcrumb.cities": "Cities",
  "map.breadcrumb.customer_count": "{count} customers",
  "map.breadcrumb.region_view": "Region view",
  "map.breadcrumb.turkey": "Turkey",
  "map.city_insights.base_gt_1m": "base",
  "map.city_insights.no_urgent_action": "No urgent action",
  "map.city_insights.subtitle": "{n} cities · last 30d vs same 30d last year · sorted by absolute Δ TRY to surface the small-base effect",
  "map.city_insights.title": "city insights",
  "map.city_insights.top_growth": "Top growth",
  "map.city_insights.top_loss": "Top loss",
  "map.city_insights.urgent_action": "Urgent action",
  "map.city_insights.urgent_action_desc": "Urgent field visit — check for dealer/customer loss",
  "map.city_yoy_error_title": "City-level YoY data unavailable",
  "map.data_error": "Map data unavailable",
  "map.day_suffix": "d",
  "map.empty_db": "Local database is empty",
  "map.filters.all_cities": "All cities",
  "map.filters.all_distributors": "All distributors",
  "map.filters.city": "City",
  "map.filters.clear": "Clear",
  "map.filters.code": "Code",
  "map.filters.days_since_visit": "Days since visit",
  "map.filters.days_since_visit_n": "{n}+ days since visit",
  "map.filters.distributor": "Distributor",
  "map.filters.duration_any": "Any duration",
  "map.filters.insufficient_data": "Insufficient data",
  "map.filters.loading": "Loading…",
  "map.filters.no_match": "No matches.",
  "map.filters.revenue_last_n": "Revenue (last {days}d)",
  "map.filters.risk_level": "Risk level",
  "map.filters.sales_activity": "Sales activity ({days} days)",
  "map.filters.search": "Search",
  "map.filters.search_placeholder": "Name, customer code, or tracking code…",
  "map.filters.shown": "Shown",
  "map.filters.title": "Filters",
  "map.filters.tracking_code": "Tracking",
  "map.filters.with_sales": "Only with sales",
  "map.filters.without_sales": "Only silent customers",
  "map.hint": "one click = analyze · double-click = drill one level deeper",
  "map.loading": "Loading map…",
  "map.no_customers_for_filters": "No customers with coordinates match these filters.",
  "map.period_filter_aria": "Period filter",
  "map.period_filter_hint": "Last {d} days — revenue and activity metrics are calculated over this window",
  "map.province.new_sales": "new sales",
  "map.province.no_distributor": "no distributor",
  "map.province.no_sales": "no sales",
  "map.province.sales_stopped": "sales stopped",
  "map.risk.critical": "Critical",
  "map.risk.healthy": "Healthy",
  "map.risk.label": "Churn risk",
  "map.risk.no_data": "no data",
  "map.risk.risky": "At risk",
  "map.risk.score_0_29": "score 0–29",
  "map.risk.unknown": "Unknown",
  "map.risk.watch": "Watch",
  "map.risk_score_not_loaded": "Risk score not loaded yet for this customer.",
  "map.title": "Sales Map",
  "map.view.customer": "Customer",
  "map.view.customer_hint": "Customer-based — every point is clickable",
  "map.view.region_hint": "Region-based — aggregated via TBLDISTGRUP; click a bubble to drill into customers",

  // --- Customer Modal (components/customer-modal.tsx — harita marker click) ---
  "customer.ai.analysis": "AI Analysis",
  "customer.ai.analyzing": "Analyzing…",
  "customer.ai.get_analysis": "Get AI Analysis",
  "customer.ai.sql_used": "SQL used",
  "customer.cash": "Cash",
  "customer.check": "Check",
  "customer.component.behavioral": "Behavioral",
  "customer.component.engagement": "Engagement",
  "customer.component.momentum": "Sales Momentum",
  "customer.component.payment": "Payment",
  "customer.credit_card": "Credit Card",
  "customer.days": "days",
  "customer.days_ago": "{n} days ago",
  "customer.detail_error": "Detail unavailable",
  "customer.detail_loading": "Loading customer detail…",
  "customer.explain.no_response": "The agent didn't produce a response. Check server logs (most likely: table retrieve failed).",
  "customer.foresight.action_add_aria": "Add this action to the weekly list",
  "customer.foresight.action_added_aria": "This action was added to the weekly list",
  "customer.foresight.add_to_todo": "Add to To-dos",
  "customer.foresight.calendar_title": "Calendar · next 14 days",
  "customer.foresight.cohort_title": "Segment comparison · bought, this account didn't",
  "customer.foresight.col_category": "Category",
  "customer.foresight.col_last_order": "Last order",
  "customer.foresight.col_past_revenue": "Past revenue",
  "customer.foresight.col_priority": "Priority",
  "customer.foresight.dropped_title": "Dropped categories · re-engagement",
  "customer.foresight.exec_brief": "Executive brief",
  "customer.foresight.extracting": "Extracting foresight…",
  "customer.foresight.eyebrow": "Foresight · next 14 days",
  "customer.foresight.get": "Get foresight (14 days)",
  "customer.foresight.high_priority_risk": "High-priority risk",
  "customer.foresight.kpi.cohort_bought": "Similar customers bought",
  "customer.foresight.kpi.dropped_category": "Dropped category",
  "customer.foresight.kpi.risk_alert": "Risk alert",
  "customer.foresight.kpi.upcoming_event": "Upcoming event (14d)",
  "customer.foresight.no_group": "(no group)",
  "customer.foresight.no_signal": "No meaningful signal for this customer over the next 14 days.",
  "customer.foresight.refresh_hint": "Bypass cache and pull fresh from MSSQL",
  "customer.foresight.risk_flag_desc": "used to buy {amount} ₺, no orders at all for {days} days",
  "customer.foresight.this_week": "To do this week",
  "customer.foresight.weekly_action_reason": "14-day customer foresight",
  "customer.foresight.yoy_title": "Same week last year · top items",
  "customer.in_route_visit": "In-route visit",
  "customer.invoice": "Invoice",
  "customer.last_invoice": "Last invoice",
  "customer.last_sale": "Last sale",
  "customer.last_visit": "Last visit",
  "customer.off_route_visit": "Off-route visit",
  "customer.order": "Order",
  "customer.payment.coverage": "collections/revenue = %{pct}",
  "customer.payment.method_risk": "· check/note share %{pct} (term risk)",
  "customer.payment.no_invoice": "collections exist, no invoice",
  "customer.payment.reason": "Payment score from collections data: {cov}{method}.",
  "customer.promissory_note": "Promissory Note",
  "customer.reorder.cross_sell_empty": "no suggestions",
  "customer.reorder.cross_sell_hint": "buys this · other buyers of this also buy it",
  "customer.reorder.cross_sell_title": "Cross-sell suggestions",
  "customer.reorder.dropped_count": "dropped",
  "customer.reorder.dropped_days": "{n} days without an order",
  "customer.reorder.dropped_empty": "no dropped products",
  "customer.reorder.dropped_title": "Dropped products",
  "customer.reorder.error": "Reorder suggestions unavailable",
  "customer.reorder.gap_below_desc": "%{pct} of peers buy {grup} — this account buys less than its peers.",
  "customer.reorder.gap_count": "coverage gaps",
  "customer.reorder.gap_empty": "no coverage gaps",
  "customer.reorder.gap_meta": "{count} peer accounts",
  "customer.reorder.gap_none_desc": "%{pct} of peers buy {grup} — this account never has.",
  "customer.reorder.gap_title": "Coverage Gap",
  "customer.reorder.gap_tur_below": "below peers",
  "customer.reorder.gap_tur_none": "never bought",
  "customer.reorder.loading": "Loading reorder suggestions…",
  "customer.reorder.overdue_count": "overdue",
  "customer.reorder.overdue_days": "{n} days overdue",
  "customer.reorder.overdue_empty": "no overdue orders",
  "customer.reorder.overdue_meta": "{count} orders · avg {days}d",
  "customer.reorder.overdue_title": "Overdue orders",
  "customer.reorder.peer_cross_count": "peer suggestions",
  "customer.reorder.peer_cross_desc": "%{pct} of accounts like this one buy {urun}.",
  "customer.reorder.peer_cross_meta": "{count} peer accounts",
  "customer.reorder.suggestion_count": "suggestions",
  "customer.risk_composite_desc": "Composite score of sales, behavioral, payment, and engagement signals.",
  "customer.risk_hint.base": "Weighted sum of 4 components",
  "customer.risk_hint.note1": "Sales Momentum 40% — revenue acceleration: last 30d vs previous 30d (45%), 90d monthly baseline (35%), and same period last year (20%); prolonged silence amplifies the drop (up to ×1.5).",
  "customer.risk_hint.note2": "Behavioral 30% — silence: days since last order (50%, main signal) + order frequency decline (30%, invoice count) + basket narrowing (20%, distinct product groups).",
  "customer.risk_hint.note3": "Payment 20% — computed live from collections data while this screen is open: last-30d collections/revenue coverage ratio + check/note (term) share penalty.",
  "customer.risk_hint.note4": "Engagement 10% — visit cadence: the expected interval based on last-90d visit frequency (15/30/60 days) compared to time elapsed since the last visit.",
  "customer.risk_hint.note5": "Tier thresholds: 0–29 healthy · 30–54 watch · 55–74 at risk · 75+ critical.",
  "customer.risk_hint.note6": "If base revenue < 1,000 TRY, the related signal is treated as \"none\" — it won't skew a new/dormant customer's score. If no component can be computed, the tier becomes \"Insufficient data\".",
  "customer.risk_hint.source": "Composite risk score — computed at sync time (0–100, higher = higher risk)",
  "customer.risk_hint.title": "How is the risk score calculated?",
  "customer.risk_hint.window": "Last 30 / 90 days + same 30 days last year (YoY)",
  "customer.risk_score": "Risk Score",
  "customer.section.collections": "Collections",
  "customer.section.field_documents": "Field Documents",
  "customer.section.last30_summary": "Last 30 Days Summary",
  "customer.section.reorder": "Reorder Suggestions",
  "customer.section.visit_detail": "Visit Detail",
  "customer.tier.critical": "Critical",
  "customer.tier.healthy": "Healthy",
  "customer.tier.risk": "At Risk",
  "customer.tier.unknown": "Insufficient data",
  "customer.tier.watch": "Watch",
  "customer.today": "today",
  "customer.total": "Total",
  "customer.urgency.high": "High",
  "customer.urgency.low": "Low",
  "customer.urgency.medium": "Medium",
  "customer.visit": "Visits",
  "customer.waybill": "Waybill",
  "komuta.fa.added_label_plain": "Added",
};

/**
 * locale "en" ve sözlükte anahtarın karşılığı varsa onu, aksi halde
 * `trDefault`'u döner. Kapsam dışı (sözlükte olmayan) anahtarlar için her
 * zaman TR'de kalır — bilinçli, sessiz fallback.
 *
 * `vars` verilirse `{ad}` biçimindeki token'lar değiştirilir — hem TR
 * varsayılanı hem EN karşılığı AYNI token isimlerini taşımalı (ör.
 * `"{n} kırılım"` / `"{n} breakdowns"`). Basit `String.replace`; iç içe
 * ya da çoğul/tekil kural motoru YOK — demo kapsamı için yeterli.
 */
export function t(
  locale: Locale,
  key: string,
  trDefault: string,
  vars?: Record<string, string | number>,
): string {
  const raw = locale === "en" && EN[key] ? EN[key] : trDefault;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] != null ? String(vars[name]) : match,
  );
}

/**
 * Hacim birimi kısaltmaları (`tenant.volume.short`) tenant config'ten
 * (`packages/core/src/tenant/configs/*.ts`) gelir — o katman bu i18n
 * görevinin dosya kapsamı DIŞINDA (yalnızca `apps/dashboard`). EN locale'de
 * bilinen TR kısaltmaları (ör. FMCG demo tenant'ının "ad" = adet/koli)
 * burada, salt görüntü katmanında, İngilizce karşılığına eşlenir. Bilinmeyen
 * kısaltmalar (ör. Wietnauer'ın "70cl"'i zaten dile bağımsız) olduğu gibi
 * döner.
 */
const VOLUME_UNIT_EN: Record<string, string> = {
  ad: "units",
};
export function localizeVolumeUnit(short: string, locale: Locale): string {
  if (locale !== "en") return short;
  return VOLUME_UNIT_EN[short] ?? short;
}

/**
 * Bazı backend panelleri (ör. `wietnauer-iskonto.ts` aylık trend) ay
 * etiketini SUNUCUDA Türkçe kısaltma olarak üretir ("Oca", "Şub", …). O
 * katman (`packages/core`) bu i18n görevinin dosya kapsamı DIŞINDA; EN
 * locale'de bu kısaltmaları salt görüntü katmanında İngilizce'ye eşleriz.
 * Zaten "YYYY-MM" ham formatını taşıyan paneller `formatAyLabel()` kullanır
 * ve bu eşlemeye ihtiyaç duymaz.
 */
const AY_ABBR_EN: Record<string, string> = {
  Oca: "Jan", Şub: "Feb", Mar: "Mar", Nis: "Apr", May: "May", Haz: "Jun",
  Tem: "Jul", Ağu: "Aug", Eyl: "Sep", Eki: "Oct", Kas: "Nov", Ara: "Dec",
};
export function localizeAyAbbr(ay: string, locale: Locale): string {
  if (locale !== "en") return ay;
  return AY_ABBR_EN[ay] ?? ay;
}

/**
 * Bazı backend panelleri sentetik satırlar döndürür — dip "Toplam" ve
 * Top-N sonrası "Diğer" kırılımı (ör. `wietnauer-marka.ts`, marka portföyü /
 * Top SKU). Bu etiketler SUNUCUDA Türkçe üretilir (`packages/core`, bu
 * görevin dosya kapsamı DIŞINDA). EN locale'de salt görüntü katmanında
 * İngilizce'ye eşleriz; gerçek marka/ürün adları (bilinen sentetik etiket
 * DEĞİLSE) olduğu gibi döner.
 */
export function localizeRowLabel(label: string, locale: Locale): string {
  if (locale !== "en") return label;
  if (label === "Toplam") return "Total";
  if (label === "Diğer") return "Other";
  return label;
}
