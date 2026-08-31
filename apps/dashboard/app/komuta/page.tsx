import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type {
  KomutaHeatmapRow,
  KomutaKpiCard,
  KomutaMatrixRow,
  KomutaMonthlyBar,
  KomutaPortfolioRow,
  KomutaRegionRow,
  KomutaRep,
  KomutaSnapshot,
  KomutaTopDist,
  KomutaUpcomingEvent,
  ProductTier,
  ValueUnit,
} from "@/lib/api";
import { getKomutaSnapshot } from "@/lib/api";
import { getContentMap, t, panelTitle, panelHidden } from "@/lib/content";
import { FinanceAgentLauncher } from "@/components/komuta/FinanceAgentLauncher";
import { ChannelMixChart } from "@/components/komuta/ChannelMixChart";
import { CalendarChart } from "@/components/komuta/CalendarChart";
import { InfoHint } from "@/components/komuta/InfoHint";
import { TurkeyMapPolygon } from "@/components/komuta/TurkeyMapPolygon";
import { UnitToggle } from "@/components/komuta/UnitToggle";
import { CustomerTypeBrandPanel } from "@/components/komuta/CustomerTypeBrandPanel";

// `force-dynamic` kaldırıldı — searchParams Promise zaten dynamic tetikliyor;
// böylece sayfa içi fetch'ler Data Cache'e girebiliyor (5 dk revalidate).
export const metadata = {
  title: "Komuta · Insider",
};

type Props = {
  searchParams: Promise<{
    refresh?: string;
    reel?: string;
    otv?: string;
    unit?: string;
  }>;
};

export default async function KomutaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const forceRefresh = sp.refresh === "1";
  const reelTL = sp.reel === "1";
  const otvNet = sp.otv === "1";
  const unit: ValueUnit = sp.unit === "9le" ? "9le" : "tl";
  let snap: KomutaSnapshot;
  try {
    snap = await getKomutaSnapshot({
      refresh: forceRefresh,
      reelTL,
      otvNet,
      unit,
    });
  } catch (e) {
    // Oturum düşmüşse API 401/403 döner → 404 değil, login'e yönlendir.
    // (redirect() NEXT_REDIRECT fırlatır; catch dışına propagate eder.)
    if (e instanceof Error && /API 40[13]/.test(e.message)) redirect("/login");
    notFound();
  }

  return (
    <>
      {/* Komuta Köprüsü kendi koyu temalı stilini taşır — global navbar bu
          sayfada gizleniyor (components/ui/navbar.tsx). */}
      <style dangerouslySetInnerHTML={{ __html: KOMUTA_CSS }} />
      <div className="komuta-root">
        <Header generatedAt={snap.generatedAt} reelTL={snap.reelTL} otvNet={snap.otvNet} demo={!!snap.demoDate} />
        <FilterBar reelTL={snap.reelTL} otvNet={snap.otvNet} />
        {snap.reelTL && <ReelTlBanner />}
        {snap.otvNet && <OtvNetBanner avgRate={snap.otvAvgRate} reelActive={snap.reelTL} />}
        {/* Yöneticinin ilk gördüğü içerik: AI yorumu en üste alındı. KPI
            şeridi öncesi konumlandırılır ki sayfaya giren göz hemen
            "bu sabahın hikâyesi" cümlesini yakalasın. Brief üretilemezse
            sessizce kaybolmasın → fallback mesaj. */}
        {snap.brief && snap.brief.trim().length >= 50 ? (
          <AiInsightBar brief={snap.brief} />
        ) : (
          <div className="ai-brief-empty">
            <span className="ai-brief-empty-icon">🤖</span>
            <div>
              <strong>Günün AI yorumu üretilemedi.</strong>{" "}
              <span className="ai-brief-empty-sub">
                Gemini servisi yanıt vermedi (network / API key / timeout).
                Sayfayı{" "}
                <a href="/komuta?refresh=1" className="ai-brief-empty-link">
                  ?refresh=1 ile yenile
                </a>{" "}
                veya API server log'larına bak.
              </span>
            </div>
          </div>
        )}
        <KpiStrip kpis={snap.kpis} />
        {snap.upcomingEvent && <CalendarBanner event={snap.upcomingEvent} />}

        <div className="main-grid">
          {!panelHidden("panel.cockpit.map") && (
            <TurkeyMapPolygon regions={snap.regions} />
          )}
          {!panelHidden("panel.cockpit.channelmonthly") && (
            <ChannelMixChart
              rows={snap.channelMonthly}
              unit={snap.unit}
              title={panelTitle("panel.cockpit.channelmonthly", "Kanal Mix")}
              enablePeriodFilter
              enablePieView
            />
          )}
        </div>

        {!panelHidden("panel.cockpit.calendar") && (
          <CalendarChart monthly={snap.monthlyTrend} unit={snap.unit} />
        )}

        <div className="battle-grid">
          {/* "Yaklaşan Pik" yerine Pernod Müşteri Tipi (ek-saha tabanlı)
              kanal kırılımı. Bu segmentasyon TBLMUSTERIGRUP'tan değil
              TBLEKSAHATANIMLAMA "Müşteri Tipi" (LNGTAKIPKOD=8) sahasından
              türetilir — Pernod'un gerçek kanal tanımları (Perakende /
              On Trade / Otel / Tali Bayi / OPA ...). */}
          {!panelHidden("panel.cockpit.channeltype") && (
            <ChannelMixChart
              rows={snap.channelByType}
              unit={snap.unit}
              title={panelTitle("panel.cockpit.channeltype", "Müşteri Tipi · Son 12 Ay")}
              icon="🛒"
              category="müşteri tipi"
              sourceNote="Müşteri tipi segmentasyonu: Perakende / On Trade / Otel / Tali Bayi / OPA dağılımı, son 12 ay."
              enableTypeFilter
              typeFilterLabel="Müşteri Tipi"
            />
          )}
          <MatrixPanel matrix={snap.matrix} unit={snap.unit} />
        </div>

        <HeatmapPanel heatmap={snap.heatmap} />

        {/* md34 — Müşteri Tipi × Marka: channeltype panelinin dayandığı aynı
            ek-saha kaynağı (saha 8) × tenant.brandTable kırılımı. */}
        {!panelHidden("panel.cockpit.customertypebrand") && (
          <CustomerTypeBrandPanel
            data={snap.customerTypeBrand}
            title={panelTitle("panel.cockpit.customertypebrand", "Müşteri Tipi × Marka")}
          />
        )}

        <div className="bottom-grid">
          <RepLeaderboard reps={snap.reps} unit={snap.unit} />
          <DistLeaderboard dists={snap.topDists} unit={snap.unit} />
        </div>

        <PortfolioPanel portfolio={snap.portfolio} unit={snap.unit} />

        <Footer generatedAt={snap.generatedAt} />
      </div>
    </>
  );
}

// ============================================================================
// Components
// ============================================================================

function Header({
  generatedAt,
  reelTL,
  otvNet,
  demo,
}: {
  generatedAt: string;
  reelTL: boolean;
  otvNet: boolean;
  demo?: boolean;
}) {
  const rel = formatRelative(generatedAt);
  const modeLabel = [
    reelTL ? "Reel TL" : null,
    otvNet ? "ÖTV-net" : null,
  ].filter(Boolean).join(" + ") || "Nominal TL · Brüt";
  const refreshHref = "/komuta?" + new URLSearchParams({
    refresh: "1",
    ...(reelTL ? { reel: "1" } : {}),
    ...(otvNet ? { otv: "1" } : {}),
  }).toString();
  return (
    <header className="komuta-page-header">
      <div className="komuta-page-header-main">
        <div className="komuta-eyebrow">
          <span className="komuta-eyebrow-dot" />
          Komuta
        </div>
        <h1 className="komuta-page-title">{t(getContentMap(), "page.cockpit.title", "Operasyon Genel Görünümü")}</h1>
        <p className="komuta-page-desc">
          Univera Distribütör Operasyonu · CEO / Satış Direktörü görünümü ·{" "}
          <strong>Tüm Distribütörler</strong> · Son 30 Gün ·{" "}
          <span style={{ color: "#6366f1" }}>{modeLabel}</span>
        </p>
      </div>
      <div className="komuta-page-header-actions">
        {demo && <DemoBanner />}
        <span className="live-indicator">
          <span className="live-dot" />
          {rel}
        </span>
        <Link href={refreshHref} className="refresh-btn" prefetch={false}>
          ↻ Yenile
        </Link>
      </div>
    </header>
  );
}

function FilterBar({ reelTL, otvNet }: { reelTL: boolean; otvNet: boolean }) {
  // Toggle'lar birbirine kombine olabilir — URL'i mevcut state üstüne ekle/çıkar
  const reelHref = "/komuta?" + new URLSearchParams({
    ...(reelTL ? {} : { reel: "1" }), // kapalıysa aç
    ...(otvNet ? { otv: "1" } : {}),
  }).toString().replace(/^$/, "");
  const otvHref = "/komuta?" + new URLSearchParams({
    ...(reelTL ? { reel: "1" } : {}),
    ...(otvNet ? {} : { otv: "1" }), // kapalıysa aç
  }).toString().replace(/^$/, "");

  return (
    <div className="filter-bar">
      <span className="filter-chip active">Bölge: Tümü <span className="caret">▼</span></span>
      <span className="filter-chip">Kanal: Tümü <span className="caret">▼</span></span>
      <span className="filter-chip">Ürün Grubu: Tümü <span className="caret">▼</span></span>
      <span className="filter-chip">Periyot: Son 30 gün <span className="caret">▼</span></span>
      <span className="filter-chip">Karşılaştır: Geçen Yıl Aynı Dönem <span className="caret">▼</span></span>
      <span className="filter-spacer" />
      <div className="toggle-group">
        <Link
          href={reelHref === "/komuta?" ? "/komuta" : reelHref}
          className={`toggle toggle-link${reelTL ? " on" : ""}`}
          title="Geçmiş değerleri TÜFE multiplier ile bugünün parasına çevirir"
          prefetch={false}
        >
          <span className="switch" /> Reel TL (TÜFE)
        </Link>
        <Link
          href={otvHref === "/komuta?" ? "/komuta" : otvHref}
          className={`toggle toggle-link${otvNet ? " on" : ""}`}
          title="Tüm ciro değerlerinden ÖTV (Özel Tüketim Vergisi) düşülmüş net görünüm"
          prefetch={false}
        >
          <span className="switch" /> ÖTV-net görünüm
        </Link>
        <span
          className="toggle on"
          title="Takvim hizalı kıyas — calendar/tr-2026.json üzerinden"
        >
          <span className="switch" /> Takvim hizalı
        </span>
        <UnitToggle />
      </div>
    </div>
  );
}

// -- KPI STRIP ---------------------------------------------------------------

function KpiStrip({ kpis }: { kpis: KomutaKpiCard[] }) {
  if (panelHidden("panel.cockpit.kpistrip")) return null;
  if (!kpis || kpis.length === 0) {
    return <div className="empty-note">KPI verisi alınamadı.</div>;
  }
  // Color accent per card matches mockup palette
  const accents = ["#6366f1", "#16a34a", "#9333ea", "#6366f1", "#16a34a"];
  return (
    <div className="kpi-strip-wrap">
      <div className="kpi-strip-head">
        <span className="kpi-strip-label">{panelTitle("panel.cockpit.kpistrip", "Son 30 gün özet")}</span>
        <InfoHint
          title="KPI hesaplaması"
          source="TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUNEKSAHA (9L için)"
          window="Son 30 gün vs önceki 30 gün (delta % hesabı)"
          base="SUM(DBLNETTUTAR) (Ciro), COUNT (Fatura), SUM(DBLMIKTAR × ek_saha_26) (Hacim = 9L)"
          notes={[
            "Filtre: BYTTUR=0 AND BYTDURUM=0 (onaylı satış faturası)",
            "9L çarpanı: TBLURUNEKSAHA saha 26 \"9 LT Değer\" (Pernod'un resmi katsayısı; 701 ürün için dolu)",
            "Fallback (ek saha boş ise): DBLLITRE / 9 klasik hesaba düşülür",
            "Demo modda GETDATE() çağrıları DEMO_DATE env değerine rewrite edilir",
          ]}
        />
      </div>
      <div className="kpi-strip">
        {kpis.map((k, i) =>
          panelHidden(`kpi.cockpit.${k.id}`) ? null : (
          <div
            key={k.id}
            className="kpi-card"
            style={{ ["--accent" as string]: accents[i] ?? "#6366f1" }}
          >
            <div className="kpi-label">{panelTitle(`kpi.cockpit.${k.id}`, k.label)}</div>
            <div className="kpi-value"><KpiValue k={k} /></div>
            <div className="kpi-meta">
              {k.delta != null && (
                <span className={k.delta >= 0 ? "delta-up" : "delta-down"}>
                  {k.delta >= 0 ? "▲" : "▼"} %{Math.abs(k.delta).toFixed(1)}
                </span>
              )}
              {k.deltaSub && <span className="kpi-sub">{k.deltaSub}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** KPI değerini JSX olarak göster — sayı tam boy, birim (₺ / 9L) küçük + silik.
 *  Sayıyla suffix birbirine karışmasın diye verticalAlign + fontSize farkı. */
function KpiValue({ k }: { k: KomutaKpiCard }) {
  if (k.format === "percent") {
    return <>%{k.value.toFixed(1)}</>;
  }
  const numStr =
    k.format === "compact"
      ? formatCompact(k.value)
      : Math.round(k.value).toLocaleString("tr-TR");
  return (
    <>
      {numStr}
      {k.unit && (
        <span
          style={{
            fontSize: "0.55em",
            opacity: 0.55,
            fontWeight: 500,
            marginLeft: "0.32em",
            letterSpacing: "0.02em",
            verticalAlign: "0.18em",
          }}
        >
          {k.unit}
        </span>
      )}
    </>
  );
}

// -- DEMO MODE BANNER --------------------------------------------------------

function DemoBanner() {
  return (
    <span className="demo-badge" title="Demo modu — örnek veri">
      <span className="demo-badge-dot" />
      Demo modu
    </span>
  );
}

// -- CALENDAR BANNER ---------------------------------------------------------

function ReelTlBanner() {
  return (
    <div className="reel-banner">
      <div className="reel-banner-icon">📈</div>
      <div className="reel-banner-text">
        <strong>Reel TL görünümü aktif</strong> · Geçmiş değerler TÜFE
        multiplier'ı ile bugünün parasına çevrildi.{" "}
        <span style={{ color: "#78716c" }}>
          YoY ve 2-yıllık % değerleri reel kıyasla yeniden hesaplandı —
          enflasyon arındırılmış gerçek büyüme.
        </span>
      </div>
      <Link href="/komuta" className="reel-banner-cta" prefetch={false}>
        Nominal TL'ye dön →
      </Link>
    </div>
  );
}

function OtvNetBanner({
  avgRate,
  reelActive,
}: {
  avgRate: number | null;
  reelActive: boolean;
}) {
  const ratePct = avgRate != null ? (avgRate * 100).toFixed(0) : "?";
  return (
    <div className="otv-banner">
      <div className="otv-banner-icon">🧾</div>
      <div className="otv-banner-text">
        <strong>ÖTV-net görünümü aktif</strong> · Tüm ciro değerlerinden ÖTV
        (Özel Tüketim Vergisi) düşüldü.{" "}
        <span style={{ color: "#78716c" }}>
          Ürün grubu bazında oran uygulandı; KPI ve özet metrikler için ağırlıklı
          ortalama <strong style={{ color: "#16a34a" }}>%{ratePct}</strong>.
        </span>
      </div>
      <Link
        href={reelActive ? "/komuta?reel=1" : "/komuta"}
        className="otv-banner-cta"
        prefetch={false}
      >
        Brüt görünüme dön →
      </Link>
    </div>
  );
}

function CalendarBanner({ event }: { event: KomutaUpcomingEvent }) {
  return (
    <div className="cal-banner">
      <div className="cal-banner-icon">📅</div>
      <div className="cal-banner-text">
        <strong>{event.daysAhead} gün sonra {event.name}</strong>
        {" · "}({new Date(event.date).toLocaleDateString("tr-TR", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })})
        {" · "}<span style={{ color: "#78716c" }}>
          Yaklaşan Sezon panelinde geçen yıl etkisi
        </span>
      </div>
      <div className="cal-banner-cta">Sezon planını incele →</div>
    </div>
  );
}

// -- TURKEY MAP (bölge bazlı, TBLDISTGRUP üzerinden) ------------------------

/**
 * Distribütör bölgesi adı → SVG xy koordinatı (viewBox 0 0 600 320).
 *
 * TBLDISTGRUP.TXTAD'leri çeşitli yazılışlarda gelebilir; normalize edip
 * (büyük harf + diacritic strip) arama yapılır. Bilinmeyen bölgeler haritada
 * görünmez ama altta "Liste dışı" notuna girer.
 *
 * Yeni bölge adı eklemek için: bu objeye satır ekle, kod değişmesine gerek
 * yok. Anahtar normalize-uppercase (TR I→I, Ş→S, vs.).
 */
const REGION_POSITIONS: Record<string, { x: number; y: number }> = {
  // İstanbul ve çevresi — sol üst köşede, üst üste binmemek için biraz açıldı
  "ISTANBUL": { x: 120, y: 100 },
  "ISTANBUL AVRUPA": { x: 95, y: 100 },
  "ISTANBUL ANADOLU": { x: 155, y: 110 },
  "ISTANBUL 1": { x: 95, y: 100 },
  "ISTANBUL 2": { x: 155, y: 110 },
  // Marmara — Istanbul'un sağı/altı, ayrı bir blob hissi
  "MARMARA": { x: 220, y: 130 },
  "TRAKYA": { x: 80, y: 95 },
  "BURSA": { x: 175, y: 145 },
  // Ege
  "EGE": { x: 115, y: 180 },
  "IZMIR": { x: 105, y: 180 },
  "EGE/IZMIR": { x: 110, y: 180 },
  "EGE IZMIR": { x: 110, y: 180 },
  // Akdeniz
  "AKDENIZ": { x: 235, y: 220 },
  "AKDENIZ/ANTALYA": { x: 220, y: 222 },
  "AKDENIZ ANTALYA": { x: 220, y: 222 },
  "ANTALYA": { x: 215, y: 225 },
  // İç Anadolu / Ankara — haritanın tam ortası
  "ANKARA": { x: 300, y: 160 },
  "IC ANADOLU": { x: 300, y: 160 },
  "ORTA ANADOLU": { x: 300, y: 160 },
  "IC ANADOLU/ANKARA": { x: 300, y: 160 },
  "IC ANADOLU ANKARA": { x: 300, y: 160 },
  // Karadeniz
  "KARADENIZ": { x: 380, y: 105 },
  "DOGU KARADENIZ": { x: 450, y: 105 },
  "BATI KARADENIZ": { x: 290, y: 105 },
  // Doğu / Güneydoğu — TR karakter strip sonrası alternatif yazılışlar
  "DOGU": { x: 480, y: 150 },
  "DOGU ANADOLU": { x: 480, y: 150 },
  "GUNEY DOGU": { x: 425, y: 215 },
  "GUNEY DOGU ANADOLU": { x: 425, y: 215 },
  "GUNEYDOGU": { x: 425, y: 215 },
  "GUNEYDOGU ANADOLU": { x: 425, y: 215 },
  // İstanbul varyantları (DB'de IST-AVRUPA, IST-ASYA, AVRUPA gibi gelebilir)
  "IST-ASYA": { x: 155, y: 110 },
  "IST ASYA": { x: 155, y: 110 },
  "IST-AVRUPA": { x: 95, y: 100 },
  "IST AVRUPA": { x: 95, y: 100 },
  "AVRUPA": { x: 95, y: 100 },
  "ASYA": { x: 155, y: 110 },
  "MARMARA (ISTANBUL DISI)": { x: 220, y: 130 },
  // KKTC — KKTC ve KIBRIS aynı bölge ama ayrı blob'lar olarak stagger
  "KKTC": { x: 275, y: 285 },
  "LEFKOSA": { x: 275, y: 285 },
  "GAZIMAGUSA": { x: 310, y: 285 },
  "KIBRIS": { x: 310, y: 285 },
};

function trUpper(s: string): string {
  return s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}

function normalizeForLookup(s: string): string {
  return trUpper(s.trim())
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ç/g, "C")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O");
}

function findRegionPosition(name: string): { x: number; y: number } | null {
  const norm = normalizeForLookup(name);
  if (REGION_POSITIONS[norm]) return REGION_POSITIONS[norm];
  // Birden fazla kelimeyle isim varsa ilk eşleşeni bulmaya çalış
  const tokens = norm.split(/[\s\/\-_]+/).filter(Boolean);
  for (let i = tokens.length; i > 0; i--) {
    const prefix = tokens.slice(0, i).join(" ");
    if (REGION_POSITIONS[prefix]) return REGION_POSITIONS[prefix];
  }
  // Tek kelime denemesi (örn. "İSTANBUL AVRUPA YAKASI" → "ISTANBUL")
  if (tokens[0] && REGION_POSITIONS[tokens[0]]) return REGION_POSITIONS[tokens[0]];
  return null;
}

type Placed = KomutaRegionRow & { x: number; y: number };

function blobTone(deltaPct: number | null): "hot" | "medium" | "muted" | "cool" {
  if (deltaPct == null) return "muted";
  if (deltaPct >= 15) return "hot";
  if (deltaPct >= 5) return "medium";
  if (deltaPct >= -5) return "muted";
  return "cool";
}

function TurkeyMap({ regions }: { regions: KomutaRegionRow[] }) {
  const placed: Placed[] = [];
  const unplaced: KomutaRegionRow[] = [];
  for (const c of regions) {
    const pos = findRegionPosition(c.bolge);
    if (pos) placed.push({ ...c, ...pos });
    else unplaced.push(c);
  }

  const maxCiro = Math.max(1, ...placed.map((p) => p.ciro));

  return (
    <div className="panel map-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🗺️</span> Türkiye + KKTC · Bölge × YoY
          <InfoHint
            title="Bölge YoY hesaplaması"
            source="TBLMSDFATURA × TBLDIST × TBLDISTEKGRUP"
            window="Son 30 gün (TRHISLEMTARIHI ≥ DATEADD(day,-30,GETDATE())) vs -395..-365g (geçen yıl aynı 30g)"
            base="SUM(DBLNETTUTAR) bölge başına"
            notes={[
              "Bölge = TBLDISTEKGRUP.TXTAD; JOIN dg.TXTKOD = d.TXTEKGRUP üzerinden bağlanır",
              "Filtre: f.BYTTUR=0, f.BYTDURUM=0, d.BYTDURUM=0 (aktif satış + aktif dist)",
              "deltaPct = (son − önceki) / önceki × 100; önceki 0 ise null",
            ]}
          />
        </div>
        <div className="panel-meta map-panel-meta">
          <span>
            {placed.length} bölge haritada
            {unplaced.length > 0 && ` · ${unplaced.length} liste dışı`}
          </span>
          <FinanceAgentLauncher
            regions={regions.map((r) => ({
              bolge: r.bolge,
              deltaPct: r.deltaPct,
            }))}
          />
        </div>
      </div>

      <svg className="map-svg" viewBox="0 0 600 320" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="komuta-hot" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#16a34a" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#16a34a" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="komuta-medium" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
            <stop offset="60%" stopColor="#6366f1" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="komuta-muted" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#78716c" stopOpacity="0.35" />
            <stop offset="60%" stopColor="#78716c" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#78716c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="komuta-cool" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#dc2626" stopOpacity="0.45" />
            <stop offset="60%" stopColor="#dc2626" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Türkiye ana kara parçası (stilize, mockup'tan) */}
        <path
          d="M 50,140 Q 60,110 100,100 L 180,90 Q 240,85 290,95 L 360,90 Q 420,85 480,100 L 540,120 Q 555,140 550,170 L 540,210 Q 510,235 460,235 L 380,240 Q 320,245 260,240 L 180,235 Q 110,230 70,210 Q 45,180 50,140 Z"
          fill="#f5f5f4"
          stroke="#d6d3d1"
          strokeWidth="1.2"
        />
        {/* KKTC */}
        <ellipse cx="290" cy="285" rx="32" ry="10" fill="#f5f5f4" stroke="#d6d3d1" strokeWidth="1" />
        <text x="290" y="287" textAnchor="middle" fill="#a8a29e" fontSize="9" fontWeight="500">
          KKTC
        </text>

        {/* Bölge blob'ları — büyükten küçüğe (üst üste binerse büyük arkada) */}
        {[...placed]
          .sort((a, b) => b.ciro - a.ciro)
          .map((c) => {
            const tone = blobTone(c.deltaPct);
            const ratio = Math.sqrt(c.ciro / maxCiro);
            // Blob: glow halesi küçültüldü (50px → 26px max) — yan yana
            // bölgelerin renkleri birbirine karışmasın diye.
            const blobR = Math.max(10, 11 + ratio * 15);
            const dotR = c.ciro >= maxCiro * 0.3 ? 4.5 : 3;
            const isAnomaly = tone === "cool";
            const fontWeight = c.ciro >= maxCiro * 0.4 ? 600 : 500;
            const fontSize = c.ciro >= maxCiro * 0.4 ? 10.5 : 9;
            const labelColor =
              tone === "hot" ? "#16a34a"
                : tone === "medium" ? "#6366f1"
                : tone === "cool" ? "#dc2626"
                : "#44403c";
            const dotColor =
              tone === "hot" ? "#16a34a"
                : tone === "medium" ? "#6366f1"
                : tone === "cool" ? "#dc2626"
                : "#78716c";
            return (
              <g
                key={c.bolge}
                data-finance-region={c.bolge}
                style={{ cursor: "pointer" }}
                role="button"
                aria-label={`${c.bolge} bölgesi için finans analizini aç`}
              >
                {/* Geniş şeffaf hit-target — sadece dot/halka değil tüm
                    etiketin etrafı tıklanabilir olsun */}
                <circle cx={c.x} cy={c.y} r={Math.max(blobR, 22)} fill="transparent" />
                <circle cx={c.x} cy={c.y} r={blobR} fill={`url(#komuta-${tone})`} />
                <circle cx={c.x} cy={c.y} r={dotR} fill={dotColor} />
                <text
                  x={c.x + dotR + 6}
                  y={c.y + 2}
                  fill="#1c1917"
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                >
                  {c.bolge}
                </text>
                {c.deltaPct != null && (
                  <text
                    x={c.x + dotR + 6}
                    y={c.y + 13}
                    fill={labelColor}
                    fontSize={fontSize - 1.5}
                    fontWeight={isAnomaly || tone === "hot" ? 600 : 500}
                  >
                    {isAnomaly && "⚡ "}
                    {c.deltaPct >= 0 ? "+" : ""}%{c.deltaPct.toFixed(0)} YoY
                  </text>
                )}
              </g>
            );
          })}
      </svg>

      <div className="map-legend">
        <div className="legend-item">
          <span className="legend-dot" style={{ background: "#16a34a" }} /> YoY +%15+
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: "#6366f1" }} /> +%5 ile +%15
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: "#78716c" }} /> ±%5
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: "#dc2626" }} /> Anomali
        </div>
      </div>

      {unplaced.length > 0 && (
        <div className="map-unplaced-pills">
          <div className="map-unplaced-label">
            Haritada konumlandırılmamış bölgeler · {unplaced.length}
          </div>
          <div className="map-unplaced-row">
            {unplaced.map((u) => {
              const tone = blobTone(u.deltaPct);
              return (
                <span key={u.bolge} className={`unplaced-pill tone-${tone}`}>
                  <span className="unplaced-dot" />
                  <span className="unplaced-name" title={u.bolge}>{u.bolge}</span>
                  <span className="unplaced-num">{formatCompact(u.ciro)} ₺</span>
                  {u.deltaPct != null && (
                    <span className="unplaced-delta">
                      {u.deltaPct >= 0 ? "+" : ""}%{u.deltaPct.toFixed(0)}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// -- CHANNEL MIX (donut + monthly trend bars) --------------------------------

function ChannelMix({
  channels,
  monthly,
}: {
  channels: { name: string; ciro: number; pct: number; color: string }[];
  monthly: KomutaMonthlyBar[];
}) {
  const total = channels.reduce((a, b) => a + b.ciro, 0);
  const circumference = 2 * Math.PI * 38;
  let acc = 0;
  const segments = channels.map((c) => {
    const len = (c.pct / 100) * circumference;
    const seg = {
      color: c.color,
      dasharray: `${len} ${circumference - len}`,
      dashoffset: -acc,
    };
    acc += len;
    return seg;
  });
  const maxBar = Math.max(1, ...monthly.map((m) => m.ciro));

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">📊</span> Kanal Mix · Bu Ay
        </div>
        <div className="panel-meta">{formatCompact(total)} ₺ toplam</div>
      </div>

      <div className="donut-wrap">
        <svg className="donut-svg" viewBox="0 0 100 100">
          {segments.map((s, i) => (
            <circle
              key={i}
              cx="50"
              cy="50"
              r="38"
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={s.dasharray}
              strokeDashoffset={s.dashoffset}
              transform="rotate(-90 50 50)"
            />
          ))}
          <text x="50" y="48" textAnchor="middle" fill="#1c1917" fontSize="11" fontWeight="700">
            {channels.length} kanal
          </text>
          <text x="50" y="60" textAnchor="middle" fill="#78716c" fontSize="6.5">
            aktif segment
          </text>
        </svg>
        <div className="channel-list">
          {channels.map((c) => (
            <div key={c.name} className="channel-row">
              <span className="channel-name">
                <span className="channel-pip" style={{ background: c.color }} />
                <span className="channel-truncate" title={c.name}>{c.name}</span>
              </span>
              <span>
                <span className="channel-num">{formatCompact(c.ciro)} ₺</span>
                <span className="channel-pct">{c.pct.toFixed(1)}%</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {monthly.length > 0 && (
        <>
          <div className="trend-mini">
            {monthly.map((m, i) => (
              <div
                key={m.yyyymm}
                className={`trend-bar${m.isRamazan ? " ramazan" : ""}${
                  m.isCurrent ? " peak" : ""
                }`}
                style={{ height: `${(m.ciro / maxBar) * 100}%` }}
                title={`${m.ay} · ${formatCompact(m.ciro)} ₺`}
              />
            ))}
          </div>
          <div className="trend-labels">
            {monthly.map((m) => (
              <span
                key={m.yyyymm}
                style={{
                  color: m.isRamazan ? "#9333ea" : m.isCurrent ? "#6366f1" : undefined,
                }}
              >
                {m.ay}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// -- CALENDAR SHRED ----------------------------------------------------------

function CalendarShred({ monthly }: { monthly: KomutaMonthlyBar[] }) {
  if (monthly.length < 2) return null;

  // 13 ay gelirse son 12 ayı al (mockup hizalı)
  const series = monthly.length > 12 ? monthly.slice(-12) : monthly;
  const n = series.length;

  // SVG viewBox (lines/paths/dots için); text'ler HTML overlay olarak basılır
  const VB_W = 1200;
  const VB_H = 100;
  const padXFrac = 0.04; // %4 sol-sağ iç boşluk (Bugün rozeti sığsın)

  // Yaz/Ramazan'ı client-side türet — cache stale olsa bile çalışsın
  const enriched = series.map((m) => {
    const [, mo] = m.yyyymm.split("-");
    const monthNum = Number(mo);
    return {
      ...m,
      _isSummer: m.isSummer ?? (monthNum >= 6 && monthNum <= 9),
      _monthNum: monthNum,
    };
  });

  // Bugün = son ay
  const todayIdx = enriched.findIndex((m) => m.isCurrent);
  const lastIdx = todayIdx >= 0 ? todayIdx : n - 1;

  // Skala (Bu Yıl + Geçen Yıl ortak max)
  const allVals: number[] = [];
  for (const m of enriched) {
    if (m.ciro > 0) allVals.push(m.ciro);
    if (m.ciroPrev != null && m.ciroPrev > 0) allVals.push(m.ciroPrev);
  }
  const max = Math.max(...allVals, 1);

  // Persentaj bazlı x (HTML overlay ile uyum için %)
  const xPct = (i: number) =>
    padXFrac * 100 + (i / (n - 1)) * (1 - padXFrac * 2) * 100;
  // SVG koordinatı (viewBox içi)
  const xVB = (i: number) => padXFrac * VB_W + (i / (n - 1)) * (1 - padXFrac * 2) * VB_W;
  const yVB = (val: number) => {
    const top = 18;
    const bot = 70;
    if (val <= 0) return bot;
    return bot - (val / max) * (bot - top);
  };

  const pathBuYil = enriched
    .map((m, i) => `${i === 0 ? "M" : "L"} ${xVB(i).toFixed(1)} ${yVB(m.ciro).toFixed(1)}`)
    .join(" ");

  const prevPts = enriched
    .map((m, i) => ({ x: xVB(i), y: m.ciroPrev != null && m.ciroPrev > 0 ? yVB(m.ciroPrev) : null }))
    .filter((p) => p.y != null) as Array<{ x: number; y: number }>;
  const pathGecenYil =
    prevPts.length >= 2
      ? prevPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
      : "";

  // Yaz, Ramazan range
  const summerIdx = enriched.map((m, i) => (m._isSummer ? i : -1)).filter((i) => i >= 0);
  const summerStart = summerIdx.length ? Math.min(...summerIdx) : -1;
  const summerEnd = summerIdx.length ? Math.max(...summerIdx) : -1;

  const ramazanIdx = enriched.map((m, i) => (m.isRamazan ? i : -1)).filter((i) => i >= 0);
  const ramazanStart = ramazanIdx.length ? Math.min(...ramazanIdx) : -1;
  const ramazanEnd = ramazanIdx.length ? Math.max(...ramazanIdx) : -1;

  // Bayram/Tatil dotları (Yılbaşı, 14 Şub, 29 Ekim)
  type Marker = { idx: number; label: string };
  const markers: Marker[] = [];
  enriched.forEach((m, i) => {
    if (m._monthNum === 1) markers.push({ idx: i, label: "Yılbaşı" });
    if (m._monthNum === 2) markers.push({ idx: i, label: "14 Şub" });
    if (m._monthNum === 10) markers.push({ idx: i, label: "29 Ekim" });
  });

  // Bugün y koordinatı (dot için)
  const todayY = yVB(enriched[lastIdx]?.ciro ?? 0);
  const todayX = xVB(lastIdx);

  return (
    <>
      <div className="section-eyebrow">Takvim · Bu Yıl vs Geçen Yıl Hizalı</div>
      <div className="cal-v2">
        {/* Ay etiketleri — HTML overlay (esnememesi için) */}
        <div className="cal-v2-months">
          {enriched.map((m, i) => {
            const [y, mo] = m.yyyymm.split("-");
            const showYear = i === 0 || Number(mo) === 1;
            const label = showYear ? `${m.ay}'${String(y).slice(2)}` : m.ay;
            return (
              <div
                key={`mlbl-${m.yyyymm}`}
                className={`cal-v2-month-lbl${m.isCurrent ? " current" : ""}`}
                style={{ left: `${xPct(i)}%` }}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* SVG: çizgiler, dotlar, bantlar (text yok) */}
        <svg
          className="cal-v2-svg"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
        >
          {pathGecenYil && (
            <path
              d={pathGecenYil}
              fill="none"
              stroke="#78716c"
              strokeWidth="2"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              opacity="0.6"
            />
          )}
          <path
            d={pathBuYil}
            fill="none"
            stroke="#6366f1"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={todayX}
            cy={todayY}
            r={5}
            fill="#dc2626"
            stroke="#ffffff"
            strokeWidth="2"
          />

          {/* Bantlar ve markerlar artık HTML overlay'de — burada yok */}
        </svg>

        {/* HTML overlay: 2 satır — Visuals (üst) + Labels (alt, hepsi aynı hizada) */}
        <div className="cal-v2-overlay">
          {/* Kırmızı "Bugün" inline text — dot'un sağında, eğri seviyesinde */}
          <div
            className="cal-v2-today-text"
            style={{
              left: `${xPct(lastIdx)}%`,
              top: `${(todayY / VB_H) * 80}px`,
            }}
          >
            Bugün
          </div>

          {/* Üst satır: tüm görsel öğeler (bantlar + dotlar) aynı Y'de */}
          <div className="cal-v2-visuals-row">
            {summerStart >= 0 && summerEnd >= 0 && summerEnd > summerStart && (
              <div
                className="cal-v2-band-line summer"
                style={{
                  left: `${xPct(summerStart)}%`,
                  width: `${xPct(summerEnd) - xPct(summerStart)}%`,
                }}
              />
            )}
            {ramazanStart >= 0 && (
              <div
                className="cal-v2-band-line ramazan"
                style={{
                  left: `${Math.max(0, xPct(ramazanStart) - 1.5)}%`,
                  width: `${xPct(ramazanEnd) - xPct(ramazanStart) + 3}%`,
                }}
              />
            )}
            {markers.map((mk) => (
              <span
                key={`mk-${mk.idx}-${mk.label}`}
                className="cal-v2-marker-dot"
                style={{ left: `${xPct(mk.idx)}%` }}
              />
            ))}
          </div>

          {/* Alt satır: tüm etiketler aynı Y'de (Yaz Pik, 29 Ekim, Yılbaşı, 14 Şub, Ramazan, May·Bugün) */}
          <div className="cal-v2-labels-row">
            {summerStart >= 0 && summerEnd >= 0 && summerEnd > summerStart && (
              <span
                className="cal-v2-lbl summer"
                style={{ left: `${(xPct(summerStart) + xPct(summerEnd)) / 2}%` }}
              >
                Yaz Pik
              </span>
            )}
            {markers.map((mk) => (
              <span
                key={`lbl-${mk.idx}-${mk.label}`}
                className="cal-v2-lbl marker"
                style={{ left: `${xPct(mk.idx)}%` }}
              >
                {mk.label}
              </span>
            ))}
            {ramazanStart >= 0 && (
              <span
                className="cal-v2-lbl ramazan"
                style={{ left: `${(xPct(ramazanStart) + xPct(ramazanEnd)) / 2}%` }}
              >
                Ramazan
              </span>
            )}
            <span
              className="cal-v2-lbl today-badge"
              style={{ left: `${xPct(lastIdx)}%` }}
            >
              {enriched[lastIdx]?.ay ?? ""} · Bugün
            </span>
          </div>
        </div>

        <div className="cal-v2-legend">
          <div className="legend-item">
            <span className="legend-dot" style={{ background: "#6366f1" }} /> Bu Yıl
          </div>
          <div className="legend-item">
            <span className="cal-v2-dash" /> Geçen Yıl
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: "#9333ea" }} /> Ramazan
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: "#16a34a" }} /> Yaz/Turistik Sezon
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: "#6366f1" }} /> Bayram/Tatil
          </div>
        </div>
      </div>
    </>
  );
}

// -- UPCOMING SEASON PANEL ---------------------------------------------------

function UpcomingPanel({
  event,
  regions,
}: {
  event: KomutaUpcomingEvent;
  regions: KomutaRegionRow[];
}) {
  const dateStr = new Date(event.date).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
  });
  const topGrowing = [...regions]
    .filter((c) => c.deltaPct != null)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];

  return (
    <div className="upcoming">
      <div className="upcoming-eyebrow">⏳ Yaklaşan Pik</div>
      <div className="upcoming-title">{event.name}</div>
      <div className="upcoming-date">{dateStr} · {event.daysAhead} gün kaldı</div>

      <div className="upcoming-stat-grid">
        {topGrowing && topGrowing.deltaPct != null && (
          <div className="upcoming-stat-row">
            <span className="lbl">En çok büyüyen: {topGrowing.bolge}</span>
            <span className="val">+%{topGrowing.deltaPct.toFixed(0)} YoY</span>
          </div>
        )}
        {regions.length > 0 && (
          <div className="upcoming-stat-row">
            <span className="lbl">Toplam aktif bölge</span>
            <span className="val">{regions.length}</span>
          </div>
        )}
        <div className="upcoming-stat-row">
          <span className="lbl">Etkinlik türü</span>
          <span className="val">{event.kind}</span>
        </div>
      </div>

      <div className="upcoming-action-row">
        Sahanın <span className="hi">{event.daysAhead} gün</span> içinde sezon planını
        hazırlaması gerekiyor.
        {topGrowing && (
          <> Geçen sezonun en çok büyüyen bölgesi: <span className="hi">{topGrowing.bolge}</span>.</>
        )}
      </div>

      <div className="upcoming-window">
        🚨 Pre-stocking penceresi <strong style={{ margin: "0 4px" }}>
          T-14 (yaklaşık {Math.max(0, event.daysAhead - 14)} gün sonra)
        </strong>
        kapanır — sahaya rotası bildirmek için son fırsat
      </div>
    </div>
  );
}

function UpcomingEmpty() {
  return (
    <div className="upcoming">
      <div className="upcoming-eyebrow">⏳ Yaklaşan Pik</div>
      <div className="upcoming-title">Yaklaşan büyük etkinlik yok</div>
      <div className="upcoming-date">Önümüzdeki 30 günde dini/milli/okul takvim olayı yok.</div>
    </div>
  );
}

// -- BRAND × PERIOD MATRIX ---------------------------------------------------

function MatrixPanel({
  matrix,
  unit,
}: {
  matrix: KomutaMatrixRow[];
  unit: ValueUnit;
}) {
  if (panelHidden("panel.cockpit.matrix")) return null;
  return (
    <div className="panel matrix-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">📋</span> {panelTitle("panel.cockpit.matrix", "Ürün Grubu × Dönem")}
          <InfoHint
            title="Matrix hesaplaması"
            source="TBLMSDFATURA × TBLMSDBELGEDETAY × TBLURUN × TBLURUNGRUP"
            window="5 dönem: bu ay, geçen ay, 3 ay önce, geçen yıl aynı ay, 2 yıl önce aynı ay"
            base="SUM(DBLNETFIYAT × DBLMIKTAR) detay-bazlı + PeriodScales ile fatura tabanına normalize"
            notes={[
              "Detay ciro fatura toplamından ~%5-15 farklı; her dönem için fatura/detay oranı (PeriodScales) hesaplanıp çarpılır",
              "TBLURUNGRUP join'inde LNGDISTKOD=u.LNGDISTKOD ekleme yapma (her ikisi NULL→JOIN boşalır)",
              "Reel TL modunda her dönem TÜFE multiplier'ı uygulanır",
              "Top 8 grup + \"Diğer\" (kalanların toplamı) + dip \"Toplam\" satırı",
            ]}
          />
        </div>
        <div className="panel-meta">Top 8 + Diğer + Toplam</div>
      </div>
      {matrix.length === 0 ? (
        <div className="empty-note">Ürün grubu verisi yok.</div>
      ) : (
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Ürün Grubu</th>
              <th className="current">Bu Ay<span className="sub">son 30g</span></th>
              <th>Geçen Ay<span className="sub">30-60g</span></th>
              <th>3 Ay Önce<span className="sub">90-120g</span></th>
              <th>Geçen Yıl<span className="sub">~365g</span></th>
              <th>2 Yıl Önce<span className="sub">~730g</span></th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr
                key={row.grup}
                className={row.isTotal ? "matrix-row-total" : row.isOther ? "matrix-row-other" : undefined}
              >
                <td title={row.grup}>
                  {truncate(row.grup, 28)}
                  {!row.isOther && !row.isTotal && <TierBadge tier={row.tier} />}
                </td>
                <td className="matrix-cell-current"><Val n={row.buAy} unit={unit} /></td>
                <td><Val n={row.gecenAy} unit={unit} /></td>
                <td><Val n={row.ucAyOnce} unit={unit} /></td>
                <td>
                  <Val n={row.gecenYil} unit={unit} />
                  {row.yoyPct != null && (
                    <span className={`delta-pill ${row.yoyPct >= 0 ? "up" : "down"}`}>
                      {row.yoyPct >= 0 ? "+" : ""}%{row.yoyPct.toFixed(0)}
                    </span>
                  )}
                </td>
                <td><Val n={row.ikiYilOnce} unit={unit} /></td>
                <td>{row.isTotal ? "Σ" : trendEmoji(row.trend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// -- HEATMAP -----------------------------------------------------------------

function HeatmapPanel({ heatmap }: { heatmap: KomutaHeatmapRow[] }) {
  if (panelHidden("panel.cockpit.heatmap")) return null;
  if (heatmap.length === 0) return null;
  const grupHeaders = heatmap[0]?.cells.map((c) => c.grup) ?? [];
  return (
    <div className="panel heatmap-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🔥</span> {panelTitle("panel.cockpit.heatmap", "Bölge × Ürün Grubu · YoY Değişim Heatmap")}
          <InfoHint
            title="Heatmap YoY hesaplaması"
            source="TBLMSDFATURA × TBLMSDBELGEDETAY × TBLURUN × TBLURUNGRUP × TBLDIST × TBLDISTGRUP"
            window="Son 30g vs -395..-365g (geçen yıl aynı pencere)"
            base="SUM(DBLNETFIYAT × DBLMIKTAR) her bölge × her grup hücresi"
            notes={[
              "Top 8 bölge × Top 8 grup + Diğer (detay ciro toplamına göre)",
              "yoyPct = (son − önceki)/önceki × 100; bucket sınıfı (fire/hot/warm/flat/cool/cold) Komuta CSS palette'i",
              "Sadece kırmızı (cool/cold) hücreler tıklanabilir → Finans Agentı modal",
            ]}
          />
        </div>
        <div className="panel-meta">Son 30g vs Geçen yıl aynı 30g</div>
      </div>
      <div
        className="heatmap-grid"
        style={{
          // Tüm sütunlar eşit — bölge / ürün grupları / ortalama hepsi 1fr
          gridTemplateColumns: `repeat(${grupHeaders.length + 2}, 1fr)`,
        }}
      >
        <div className="h-head">Bölge</div>
        {grupHeaders.map((g) => (
          <div key={g} className="h-head" title={g}>{truncate(g, 12)}</div>
        ))}
        <div className="h-head right">Bölge Ort.</div>

        {heatmap.map((row) => (
          <Fragment key={row.bolge}>
            <div className="h-region">
              {row.bolge} <span className="reg-sub">{row.distSayisi} distribütör</span>
            </div>
            {row.cells.map((cell, i) => {
              // Demo journey: sadece kırmızı (anomali) hücreler finans
              // analizini tetikler. Pozitif veya nötr hücrelere tıklama
              // hayal kırıklığı yaratmasın.
              const isAnomaly =
                (cell.bucket === "cool" || cell.bucket === "cold") &&
                cell.yoyPct != null;
              return (
                <div
                  key={i}
                  className={`h-cell ${cell.bucket}${isAnomaly ? " h-cell-clickable" : ""}`}
                  {...(isAnomaly
                    ? {
                        "data-finance-region": row.bolge,
                        "data-finance-product-group": cell.grup,
                        role: "button",
                        tabIndex: 0,
                        title: `${row.bolge} × ${cell.grup} — finans analizini aç`,
                      }
                    : {})}
                >
                  {cell.yoyPct == null ? "—" : `${cell.yoyPct >= 0 ? "+" : ""}%${cell.yoyPct.toFixed(0)}`}
                </div>
              );
            })}
            <div className="h-avg" style={row.rowAvgPct != null && row.rowAvgPct < 0 ? { color: "#dc2626" } : undefined}>
              {row.rowAvgPct == null ? "—" : `${row.rowAvgPct >= 0 ? "+" : ""}%${row.rowAvgPct.toFixed(1)}`}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// -- REP LEADERBOARD ---------------------------------------------------------

function RepLeaderboard({
  reps,
  unit,
}: {
  reps: KomutaRep[];
  unit: ValueUnit;
}) {
  if (panelHidden("panel.cockpit.reps")) return null;
  // Panel sözleşmesi "Top 10" — kaynak fazla satır dönse de ilk 10 gösterilir.
  const topReps = reps.slice(0, 10);
  const max = Math.max(1, ...topReps.map((r) => r.ciro));
  return (
    <div className="panel leaderboard">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🏆</span> {panelTitle("panel.cockpit.reps", "Top Satış Temsilcileri")}
          <InfoHint
            title="Satış temsilcisi sıralaması"
            source="TBLMSDFATURA × TBLSATISTEMSILCISI × TBLDIST"
            window="Son 30 gün"
            base="SUM(DBLNETTUTAR) her temsilci için + COUNT fatura"
            notes={[
              "Filtre: f.BYTTUR=0, f.BYTDURUM=0, s.BYTDURUM=0 (aktif temsilci)",
              "Top 10; sıralama ciro DESC",
            ]}
          />
        </div>
        <div className="panel-meta">Son 30g · ciro sırası</div>
      </div>
      {topReps.length === 0 ? (
        <div className="empty-note">Temsilci verisi yok.</div>
      ) : (
        topReps.map((r) => {
          const pct = (r.ciro / max) * 100;
          const tone = pct >= 70 ? "" : pct >= 40 ? " warn" : " bad";
          const pctTone = pct >= 70 ? "" : pct >= 40 ? "warn" : "bad";
          return (
            <div key={r.ad + r.rank} className="lb-row">
              <div className={`lb-rank${r.rank === 1 ? " top1" : r.rank === 2 ? " top2" : r.rank === 3 ? " top3" : ""}`}>
                {r.rank}
              </div>
              <div>
                <div className="lb-name">{r.ad}</div>
                {r.distributor && <span className="lb-region">{r.distributor}</span>}
              </div>
              <div className="lb-bar">
                <div className={`lb-bar-fill${tone}`} style={{ width: `${pct}%` }} />
              </div>
              <div className={`lb-pct ${pctTone}`}><Val n={r.ciro} unit={unit} /></div>
            </div>
          );
        })
      )}
    </div>
  );
}

// -- DIST LEADERBOARD --------------------------------------------------------
// Top distribütörler — son 30g ciro sırası. Reps leaderboard ile aynı yapı.

function DistLeaderboard({
  dists,
  unit,
}: {
  dists: KomutaTopDist[];
  unit: ValueUnit;
}) {
  if (panelHidden("panel.cockpit.dists")) return null;
  const max = Math.max(1, ...dists.map((d) => d.ciro));
  return (
    <div className="panel leaderboard">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🏢</span> {panelTitle("panel.cockpit.dists", "Top Distribütörler")}
          <InfoHint
            title="Distribütör sıralaması"
            source="TBLMSDFATURA × TBLDIST × TBLDISTEKGRUP"
            window="Son 30 gün"
            base="SUM(DBLNETTUTAR) her distribütör için + COUNT fatura"
            notes={[
              "Filtre: f.BYTTUR=0, f.BYTDURUM=0, d.BYTDURUM=0",
              "Bölge etiketi (TBLDISTEKGRUP.TXTAD) liste satırında görünür",
              "Top 10; sıralama ciro DESC",
            ]}
          />
        </div>
        <div className="panel-meta">Son 30g · ciro sırası</div>
      </div>
      {dists.length === 0 ? (
        <div className="empty-note">Distribütör verisi yok.</div>
      ) : (
        dists.map((d) => {
          const pct = (d.ciro / max) * 100;
          const tone = pct >= 70 ? "" : pct >= 40 ? " warn" : " bad";
          const pctTone = pct >= 70 ? "" : pct >= 40 ? "warn" : "bad";
          return (
            <div key={d.ad + d.rank} className="lb-row">
              <div className={`lb-rank${d.rank === 1 ? " top1" : d.rank === 2 ? " top2" : d.rank === 3 ? " top3" : ""}`}>
                {d.rank}
              </div>
              <div>
                <div className="lb-name">{d.ad}</div>
                {d.bolge && <span className="lb-region">{d.bolge}</span>}
              </div>
              <div className="lb-bar">
                <div className={`lb-bar-fill${tone}`} style={{ width: `${pct}%` }} />
              </div>
              <div className={`lb-pct ${pctTone}`}><Val n={d.ciro} unit={unit} /></div>
            </div>
          );
        })
      )}
    </div>
  );
}

// -- BRAND PORTFOLIO 2Y ------------------------------------------------------

function PortfolioPanel({
  portfolio,
  unit,
}: {
  portfolio: KomutaPortfolioRow[];
  unit: ValueUnit;
}) {
  if (panelHidden("panel.cockpit.portfolio")) return null;
  return (
    <div className="panel brand-portfolio">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🥃</span> {panelTitle("panel.cockpit.portfolio", "Ürün Grubu Portföyü · 2 Yıllık Yörünge")}
          <InfoHint
            title="Portföy hesaplaması"
            source="TBLMSDFATURA × TBLMSDBELGEDETAY × TBLURUN × TBLURUNGRUP"
            window="3 dönem: son 30g, geçen yıl aynı 30g (-395..-365g), 2 yıl önce aynı 30g (-760..-730g)"
            base="SUM(DBLNETFIYAT × DBLMIKTAR) detay-bazlı + PeriodScales ile fatura tabanına normalize"
            notes={[
              "Tier sınıflandırma (luxury/premium/core/value) ürün grubu adına göre keyword eşleşmesi",
              "yoyPct = (bu − geçenYıl)/geçenYıl × 100",
              "twoYrPct = (bu − ikiYılÖnce)/ikiYılÖnce × 100",
              "Reel TL/ÖTV modunda baz değerler multiplier ile bugünün TL'sine çevrilir",
            ]}
          />
        </div>
        <div className="panel-meta">Top 8 grup + Diğer</div>
      </div>
      {portfolio.length === 0 ? (
        <div className="empty-note">Portföy verisi yok.</div>
      ) : (
        <table className="bp-table">
          <thead>
            <tr>
              <th>Ürün Grubu</th>
              <th className="current">Son 30g</th>
              <th>1 yıl önce</th>
              <th>2 yıl önce</th>
              <th>YoY</th>
              <th>2-yıl Δ</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.map((p) => {
              const maxBar = Math.max(p.bu, p.oneYearAgo, p.twoYearsAgo) || 1;
              const h0 = (p.twoYearsAgo / maxBar) * 100;
              const h1 = (p.oneYearAgo / maxBar) * 100;
              const h2 = (p.bu / maxBar) * 100;
              const declining = p.yoyPct != null && p.yoyPct < 0;
              return (
                <tr key={p.grup}>
                  <td title={p.grup}>
                    {truncate(p.grup, 26)}
                    <TierBadge tier={p.tier} />
                  </td>
                  <td className="current"><Val n={p.bu} unit={unit} /></td>
                  <td className="right"><Val n={p.oneYearAgo} unit={unit} /></td>
                  <td className="right"><Val n={p.twoYearsAgo} unit={unit} /></td>
                  <td className="right">
                    {p.yoyPct == null ? (
                      "—"
                    ) : (
                      <span className={`delta-pill ${p.yoyPct >= 0 ? "up" : "down"}`}>
                        {p.yoyPct >= 0 ? "+" : ""}%{p.yoyPct.toFixed(0)}
                      </span>
                    )}
                  </td>
                  <td className="right">
                    {p.twoYrPct == null ? (
                      "—"
                    ) : (
                      <span className={`delta-pill ${p.twoYrPct >= 0 ? "up" : "down"}`}>
                        {p.twoYrPct >= 0 ? "+" : ""}%{p.twoYrPct.toFixed(0)}
                      </span>
                    )}
                  </td>
                  <td className="right">
                    <span className="bp-2yspark">
                      <span className="bar" style={{ height: `${h0}%` }} />
                      <span className="bar" style={{ height: `${h1}%` }} />
                      <span
                        className={`bar last${declining ? " declining" : ""}`}
                        style={{ height: `${h2}%` }}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// -- AI INSIGHT BAR ----------------------------------------------------------

function AiInsightBar({ brief }: { brief: string }) {
  if (panelHidden("panel.cockpit.brief")) return null;
  return (
    <div className="ai-insight">
      <div className="ai-icon">✨</div>
      <div className="ai-text">
        <div className="ai-title">{panelTitle("panel.cockpit.brief", "UNIQUE AI · Bu Sabahın Yorumu")}</div>
        <div className="ai-body" dangerouslySetInnerHTML={{ __html: brief }} />
      </div>
    </div>
  );
}

function Footer({ generatedAt }: { generatedAt: string }) {
  return (
    <div className="footer-bar">
      <span>
        UNIQUE AI Reports · Univera veri kaynağı · son sorgulama:{" "}
        {new Date(generatedAt).toLocaleString("tr-TR")}
      </span>
      <span>Görünüm: CEO / Satış Direktörü</span>
    </div>
  );
}

// ============================================================================
// Utils
// ============================================================================

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "Mr";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toString();
}

/** Snapshot.unit suffix'i ile compact format — TL modunda "₺", 9L modunda "9L".
 *  Sayı normal boy, birim küçük + silik bir span olarak yan yana — birbirine
 *  karışmasın. */
function Val({ n, unit }: { n: number; unit: ValueUnit }) {
  const suffix = unit === "9le" ? "9L" : "₺";
  return (
    <>
      {formatCompact(n)}
      <span
        style={{
          fontSize: "0.72em",
          opacity: 0.55,
          fontWeight: 500,
          marginLeft: "0.32em",
          letterSpacing: "0.02em",
        }}
      >
        {suffix}
      </span>
    </>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function trendEmoji(t: KomutaMatrixRow["trend"]): string {
  if (t === "rocket") return "🚀";
  if (t === "up") return "📈";
  if (t === "down") return "📉";
  return "📊";
}

function TierBadge({ tier }: { tier: ProductTier }) {
  if (tier === "value") return null;
  const label = tier === "luxury" ? "LUX" : tier === "premium" ? "PREM" : "CORE";
  return <span className={`tier-badge tier-${tier}`}>{label}</span>;
}

function formatRelative(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "az önce";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

// ============================================================================
// CSS — Komuta Köprüsü scoped theme (orijinal mockup'tan adapte)
// ============================================================================

// V1 inline kopya — V2 layout `components/komuta/komuta-css.ts` modülünden
// aynı içeriği import eder. Refactor adımı: V1'i de import'a çevir.
const KOMUTA_CSS = `
.komuta-root {
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 4px 0 20px 0;
  -webkit-font-smoothing: antialiased;
}
.komuta-root * { box-sizing: border-box; }

/* PAGE HEADER — risk/ziyaret sayfalarındaki tasarıma uyumlu */
.komuta-root .komuta-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 18px;
}
.komuta-root .komuta-page-header-main { flex: 1; }
.komuta-root .komuta-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 8px;
}
.komuta-root .komuta-eyebrow-dot {
  width: 6px; height: 6px;
  background: #6366f1;
  border-radius: 50%;
  animation: komuta-pulse 2s infinite;
}
.komuta-root .komuta-page-title {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.3px;
  color: #1c1917;
  margin: 0 0 6px 0;
  line-height: 1.15;
}
.komuta-root .komuta-page-desc {
  font-size: 14px;
  color: #44403c;
  line-height: 1.55;
  margin: 0;
  max-width: 720px;
}
.komuta-root .komuta-page-desc strong { color: #1c1917; font-weight: 600; }
.komuta-root .komuta-page-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  flex-shrink: 0;
}
.komuta-root .live-indicator {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; background: rgba(22, 163, 74, 0.1);
  border: 1px solid rgba(22, 163, 74, 0.25); border-radius: 999px;
  font-size: 11px; color: #16a34a;
}
.komuta-root .live-dot { width: 6px; height: 6px; background: #16a34a; border-radius: 50%; animation: komuta-pulse 2s infinite; }
.komuta-root .refresh-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; background: #6366f1;
  border: 1px solid #6366f1; border-radius: 6px;
  font-size: 12px; color: #ffffff; font-weight: 500; text-decoration: none;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(28, 25, 23, 0.05);
}
.komuta-root .refresh-btn:hover { background: #4f46e5; }
@keyframes komuta-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* FILTER BAR */
.komuta-root .filter-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; background: #ffffff; border: 1px solid #d6d3d1;
  border-radius: 8px; margin-bottom: 14px;
}
.komuta-root .filter-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: #fafaf9; border: 1px solid #d6d3d1;
  border-radius: 6px; font-size: 12px; color: #44403c; cursor: pointer;
}
.komuta-root .filter-chip.active { background: rgba(99, 102, 241, 0.12); border-color: #6366f1; color: #6366f1; }
.komuta-root .filter-chip .caret { font-size: 9px; opacity: 0.6; }
.komuta-root .filter-spacer { flex: 1; }
.komuta-root .toggle-group { display: flex; gap: 8px; }
.komuta-root .toggle {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: #fafaf9; border: 1px solid #d6d3d1;
  border-radius: 6px; font-size: 11px; color: #78716c; cursor: help;
}
.komuta-root .toggle.on { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.4); color: #6366f1; }
.komuta-root .toggle-link { text-decoration: none; cursor: pointer; }
.komuta-root .toggle-link:hover { border-color: rgba(99, 102, 241, 0.6); }
.komuta-root .switch { width: 26px; height: 14px; background: #d6d3d1; border-radius: 999px; position: relative; flex-shrink: 0; }
.komuta-root .switch::after { content: ''; position: absolute; width: 10px; height: 10px; background: #78716c; border-radius: 50%; top: 2px; left: 2px; transition: 0.2s; }
.komuta-root .toggle.on .switch { background: #6366f1; }
.komuta-root .toggle.on .switch::after { background: #ffffff; left: 14px; }

/* CALENDAR BANNER */
.komuta-root .cal-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.12) 0%, rgba(99, 102, 241, 0.04) 100%);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-left: 3px solid #6366f1;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .cal-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .cal-banner-text { flex: 1; color: #44403c; line-height: 1.5; }
.komuta-root .cal-banner-text strong { color: #1c1917; font-weight: 600; }
.komuta-root .cal-banner-cta {
  flex-shrink: 0; padding: 5px 12px;
  background: rgba(99, 102, 241, 0.18); border: 1px solid rgba(99, 102, 241, 0.4);
  border-radius: 5px; font-size: 11px; color: #6366f1; cursor: pointer; font-weight: 500;
  text-decoration: none;
}

/* REEL TL banner (toggle aktif olduğunda) */
.komuta-root .demo-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px;
  background: rgba(217, 119, 6, 0.10);
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 999px;
  font-size: 11px; font-weight: 600; color: #b45309;
  letter-spacing: 0.2px; white-space: nowrap;
}
.komuta-root .demo-badge-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #d97706; flex-shrink: 0;
}

.komuta-root .reel-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: linear-gradient(90deg, rgba(147, 51, 234, 0.14) 0%, rgba(147, 51, 234, 0.04) 100%);
  border: 1px solid rgba(147, 51, 234, 0.35);
  border-left: 3px solid #9333ea;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .reel-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .reel-banner-text { flex: 1; color: #44403c; line-height: 1.5; }
.komuta-root .reel-banner-text strong { color: #1c1917; font-weight: 600; }
.komuta-root .reel-banner-cta {
  flex-shrink: 0; padding: 5px 12px;
  background: rgba(147, 51, 234, 0.18); border: 1px solid rgba(147, 51, 234, 0.4);
  border-radius: 5px; font-size: 11px; color: #9333ea; font-weight: 500;
  text-decoration: none;
}
.komuta-root .reel-banner-cta:hover { background: rgba(147, 51, 234, 0.28); }

/* ÖTV-net banner (toggle aktif olduğunda) */
.komuta-root .otv-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: linear-gradient(90deg, rgba(22, 163, 74, 0.12) 0%, rgba(22, 163, 74, 0.04) 100%);
  border: 1px solid rgba(22, 163, 74, 0.3);
  border-left: 3px solid #16a34a;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .otv-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .otv-banner-text { flex: 1; color: #44403c; line-height: 1.5; }
.komuta-root .otv-banner-text strong { color: #1c1917; font-weight: 600; }
.komuta-root .otv-banner-cta {
  flex-shrink: 0; padding: 5px 12px;
  background: rgba(22, 163, 74, 0.18); border: 1px solid rgba(22, 163, 74, 0.4);
  border-radius: 5px; font-size: 11px; color: #16a34a; font-weight: 500;
  text-decoration: none;
}
.komuta-root .otv-banner-cta:hover { background: rgba(22, 163, 74, 0.28); }

/* KPI STRIP */
.komuta-root .kpi-strip-wrap { margin-bottom: 14px; }
.komuta-root .kpi-strip-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; padding: 0 2px; }
.komuta-root .kpi-strip-label { font-size: 10.5px; color: #6366f1; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
.komuta-root .kpi-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.komuta-root .kpi-card {
  background: #ffffff; border: 1px solid #d6d3d1; border-radius: 10px;
  padding: 14px 16px; position: relative; overflow: hidden;
}
.komuta-root .kpi-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent, #6366f1), transparent);
  opacity: 0.6;
}
.komuta-root .kpi-label {
  font-size: 10.5px; color: #78716c; text-transform: uppercase;
  letter-spacing: 0.6px; font-weight: 500; margin-bottom: 8px;
}
.komuta-root .kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -0.6px; color: #1c1917; line-height: 1.1; }
.komuta-root .kpi-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; flex-wrap: wrap; }
.komuta-root .delta-up { color: #16a34a; }
.komuta-root .delta-down { color: #dc2626; }
.komuta-root .kpi-sub { color: #a8a29e; font-size: 10.5px; }

/* MAIN GRID */
.komuta-root .main-grid {
  display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; margin-bottom: 14px;
}
.komuta-root .panel {
  background: #ffffff; border: 1px solid #d6d3d1; border-radius: 10px;
  padding: 16px;
}
.komuta-root .panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.komuta-root .panel-title { font-size: 13px; font-weight: 600; color: #1c1917; display: flex; align-items: center; gap: 8px; }
.komuta-root .panel-title .icon { font-size: 14px; }
.komuta-root .panel-meta { font-size: 11px; color: #78716c; }
.komuta-root .map-panel-meta { display: flex; align-items: center; gap: 12px; }
.komuta-root .empty-note { color: #a8a29e; font-size: 12px; padding: 20px 0; text-align: center; }

/* TURKEY MAP */
.komuta-root .map-panel { position: relative; }
.komuta-root .map-svg { width: 100%; height: 360px; display: block; }
.komuta-root .map-legend {
  margin-top: 8px; padding: 8px 12px;
  background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;
  font-size: 10.5px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
}
.komuta-root .map-panel .legend-item { display: flex; align-items: center; gap: 5px; color: #44403c; }
.komuta-root .map-panel .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.komuta-root .map-unplaced-pills {
  margin-top: 12px; padding: 10px 12px;
  background: rgba(120, 113, 108, 0.04); border: 1px solid #e7e5e4;
  border-radius: 6px;
}
.komuta-root .map-unplaced-label {
  font-size: 10px; color: #78716c; text-transform: uppercase;
  letter-spacing: 0.6px; font-weight: 600; margin-bottom: 8px;
}
.komuta-root .map-unplaced-row {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.komuta-root .unplaced-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  background: #fafaf9; border: 1px solid #d6d3d1;
  font-size: 11px; color: #44403c;
  max-width: 100%; min-width: 0;
}
.komuta-root .unplaced-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.komuta-root .unplaced-pill.tone-hot .unplaced-dot { background: #16a34a; }
.komuta-root .unplaced-pill.tone-medium .unplaced-dot { background: #6366f1; }
.komuta-root .unplaced-pill.tone-muted .unplaced-dot { background: #78716c; }
.komuta-root .unplaced-pill.tone-cool .unplaced-dot { background: #dc2626; }
.komuta-root .unplaced-pill.tone-hot { border-color: rgba(22, 163, 74, 0.3); }
.komuta-root .unplaced-pill.tone-medium { border-color: rgba(99, 102, 241, 0.3); }
.komuta-root .unplaced-pill.tone-cool { border-color: rgba(220, 38, 38, 0.3); }
.komuta-root .unplaced-name {
  font-weight: 500; max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.komuta-root .unplaced-num {
  color: #1c1917; font-weight: 600; font-feature-settings: "tnum"; font-size: 10.5px;
}
.komuta-root .unplaced-delta {
  font-feature-settings: "tnum"; font-weight: 600; font-size: 10.5px;
  padding: 1px 5px; border-radius: 3px;
}
.komuta-root .unplaced-pill.tone-hot .unplaced-delta {
  background: rgba(22, 163, 74, 0.15); color: #16a34a;
}
.komuta-root .unplaced-pill.tone-medium .unplaced-delta {
  background: rgba(99, 102, 241, 0.15); color: #6366f1;
}
.komuta-root .unplaced-pill.tone-muted .unplaced-delta {
  background: rgba(120, 113, 108, 0.15); color: #78716c;
}
.komuta-root .unplaced-pill.tone-cool .unplaced-delta {
  background: rgba(220, 38, 38, 0.15); color: #dc2626;
}

/* DONUT + TREND */
.komuta-root .donut-wrap { display: flex; align-items: center; gap: 18px; margin-bottom: 12px; }
.komuta-root .donut-svg { width: 130px; height: 130px; flex-shrink: 0; }
.komuta-root .channel-list { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.komuta-root .channel-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 12px; }
.komuta-root .channel-name { display: flex; align-items: center; gap: 8px; color: #44403c; min-width: 0; flex: 1; }
.komuta-root .channel-pip { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.komuta-root .channel-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.komuta-root .channel-num { color: #1c1917; font-weight: 600; font-feature-settings: "tnum"; }
.komuta-root .channel-pct { color: #78716c; font-size: 11px; margin-left: 6px; font-feature-settings: "tnum"; }
.komuta-root .trend-mini { display: flex; gap: 4px; align-items: flex-end; height: 60px; padding: 8px 0; border-top: 1px solid #e7e5e4; }
.komuta-root .trend-bar { flex: 1; background: linear-gradient(180deg, #6366f1, #4f46e5); border-radius: 2px 2px 0 0; min-height: 6px; opacity: 0.85; }
.komuta-root .trend-bar.peak { background: linear-gradient(180deg, #a16207, #6366f1); opacity: 1; }
.komuta-root .trend-bar.ramazan { background: linear-gradient(180deg, #9333ea, #9333ea); opacity: 0.6; }
.komuta-root .trend-labels { display: flex; gap: 4px; font-size: 10px; color: #a8a29e; margin-top: 4px; }
.komuta-root .trend-labels span { flex: 1; text-align: center; }

/* CALENDAR SHRED */
.komuta-root .section-eyebrow {
  font-size: 10px; color: #a8a29e; text-transform: uppercase; letter-spacing: 0.8px;
  margin: 18px 0 8px 4px; font-weight: 600;
}
.komuta-root .calendar-track {
  position: relative; height: 130px;
  background: linear-gradient(180deg, #ffffff 0%, #ffffff 100%);
  border: 1px solid #d6d3d1; border-radius: 8px;
  padding: 12px 16px 8px 16px;
  margin-bottom: 14px;
}
.komuta-root .cal-month-grid { position: relative; display: grid; grid-template-columns: repeat(12, 1fr); height: 100%; }
.komuta-root .cal-month { border-right: 1px dashed #e7e5e4; position: relative; padding: 0 4px; }
.komuta-root .cal-month:last-child { border-right: none; }
.komuta-root .cal-month-label { font-size: 10px; color: #a8a29e; text-align: center; padding-top: 4px; font-weight: 500; }
.komuta-root .cal-month-label.current { color: #6366f1; font-weight: 700; }
.komuta-root .cal-trend-svg { position: absolute; left: 16px; right: 16px; top: 36px; height: 60px; width: calc(100% - 32px); }
.komuta-root .cal-legend-row { display: flex; gap: 16px; padding: 8px 4px 0 4px; font-size: 10.5px; color: #78716c; }
.komuta-root .legend-item { display: flex; align-items: center; gap: 5px; color: #44403c; }
.komuta-root .legend-dot { width: 8px; height: 8px; border-radius: 50%; }

/* CALENDAR V2 — mockup parity (HTML overlay + SVG hybrid, 3-row band area) */
.komuta-root .cal-v2 {
  position: relative;
  background: linear-gradient(180deg, #ffffff 0%, #ffffff 100%);
  border: 1px solid #d6d3d1;
  border-radius: 8px;
  padding: 10px 16px 6px 16px;
  margin-bottom: 14px;
  height: 168px;
  box-sizing: border-box;
}
.komuta-root .cal-v2-months {
  position: absolute;
  inset: 10px 16px auto 16px;
  height: 16px;
}
.komuta-root .cal-v2-month-lbl {
  position: absolute;
  transform: translateX(-50%);
  font-size: 10.5px;
  color: #a8a29e;
  font-weight: 500;
  white-space: nowrap;
}
.komuta-root .cal-v2-month-lbl.current { color: #6366f1; font-weight: 700; }

/* SVG: sadece eğriler ve bugün dot — bantlar yok */
.komuta-root .cal-v2-svg {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 28px;
  width: calc(100% - 32px);
  height: 80px;
}

/* Overlay container: SVG'nin altında, 2-satır bant/marker alanı */
.komuta-root .cal-v2-overlay {
  position: absolute;
  inset: 28px 16px 24px 16px;
  pointer-events: none;
}

/* 2 satır: üst (görseller) + alt (etiketler aynı hizada) */
.komuta-root .cal-v2-visuals-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 84px;
  height: 12px;
}
.komuta-root .cal-v2-labels-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 100px;
  height: 16px;
}

.komuta-root .cal-v2-band-line {
  position: absolute;
  top: 4px;
  height: 4px;
  border-radius: 2px;
}
.komuta-root .cal-v2-band-line.summer  { background: #16a34a; }
.komuta-root .cal-v2-band-line.ramazan { background: #9333ea; }

.komuta-root .cal-v2-marker-dot {
  position: absolute;
  top: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6366f1;
  border: 1px solid #ffffff;
  transform: translateX(-50%);
}

.komuta-root .cal-v2-lbl {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  line-height: 14px;
}
.komuta-root .cal-v2-lbl.summer  { color: #16a34a; }
.komuta-root .cal-v2-lbl.ramazan { color: #9333ea; }
.komuta-root .cal-v2-lbl.marker  { color: #78716c; font-weight: 500; }
.komuta-root .cal-v2-lbl.today-badge {
  color: #dc2626;
  font-weight: 700;
  background: rgba(220, 38, 38, 0.12);
  border: 1px solid #dc2626;
  border-radius: 3px;
  padding: 0 5px;
  font-size: 9px;
  line-height: 14px;
  transform: translateX(-100%);
}

/* "Bugün" kırmızı yazı — eğri seviyesinde dot'un sağında */
.komuta-root .cal-v2-today-text {
  position: absolute;
  transform: translate(10px, -50%);
  font-size: 11px;
  font-weight: 700;
  color: #dc2626;
  white-space: nowrap;
  pointer-events: none;
}

.komuta-root .cal-v2-legend {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding-top: 4px;
  border-top: 1px solid #e7e5e4;
  font-size: 10px;
  color: #44403c;
}
.komuta-root .cal-v2-dash {
  display: inline-block;
  width: 14px;
  height: 0;
  border-top: 1.5px dashed #78716c;
  vertical-align: middle;
}

/* BATTLE GRID */
.komuta-root .battle-grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 14px; margin-bottom: 14px; }
.komuta-root .upcoming {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(147, 51, 234, 0.06));
  border: 1px solid #d6d3d1; border-radius: 10px; padding: 18px;
  position: relative; overflow: hidden;
}
.komuta-root .upcoming::before {
  content: ''; position: absolute; top: 0; right: 0; width: 100px; height: 100px;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, transparent 70%);
  pointer-events: none;
}
.komuta-root .upcoming-eyebrow { font-size: 10.5px; color: #6366f1; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; margin-bottom: 6px; position: relative; }
.komuta-root .upcoming-title { font-size: 22px; font-weight: 700; color: #1c1917; letter-spacing: -0.5px; margin-bottom: 4px; position: relative; }
.komuta-root .upcoming-date { font-size: 12px; color: #78716c; margin-bottom: 14px; position: relative; }
.komuta-root .upcoming-stat-grid { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: #fafaf9; border: 1px solid #d6d3d1; border-radius: 6px; margin-bottom: 12px; position: relative; }
.komuta-root .upcoming-stat-row { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; padding: 3px 0; }
.komuta-root .upcoming-stat-row .lbl { color: #78716c; }
.komuta-root .upcoming-stat-row .val { font-weight: 600; color: #16a34a; font-feature-settings: "tnum"; }
.komuta-root .upcoming-action-row { font-size: 12px; color: #44403c; line-height: 1.5; margin-bottom: 8px; position: relative; }
.komuta-root .upcoming-action-row .hi { color: #6366f1; font-weight: 600; }
.komuta-root .upcoming-window { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(220, 38, 38, 0.08); border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 6px; font-size: 11.5px; color: #dc2626; font-weight: 500; position: relative; }

/* MATRIX */
.komuta-root .matrix-panel { padding: 16px; }
.komuta-root .matrix-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.komuta-root .matrix-table th { text-align: right; padding: 8px 10px; font-size: 10px; color: #78716c; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #d6d3d1; }
.komuta-root .matrix-table th:first-child { text-align: left; }
.komuta-root .matrix-table th .sub { display: block; font-size: 9px; color: #a8a29e; font-weight: 500; text-transform: none; letter-spacing: 0; margin-top: 2px; }
.komuta-root .matrix-table th.current { color: #6366f1; }
.komuta-root .matrix-table td { padding: 7px 10px; border-bottom: 1px solid #e7e5e4; text-align: right; font-feature-settings: "tnum"; color: #44403c; }
.komuta-root .matrix-table td:first-child { text-align: left; color: #1c1917; font-weight: 500; }
.komuta-root .matrix-table tr:last-child td { border-bottom: none; }
.komuta-root .matrix-table tr:hover td { background: rgba(99, 102, 241, 0.04); }
.komuta-root .matrix-cell-current { background: rgba(99, 102, 241, 0.06); color: #6366f1 !important; font-weight: 600; }
.komuta-root .matrix-row-other td { color: #78716c; font-style: italic; }
.komuta-root .matrix-row-other td:first-child { color: #78716c; font-weight: 500; }
.komuta-root .matrix-row-total td { border-top: 1.5px solid #d6d3d1; background: #fafaf9; font-weight: 700; }
.komuta-root .matrix-row-total td:first-child { color: #1c1917; font-weight: 700; }
.komuta-root .delta-pill { display: inline-block; font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; font-weight: 600; }
.komuta-root .delta-pill.up { background: rgba(22, 163, 74, 0.15); color: #16a34a; }
.komuta-root .delta-pill.down { background: rgba(220, 38, 38, 0.15); color: #dc2626; }

/* HEATMAP */
.komuta-root .heatmap-panel { padding: 16px; margin-bottom: 14px; }
.komuta-root .heatmap-grid { display: grid; gap: 4px; font-size: 11px; }
.komuta-root .heatmap-grid > .h-head { display: flex; align-items: center; justify-content: center; text-align: center; padding: 6px 4px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; border-bottom: 1px solid #d6d3d1; min-height: 32px; }
.komuta-root .heatmap-grid .h-region { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 6px 6px; min-height: 48px; color: #1c1917; font-weight: 600; font-size: 10.5px; border-bottom: 1px solid #e7e5e4; gap: 2px; overflow: hidden; }
.komuta-root .heatmap-grid .h-region .reg-sub { font-size: 9px; color: #a8a29e; font-weight: 400; }
.komuta-root .heatmap-grid .h-cell { display: flex; align-items: center; justify-content: center; padding: 6px 4px; min-height: 48px; text-align: center; font-feature-settings: "tnum"; font-weight: 600; border-bottom: 1px solid #e7e5e4; border-radius: 4px; }
/* Heatmap paleti — 3 pastel ton: kırmızı (negatif) / gri (nötr) / yeşil (pozitif). */
.komuta-root .heatmap-grid .h-cell.cold,
.komuta-root .heatmap-grid .h-cell.cool { background: #fecaca; color: #991b1b; }
.komuta-root .heatmap-grid .h-cell.flat { background: #f5f5f4; color: #57534e; }
.komuta-root .heatmap-grid .h-cell.warm,
.komuta-root .heatmap-grid .h-cell.hot,
.komuta-root .heatmap-grid .h-cell.fire { background: #bbf7d0; color: #166534; }
.komuta-root .heatmap-grid .h-cell.h-cell-clickable { cursor: pointer; position: relative; transition: filter 0.15s, transform 0.15s, box-shadow 0.15s; }
.komuta-root .heatmap-grid .h-cell.h-cell-clickable:hover { filter: brightness(0.96) saturate(1.1); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(127, 29, 29, 0.18); }
.komuta-root .heatmap-grid .h-cell.h-cell-clickable:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
.komuta-root .heatmap-grid .h-avg { display: flex; align-items: center; justify-content: center; padding: 6px 4px; min-height: 48px; text-align: center; font-feature-settings: "tnum"; color: #6366f1; font-weight: 700; font-size: 11.5px; border-bottom: 1px solid #e7e5e4; border-radius: 4px; background: #fafaf9; }

/* BOTTOM GRID */
.komuta-root .bottom-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
.komuta-root .leaderboard .lb-row { display: grid; grid-template-columns: 22px 1fr 80px 90px; gap: 10px; padding: 8px 0; border-bottom: 1px solid #e7e5e4; align-items: center; font-size: 12px; }
.komuta-root .lb-row:last-child { border-bottom: none; }
.komuta-root .lb-rank { width: 22px; height: 22px; border-radius: 50%; background: #e7e5e4; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #78716c; }
.komuta-root .lb-rank.top1 { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #ffffff; }
.komuta-root .lb-rank.top2 { background: #a8a29e; color: #ffffff; }
.komuta-root .lb-rank.top3 { background: #92400e; color: #ffffff; }
.komuta-root .lb-name { color: #1c1917; }
.komuta-root .lb-region { color: #a8a29e; font-size: 10.5px; display: block; margin-top: 1px; }
.komuta-root .lb-bar { height: 6px; background: #e7e5e4; border-radius: 3px; overflow: hidden; }
.komuta-root .lb-bar-fill { height: 100%; background: linear-gradient(90deg, #16a34a, #16a34a); border-radius: 3px; }
.komuta-root .lb-bar-fill.warn { background: linear-gradient(90deg, #6366f1, #a16207); }
.komuta-root .lb-bar-fill.bad { background: linear-gradient(90deg, #dc2626, #b91c1c); }
.komuta-root .lb-pct { font-size: 11.5px; font-weight: 600; text-align: right; font-feature-settings: "tnum"; color: #1c1917; }
.komuta-root .lb-pct.bad { color: #dc2626; }
.komuta-root .lb-pct.warn { color: #6366f1; }

/* BRAND PORTFOLIO */
.komuta-root .brand-portfolio { padding: 16px; }
.komuta-root .bp-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.komuta-root .bp-table th { text-align: right; padding: 8px 10px; font-size: 10px; color: #78716c; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #d6d3d1; }
.komuta-root .bp-table th:first-child { text-align: left; }
.komuta-root .bp-table th.current { color: #6366f1; }
.komuta-root .bp-table td { padding: 9px 10px; border-bottom: 1px solid #e7e5e4; font-feature-settings: "tnum"; color: #44403c; }
.komuta-root .bp-table td:first-child { color: #1c1917; font-weight: 500; }
.komuta-root .bp-table td.current { color: #6366f1; font-weight: 600; text-align: right; }
.komuta-root .bp-table td.right { text-align: right; }
.komuta-root .bp-table tr:last-child td { border-bottom: none; }
.komuta-root .bp-2yspark { display: inline-flex; gap: 2px; align-items: flex-end; height: 18px; }
.komuta-root .bp-2yspark .bar { width: 4px; background: #6366f1; border-radius: 1px; opacity: 0.7; }
.komuta-root .bp-2yspark .bar.last { opacity: 1; background: linear-gradient(180deg, #a16207, #6366f1); }
.komuta-root .bp-2yspark .bar.last.declining { background: linear-gradient(180deg, #dc2626, #b91c1c); }

/* TIER BADGES (PREM / LUX / CORE) */
.komuta-root .tier-badge {
  display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px;
  margin-left: 6px; vertical-align: middle; font-weight: 600;
  letter-spacing: 0.3px; text-transform: uppercase;
  border: 1px solid;
}
.komuta-root .tier-luxury {
  background: rgba(147, 51, 234, 0.12);
  color: #9333ea;
  border-color: rgba(147, 51, 234, 0.35);
}
.komuta-root .tier-premium {
  background: rgba(99, 102, 241, 0.15);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.35);
}
.komuta-root .tier-core {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.3);
}

/* AI INSIGHT */
.komuta-root .ai-insight {
  margin-top: 14px; padding: 14px 18px;
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(99, 102, 241, 0.02) 100%);
  border: 1px solid rgba(99, 102, 241, 0.25); border-left: 3px solid #6366f1;
  border-radius: 8px; display: flex; gap: 14px; align-items: flex-start;
}
.komuta-root .ai-icon {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: #ffffff;
}
.komuta-root .ai-text { flex: 1; min-width: 0; }
.komuta-root .ai-title { font-size: 11px; font-weight: 600; color: #6366f1; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.komuta-root .ai-body { font-size: 12.5px; color: #44403c; line-height: 1.6; }
.komuta-root .ai-body strong { color: #1c1917; }
.komuta-root .ai-body p { margin-bottom: 8px; }

.komuta-root .footer-bar {
  margin-top: 14px; padding: 10px 16px; display: flex; justify-content: space-between;
  font-size: 11px; color: #a8a29e; flex-wrap: wrap; gap: 8px;
}

/* =============================================================================
 * DARK MODE — Komuta sayfasının light hardcoded hex'leri için koyu varyant.
 * Mantık: light hardcoded değerler aşağıdaki gibi takipli override edilir;
 * surface'ler zinc, kart fill'leri koyu, fg yumuşak beyaz, kırmızı/yeşil
 * accent'ler hafif desature'lı.
 * ============================================================================= */
:root[data-theme="dark"] .komuta-root {
  background: var(--color-bg);
  color: var(--color-fg);
}
:root[data-theme="dark"] .komuta-root .panel,
:root[data-theme="dark"] .komuta-root .kpi-card,
:root[data-theme="dark"] .komuta-root .upcoming,
:root[data-theme="dark"] .komuta-root .ai-insight,
:root[data-theme="dark"] .komuta-root .channel-mix-card,
:root[data-theme="dark"] .komuta-root .cal-v2,
:root[data-theme="dark"] .komuta-root .filter-bar,
:root[data-theme="dark"] .komuta-root .demo-banner,
:root[data-theme="dark"] .komuta-root .reel-banner,
:root[data-theme="dark"] .komuta-root .otv-banner {
  background: var(--color-surface) !important;
  border-color: var(--color-border) !important;
  color: var(--color-fg) !important;
}
:root[data-theme="dark"] .komuta-root .komuta-eyebrow,
:root[data-theme="dark"] .komuta-root .section-eyebrow,
:root[data-theme="dark"] .komuta-root .panel-meta,
:root[data-theme="dark"] .komuta-root .kpi-label,
:root[data-theme="dark"] .komuta-root .kpi-strip-label,
:root[data-theme="dark"] .komuta-root .kpi-sub,
:root[data-theme="dark"] .komuta-root .kpi-meta {
  color: var(--color-muted) !important;
}
:root[data-theme="dark"] .komuta-root .panel-title,
:root[data-theme="dark"] .komuta-root h1,
:root[data-theme="dark"] .komuta-root h2,
:root[data-theme="dark"] .komuta-root h3,
:root[data-theme="dark"] .komuta-root .kpi-value,
:root[data-theme="dark"] .komuta-root .h-region {
  color: var(--color-fg) !important;
}
:root[data-theme="dark"] .komuta-root .empty-note,
:root[data-theme="dark"] .komuta-root .lb-region,
:root[data-theme="dark"] .komuta-root .upcoming-stat-row .lbl,
:root[data-theme="dark"] .komuta-root .channel-name {
  color: var(--color-fg-2) !important;
}
:root[data-theme="dark"] .komuta-root .lb-bar,
:root[data-theme="dark"] .komuta-root .trend-bar,
:root[data-theme="dark"] .komuta-root .channel-pip,
:root[data-theme="dark"] .komuta-root .legend-dot {
  /* color: kalır (data-driven), zemin sadece koyulaştırılır */
}
:root[data-theme="dark"] .komuta-root .lb-bar { background: var(--color-surface-2) !important; }
:root[data-theme="dark"] .komuta-root .trend-mini,
:root[data-theme="dark"] .komuta-root .trend-labels span {
  color: var(--color-muted) !important;
}
:root[data-theme="dark"] .komuta-root .delta-up { color: var(--color-good) !important; }
:root[data-theme="dark"] .komuta-root .delta-down { color: var(--color-bad) !important; }

/* Heatmap — pastel tonlar dark mode değişkenlerine işaret eder */
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.cold,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.cool {
  background: var(--color-heat-neg-bg);
  color: var(--color-heat-neg-fg);
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.flat {
  background: var(--color-heat-flat-bg);
  color: var(--color-heat-flat-fg);
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.warm,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.hot,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.fire {
  background: var(--color-heat-pos-bg);
  color: var(--color-heat-pos-fg);
}
:root[data-theme="dark"] .komuta-root .heatmap-grid > .h-head {
  color: var(--color-muted) !important;
  border-bottom-color: var(--color-border-strong) !important;
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-avg {
  background: var(--color-surface-2) !important;
  color: var(--color-accent) !important;
  border-bottom-color: var(--color-border) !important;
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-region,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell {
  border-bottom-color: var(--color-border) !important;
}

/* AI insight kartı — dark zeminde indigo-soft tinted */
:root[data-theme="dark"] .komuta-root .ai-insight {
  background: linear-gradient(180deg, var(--color-accent-soft) 0%, var(--color-surface) 100%) !important;
}
:root[data-theme="dark"] .komuta-root .ai-title { color: var(--color-accent) !important; }
:root[data-theme="dark"] .komuta-root .ai-body { color: var(--color-fg-2) !important; }
:root[data-theme="dark"] .komuta-root .ai-body strong { color: var(--color-fg) !important; }

/* Footer ve filter chip'leri */
:root[data-theme="dark"] .komuta-root .footer-bar,
:root[data-theme="dark"] .komuta-root .filter-bar .filter-meta {
  color: var(--color-muted-2) !important;
}

/* TurkeyMap (eski stilize SVG dead code) ve calendar legend */
:root[data-theme="dark"] .komuta-root .cal-v2-legend {
  color: var(--color-muted) !important;
  border-top-color: var(--color-border) !important;
}
:root[data-theme="dark"] .komuta-root .cal-v2-month-lbl {
  color: var(--color-muted) !important;
}

/* Channel mix donut/list (eski TBLMUSTERIGRUP komponenti hâlâ render edilebilir) */
:root[data-theme="dark"] .komuta-root .channel-row {
  border-bottom-color: var(--color-border) !important;
}

/* ---- Geniş kapsamlı renk override'ı ------------------------------------- */
/* Tüm hardcoded "siyah text" (#1c1917) → fg */
:root[data-theme="dark"] .komuta-root .komuta-page-desc strong,
:root[data-theme="dark"] .komuta-root .cal-banner-text strong,
:root[data-theme="dark"] .komuta-root .demo-banner-text strong,
:root[data-theme="dark"] .komuta-root .reel-banner-text strong,
:root[data-theme="dark"] .komuta-root .otv-banner-text strong,
:root[data-theme="dark"] .komuta-root .kpi-value,
:root[data-theme="dark"] .komuta-root .panel-title,
:root[data-theme="dark"] .komuta-root .upcoming-title,
:root[data-theme="dark"] .komuta-root .lb-name,
:root[data-theme="dark"] .komuta-root .lb-pct,
:root[data-theme="dark"] .komuta-root .channel-num,
:root[data-theme="dark"] .komuta-root .matrix-table td:first-child {
  color: var(--color-fg) !important;
}

/* Tüm hardcoded "orta gri text" (#44403c) → fg-2 */
:root[data-theme="dark"] .komuta-root .komuta-page-desc,
:root[data-theme="dark"] .komuta-root .cal-banner-text,
:root[data-theme="dark"] .komuta-root .demo-banner-text,
:root[data-theme="dark"] .komuta-root .reel-banner-text,
:root[data-theme="dark"] .komuta-root .otv-banner-text,
:root[data-theme="dark"] .komuta-root .map-panel .legend-item,
:root[data-theme="dark"] .komuta-root .matrix-table td,
:root[data-theme="dark"] .komuta-root .upcoming-action-row,
:root[data-theme="dark"] .komuta-root .bp-table td,
:root[data-theme="dark"] .komuta-root .channel-name,
:root[data-theme="dark"] .komuta-root .legend-item,
:root[data-theme="dark"] .komuta-root .ai-body,
:root[data-theme="dark"] .komuta-root .toggle,
:root[data-theme="dark"] .komuta-root .toggle-pill {
  color: var(--color-fg-2) !important;
}

/* Tüm hardcoded light backgroundlar (#ffffff, #fafaf9) → surface / surface-2 */
:root[data-theme="dark"] .komuta-root .toggle,
:root[data-theme="dark"] .komuta-root .toggle-pill,
:root[data-theme="dark"] .komuta-root .switch,
:root[data-theme="dark"] .komuta-root .map-panel .legend,
:root[data-theme="dark"] .komuta-root .upcoming-stat-grid,
:root[data-theme="dark"] .komuta-root .channel-mix-card,
:root[data-theme="dark"] .komuta-root .matrix-card,
:root[data-theme="dark"] .komuta-root .bp-card {
  background: var(--color-surface-2) !important;
  border-color: var(--color-border) !important;
}

/* Toggle switch top'ı (knob) — dark zeminde de hâlâ beyaz */
:root[data-theme="dark"] .komuta-root .toggle.on .switch::after,
:root[data-theme="dark"] .komuta-root .switch::after {
  background: var(--color-fg) !important;
}

/* Matrix / bp tablo border'ları */
:root[data-theme="dark"] .komuta-root .matrix-table td,
:root[data-theme="dark"] .komuta-root .bp-table td,
:root[data-theme="dark"] .komuta-root .matrix-table th,
:root[data-theme="dark"] .komuta-root .bp-table th {
  border-bottom-color: var(--color-border) !important;
}

/* md16 — "Diğer" (katlanmış) ve "Toplam" (dip toplam) satırları */
:root[data-theme="dark"] .komuta-root .matrix-row-other td {
  color: var(--color-muted) !important;
}
:root[data-theme="dark"] .komuta-root .matrix-row-total td {
  background: var(--color-surface-2) !important;
  border-top-color: var(--color-border-strong, var(--color-border)) !important;
}
:root[data-theme="dark"] .komuta-root .matrix-row-total td:first-child {
  color: var(--color-fg) !important;
}
`;
