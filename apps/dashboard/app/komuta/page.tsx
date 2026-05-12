import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  KomutaHeatmapRow,
  KomutaKpiCard,
  KomutaMatrixRow,
  KomutaMonthlyBar,
  KomutaPortfolioRow,
  KomutaRegionRow,
  KomutaRep,
  KomutaSnapshot,
  KomutaUpcomingEvent,
  ProductTier,
} from "@/lib/api";
import { getKomutaSnapshot } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Komuta Köprüsü · UNIQUE AI Reports",
};

type Props = {
  searchParams: Promise<{ refresh?: string }>;
};

export default async function KomutaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const forceRefresh = sp.refresh === "1";
  let snap: KomutaSnapshot;
  try {
    snap = await getKomutaSnapshot({ refresh: forceRefresh });
  } catch {
    notFound();
  }

  return (
    <>
      {/* Komuta Köprüsü kendi koyu temalı stilini taşır — global navbar bu
          sayfada gizleniyor (components/ui/navbar.tsx). */}
      <style dangerouslySetInnerHTML={{ __html: KOMUTA_CSS }} />
      <div className="komuta-root">
        <Header generatedAt={snap.generatedAt} />
        <FilterBar />
        <KpiStrip kpis={snap.kpis} />
        {snap.upcomingEvent && <CalendarBanner event={snap.upcomingEvent} />}

        <div className="main-grid">
          <TurkeyMap regions={snap.regions} />
          <ChannelMix
            channels={snap.channels}
            monthly={snap.monthlyTrend}
          />
        </div>

        <CalendarShred monthly={snap.monthlyTrend} />

        <div className="battle-grid">
          {snap.upcomingEvent ? (
            <UpcomingPanel event={snap.upcomingEvent} regions={snap.regions} />
          ) : (
            <UpcomingEmpty />
          )}
          <MatrixPanel matrix={snap.matrix} />
        </div>

        <HeatmapPanel heatmap={snap.heatmap} />

        <div className="bottom-grid">
          <RepLeaderboard reps={snap.reps} />
          <PortfolioPanel portfolio={snap.portfolio} />
        </div>

        {snap.brief && <AiInsightBar brief={snap.brief} />}

        <Footer generatedAt={snap.generatedAt} />
      </div>
    </>
  );
}

// ============================================================================
// Components
// ============================================================================

function Header({ generatedAt }: { generatedAt: string }) {
  const rel = formatRelative(generatedAt);
  return (
    <div className="header">
      <div className="brand">
        <Link href="/" className="brand-mark">U</Link>
        <div className="brand-text">
          <h1>UNIQUE AI Reports · Komuta Köprüsü</h1>
          <div className="sub">Univera Distribütör Operasyonu · CEO / Satış Direktörü Görünümü</div>
        </div>
      </div>
      <div className="breadcrumb">
        <strong>Tüm Distribütörler</strong>
        {"  ›  "}Son 30 Gün
        {"  ›  "}<span style={{ color: "#d4a857" }}>Tüm Ürünler</span>
      </div>
      <div className="header-right">
        <span className="live-indicator">
          <span className="live-dot" />
          Canlı veri · {rel}
        </span>
        <Link href="/komuta?refresh=1" className="refresh-btn" prefetch={false}>
          ↻ Yenile
        </Link>
        <Link href="/" className="back-link">← Pusula</Link>
      </div>
    </div>
  );
}

function FilterBar() {
  return (
    <div className="filter-bar">
      <span className="filter-chip active">Bölge: Tümü <span className="caret">▼</span></span>
      <span className="filter-chip">Kanal: Tümü <span className="caret">▼</span></span>
      <span className="filter-chip">Ürün Grubu: Tümü <span className="caret">▼</span></span>
      <span className="filter-chip">Periyot: Son 30 gün <span className="caret">▼</span></span>
      <span className="filter-chip">Karşılaştır: Geçen Yıl Aynı Dönem <span className="caret">▼</span></span>
      <span className="filter-spacer" />
      <div className="toggle-group">
        <span className="toggle" title="TÜFE arındırma için bir endeks entegrasyonu gerekir — v2'de eklenecek">
          <span className="switch" /> Reel TL (TÜFE)
        </span>
        <span className="toggle" title="Ürün başına ÖTV oranı master tablosu gerekir — v2'de eklenecek">
          <span className="switch" /> ÖTV-net görünüm
        </span>
        <span className="toggle on" title="Takvim hizalı kıyas — calendar/tr-2026.json üzerinden">
          <span className="switch" /> Takvim hizalı
        </span>
      </div>
    </div>
  );
}

// -- KPI STRIP ---------------------------------------------------------------

function KpiStrip({ kpis }: { kpis: KomutaKpiCard[] }) {
  if (!kpis || kpis.length === 0) {
    return <div className="empty-note">KPI verisi alınamadı.</div>;
  }
  // Color accent per card matches mockup palette
  const accents = ["#d4a857", "#3fb950", "#c084fc", "#58a6ff", "#3fb950"];
  return (
    <div className="kpi-strip">
      {kpis.map((k, i) => (
        <div
          key={k.id}
          className="kpi-card"
          style={{ ["--accent" as string]: accents[i] ?? "#d4a857" }}
        >
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{formatKpi(k)}</div>
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
  );
}

function formatKpi(k: KomutaKpiCard): string {
  if (k.format === "currency") {
    return `${Math.round(k.value).toLocaleString("tr-TR")} ${k.unit ?? ""}`.trim();
  }
  if (k.format === "compact") {
    return `${formatCompact(k.value)} ${k.unit ?? ""}`.trim();
  }
  if (k.format === "percent") {
    return `%${k.value.toFixed(1)}`;
  }
  // count
  return k.value.toLocaleString("tr-TR");
}

// -- CALENDAR BANNER ---------------------------------------------------------

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
        {" · "}<span style={{ color: "#8b949e" }}>
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
  // İstanbul ve çevresi
  "ISTANBUL": { x: 150, y: 115 },
  "ISTANBUL AVRUPA": { x: 130, y: 110 },
  "ISTANBUL ANADOLU": { x: 175, y: 118 },
  "ISTANBUL 1": { x: 130, y: 110 },
  "ISTANBUL 2": { x: 175, y: 118 },
  // Marmara
  "MARMARA": { x: 195, y: 135 },
  "TRAKYA": { x: 110, y: 105 },
  "BURSA": { x: 175, y: 135 },
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
  // İç Anadolu / Ankara
  "ANKARA": { x: 290, y: 155 },
  "IC ANADOLU": { x: 305, y: 175 },
  "IC ANADOLU/ANKARA": { x: 290, y: 158 },
  "IC ANADOLU ANKARA": { x: 290, y: 158 },
  // Karadeniz
  "KARADENIZ": { x: 380, y: 105 },
  "DOGU KARADENIZ": { x: 450, y: 105 },
  "BATI KARADENIZ": { x: 290, y: 105 },
  // Doğu / Güneydoğu
  "DOGU": { x: 480, y: 150 },
  "DOGU ANADOLU": { x: 480, y: 150 },
  "GUNEYDOGU": { x: 425, y: 215 },
  "GUNEYDOGU ANADOLU": { x: 425, y: 215 },
  // KKTC
  "KKTC": { x: 290, y: 285 },
  "LEFKOSA": { x: 290, y: 285 },
  "GAZIMAGUSA": { x: 290, y: 285 },
  "KIBRIS": { x: 290, y: 285 },
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
        </div>
        <div className="panel-meta">
          {placed.length} bölge haritada
          {unplaced.length > 0 && ` · ${unplaced.length} liste dışı`}
        </div>
      </div>

      <svg className="map-svg" viewBox="0 0 600 320" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="komuta-hot" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#3fb950" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#3fb950" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="komuta-medium" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#d4a857" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#d4a857" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="komuta-muted" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#8b949e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#8b949e" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="komuta-cool" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#f85149" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#f85149" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Türkiye ana kara parçası (stilize, mockup'tan) */}
        <path
          d="M 50,140 Q 60,110 100,100 L 180,90 Q 240,85 290,95 L 360,90 Q 420,85 480,100 L 540,120 Q 555,140 550,170 L 540,210 Q 510,235 460,235 L 380,240 Q 320,245 260,240 L 180,235 Q 110,230 70,210 Q 45,180 50,140 Z"
          fill="#161b22"
          stroke="#30363d"
          strokeWidth="1.2"
        />
        {/* KKTC */}
        <ellipse cx="290" cy="285" rx="32" ry="10" fill="#161b22" stroke="#30363d" strokeWidth="1" />
        <text x="290" y="287" textAnchor="middle" fill="#6e7681" fontSize="9" fontWeight="500">
          KKTC
        </text>

        {/* Bölge blob'ları — büyükten küçüğe (üst üste binerse büyük arkada) */}
        {[...placed]
          .sort((a, b) => b.ciro - a.ciro)
          .map((c) => {
            const tone = blobTone(c.deltaPct);
            const ratio = Math.sqrt(c.ciro / maxCiro);
            const blobR = Math.max(12, 14 + ratio * 36);
            const dotR = c.ciro >= maxCiro * 0.3 ? 5 : 3.5;
            const isAnomaly = tone === "cool";
            const fontWeight = c.ciro >= maxCiro * 0.4 ? 600 : 500;
            const fontSize = c.ciro >= maxCiro * 0.4 ? 11 : 9.5;
            const labelColor =
              tone === "hot" ? "#56d364"
                : tone === "medium" ? "#d4a857"
                : tone === "cool" ? "#f85149"
                : "#c9d1d9";
            const dotColor =
              tone === "hot" ? "#3fb950"
                : tone === "medium" ? "#d4a857"
                : tone === "cool" ? "#f85149"
                : "#8b949e";
            return (
              <g key={c.bolge}>
                <circle cx={c.x} cy={c.y} r={blobR} fill={`url(#komuta-${tone})`} />
                <circle cx={c.x} cy={c.y} r={dotR} fill={dotColor} />
                <text
                  x={c.x + dotR + 6}
                  y={c.y + 2}
                  fill="#e6edf3"
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
          <span className="legend-dot" style={{ background: "#3fb950" }} /> YoY +%15+
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: "#d4a857" }} /> +%5 ile +%15
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: "#8b949e" }} /> ±%5
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: "#f85149" }} /> Anomali
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
          <span className="icon">📊</span> Distribütör Kırılımı · 30 gün
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
          <text x="50" y="48" textAnchor="middle" fill="#e6edf3" fontSize="11" fontWeight="700">
            {channels.length} kanal
          </text>
          <text x="50" y="60" textAnchor="middle" fill="#8b949e" fontSize="6.5">
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
                  color: m.isRamazan ? "#c084fc" : m.isCurrent ? "#d4a857" : undefined,
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
  const max = Math.max(...monthly.map((m) => m.ciro));
  const points = monthly
    .map((m, i) => {
      const x = (i / (monthly.length - 1)) * 1200;
      const y = 50 - (m.ciro / max) * 40;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <>
      <div className="section-eyebrow">Takvim · 12 Aylık Eğri</div>
      <div className="calendar-track">
        <div className="cal-month-grid">
          {monthly.map((m) => (
            <div key={m.yyyymm} className="cal-month">
              <div className={`cal-month-label${m.isCurrent ? " current" : ""}`}>
                {m.ay}
              </div>
            </div>
          ))}
        </div>
        <svg className="cal-trend-svg" viewBox="0 0 1200 60" preserveAspectRatio="none">
          <polyline points={points} fill="none" stroke="#d4a857" strokeWidth="2.5" />
          <circle
            cx="1200"
            cy={50 - ((monthly[monthly.length - 1]?.ciro ?? 0) / max) * 40}
            r="5"
            fill="#f85149"
            stroke="#0d1117"
            strokeWidth="2"
          />
        </svg>
        <div className="cal-legend-row">
          <div className="legend-item">
            <span className="legend-dot" style={{ background: "#d4a857" }} /> Son 12 ay ciro
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: "#c084fc" }} /> Ramazan ayı
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: "#f85149" }} /> Bugün
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

function MatrixPanel({ matrix }: { matrix: KomutaMatrixRow[] }) {
  return (
    <div className="panel matrix-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">📋</span> Ürün Grubu × Dönem · Net Ciro Karşılaştırma
        </div>
        <div className="panel-meta">Top 8 grup</div>
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
              <tr key={row.grup}>
                <td title={row.grup}>
                  {truncate(row.grup, 28)}
                  <TierBadge tier={row.tier} />
                </td>
                <td className="matrix-cell-current">{formatCompact(row.buAy)} ₺</td>
                <td>{formatCompact(row.gecenAy)} ₺</td>
                <td>{formatCompact(row.ucAyOnce)} ₺</td>
                <td>
                  {formatCompact(row.gecenYil)} ₺
                  {row.yoyPct != null && (
                    <span className={`delta-pill ${row.yoyPct >= 0 ? "up" : "down"}`}>
                      {row.yoyPct >= 0 ? "+" : ""}%{row.yoyPct.toFixed(0)}
                    </span>
                  )}
                </td>
                <td>{formatCompact(row.ikiYilOnce)} ₺</td>
                <td>{trendEmoji(row.trend)}</td>
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
  if (heatmap.length === 0) return null;
  const grupHeaders = heatmap[0]?.cells.map((c) => c.grup) ?? [];
  return (
    <div className="panel heatmap-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🔥</span> Bölge × Ürün Grubu · YoY Değişim Heatmap
        </div>
        <div className="panel-meta">Son 30g vs Geçen yıl aynı 30g</div>
      </div>
      <div
        className="heatmap-grid"
        style={{
          gridTemplateColumns: `180px repeat(${grupHeaders.length}, 1fr) 80px`,
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
            {row.cells.map((cell, i) => (
              <div key={i} className={`h-cell ${cell.bucket}`}>
                {cell.yoyPct == null ? "—" : `${cell.yoyPct >= 0 ? "+" : ""}%${cell.yoyPct.toFixed(0)}`}
              </div>
            ))}
            <div className="h-avg" style={row.rowAvgPct != null && row.rowAvgPct < 0 ? { color: "#f85149" } : undefined}>
              {row.rowAvgPct == null ? "—" : `${row.rowAvgPct >= 0 ? "+" : ""}%${row.rowAvgPct.toFixed(1)}`}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// -- REP LEADERBOARD ---------------------------------------------------------

function RepLeaderboard({ reps }: { reps: KomutaRep[] }) {
  const max = Math.max(1, ...reps.map((r) => r.ciro));
  return (
    <div className="panel leaderboard">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🏆</span> Top Satış Temsilcileri
        </div>
        <div className="panel-meta">Son 30g · ciro sırası</div>
      </div>
      {reps.length === 0 ? (
        <div className="empty-note">Temsilci verisi yok.</div>
      ) : (
        reps.map((r) => {
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
              <div className={`lb-pct ${pctTone}`}>{formatCompact(r.ciro)} ₺</div>
            </div>
          );
        })
      )}
    </div>
  );
}

// -- BRAND PORTFOLIO 2Y ------------------------------------------------------

function PortfolioPanel({ portfolio }: { portfolio: KomutaPortfolioRow[] }) {
  return (
    <div className="panel brand-portfolio">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🥃</span> Ürün Grubu Portföyü · 2 Yıllık Yörünge
        </div>
        <div className="panel-meta">Top 10 grup</div>
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
                  <td className="current">{formatCompact(p.bu)} ₺</td>
                  <td className="right">{formatCompact(p.oneYearAgo)} ₺</td>
                  <td className="right">{formatCompact(p.twoYearsAgo)} ₺</td>
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
  return (
    <div className="ai-insight">
      <div className="ai-icon">✨</div>
      <div className="ai-text">
        <div className="ai-title">UNIQUE AI · Bu Sabahın Yorumu</div>
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

const KOMUTA_CSS = `
.komuta-root {
  background: #0d1117; color: #e6edf3;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif;
  font-size: 13px;
  min-height: 100vh;
  padding: 18px;
  -webkit-font-smoothing: antialiased;
}
.komuta-root * { box-sizing: border-box; }

/* HEADER */
.komuta-root .header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; background: linear-gradient(135deg, #161b22 0%, #1c2128 100%);
  border: 1px solid #30363d; border-radius: 10px; margin-bottom: 14px;
}
.komuta-root .brand { display: flex; align-items: center; gap: 14px; }
.komuta-root .brand-mark {
  width: 36px; height: 36px; border-radius: 8px;
  background: linear-gradient(135deg, #d4a857, #8b6914);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; color: #0d1117; font-size: 15px;
  box-shadow: 0 2px 8px rgba(212, 168, 87, 0.3);
  text-decoration: none;
}
.komuta-root .brand-text h1 { font-size: 14px; font-weight: 600; letter-spacing: -0.2px; margin: 0; }
.komuta-root .brand-text .sub { font-size: 11px; color: #8b949e; margin-top: 2px; }
.komuta-root .breadcrumb { font-size: 12px; color: #8b949e; }
.komuta-root .breadcrumb strong { color: #e6edf3; font-weight: 500; }
.komuta-root .header-right { display: flex; align-items: center; gap: 16px; font-size: 12px; }
.komuta-root .live-indicator {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; background: rgba(63, 185, 80, 0.12);
  border: 1px solid rgba(63, 185, 80, 0.3); border-radius: 999px;
  font-size: 11px; color: #56d364;
}
.komuta-root .live-dot { width: 6px; height: 6px; background: #3fb950; border-radius: 50%; animation: komuta-pulse 2s infinite; }
.komuta-root .back-link { color: #8b949e; text-decoration: none; font-size: 11px; }
.komuta-root .back-link:hover { color: #d4a857; }
.komuta-root .refresh-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; background: rgba(212, 168, 87, 0.12);
  border: 1px solid rgba(212, 168, 87, 0.3); border-radius: 6px;
  font-size: 11px; color: #d4a857; text-decoration: none;
  cursor: pointer;
}
.komuta-root .refresh-btn:hover { background: rgba(212, 168, 87, 0.2); }
@keyframes komuta-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* FILTER BAR */
.komuta-root .filter-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; background: #161b22; border: 1px solid #30363d;
  border-radius: 8px; margin-bottom: 14px;
}
.komuta-root .filter-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: #1c2128; border: 1px solid #30363d;
  border-radius: 6px; font-size: 12px; color: #c9d1d9; cursor: pointer;
}
.komuta-root .filter-chip.active { background: rgba(212, 168, 87, 0.12); border-color: #d4a857; color: #d4a857; }
.komuta-root .filter-chip .caret { font-size: 9px; opacity: 0.6; }
.komuta-root .filter-spacer { flex: 1; }
.komuta-root .toggle-group { display: flex; gap: 8px; }
.komuta-root .toggle {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: #1c2128; border: 1px solid #30363d;
  border-radius: 6px; font-size: 11px; color: #8b949e; cursor: help;
}
.komuta-root .toggle.on { background: rgba(212, 168, 87, 0.12); border-color: rgba(212, 168, 87, 0.4); color: #d4a857; }
.komuta-root .switch { width: 26px; height: 14px; background: #30363d; border-radius: 999px; position: relative; flex-shrink: 0; }
.komuta-root .switch::after { content: ''; position: absolute; width: 10px; height: 10px; background: #8b949e; border-radius: 50%; top: 2px; left: 2px; transition: 0.2s; }
.komuta-root .toggle.on .switch { background: #d4a857; }
.komuta-root .toggle.on .switch::after { background: #0d1117; left: 14px; }

/* CALENDAR BANNER */
.komuta-root .cal-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: linear-gradient(90deg, rgba(212, 168, 87, 0.12) 0%, rgba(212, 168, 87, 0.04) 100%);
  border: 1px solid rgba(212, 168, 87, 0.3);
  border-left: 3px solid #d4a857;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .cal-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .cal-banner-text { flex: 1; color: #c9d1d9; line-height: 1.5; }
.komuta-root .cal-banner-text strong { color: #e6edf3; font-weight: 600; }
.komuta-root .cal-banner-cta {
  flex-shrink: 0; padding: 5px 12px;
  background: rgba(212, 168, 87, 0.18); border: 1px solid rgba(212, 168, 87, 0.4);
  border-radius: 5px; font-size: 11px; color: #d4a857; cursor: pointer; font-weight: 500;
}

/* KPI STRIP */
.komuta-root .kpi-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 14px; }
.komuta-root .kpi-card {
  background: #161b22; border: 1px solid #30363d; border-radius: 10px;
  padding: 14px 16px; position: relative; overflow: hidden;
}
.komuta-root .kpi-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent, #d4a857), transparent);
  opacity: 0.6;
}
.komuta-root .kpi-label {
  font-size: 10.5px; color: #8b949e; text-transform: uppercase;
  letter-spacing: 0.6px; font-weight: 500; margin-bottom: 8px;
}
.komuta-root .kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -0.6px; color: #e6edf3; line-height: 1.1; }
.komuta-root .kpi-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; flex-wrap: wrap; }
.komuta-root .delta-up { color: #3fb950; }
.komuta-root .delta-down { color: #f85149; }
.komuta-root .kpi-sub { color: #6e7681; font-size: 10.5px; }

/* MAIN GRID */
.komuta-root .main-grid {
  display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; margin-bottom: 14px;
}
.komuta-root .panel {
  background: #161b22; border: 1px solid #30363d; border-radius: 10px;
  padding: 16px;
}
.komuta-root .panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.komuta-root .panel-title { font-size: 13px; font-weight: 600; color: #e6edf3; display: flex; align-items: center; gap: 8px; }
.komuta-root .panel-title .icon { font-size: 14px; }
.komuta-root .panel-meta { font-size: 11px; color: #8b949e; }
.komuta-root .empty-note { color: #6e7681; font-size: 12px; padding: 20px 0; text-align: center; }

/* TURKEY MAP */
.komuta-root .map-panel { position: relative; }
.komuta-root .map-svg { width: 100%; height: 360px; display: block; }
.komuta-root .map-legend {
  margin-top: 8px; padding: 8px 12px;
  background: rgba(13, 17, 23, 0.4); border: 1px solid #21262d; border-radius: 6px;
  font-size: 10.5px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
}
.komuta-root .map-panel .legend-item { display: flex; align-items: center; gap: 5px; color: #c9d1d9; }
.komuta-root .map-panel .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.komuta-root .map-unplaced-pills {
  margin-top: 12px; padding: 10px 12px;
  background: rgba(139, 148, 158, 0.04); border: 1px solid #21262d;
  border-radius: 6px;
}
.komuta-root .map-unplaced-label {
  font-size: 10px; color: #8b949e; text-transform: uppercase;
  letter-spacing: 0.6px; font-weight: 600; margin-bottom: 8px;
}
.komuta-root .map-unplaced-row {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.komuta-root .unplaced-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  background: rgba(13, 17, 23, 0.6); border: 1px solid #30363d;
  font-size: 11px; color: #c9d1d9;
  max-width: 100%; min-width: 0;
}
.komuta-root .unplaced-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.komuta-root .unplaced-pill.tone-hot .unplaced-dot { background: #3fb950; }
.komuta-root .unplaced-pill.tone-medium .unplaced-dot { background: #d4a857; }
.komuta-root .unplaced-pill.tone-muted .unplaced-dot { background: #8b949e; }
.komuta-root .unplaced-pill.tone-cool .unplaced-dot { background: #f85149; }
.komuta-root .unplaced-pill.tone-hot { border-color: rgba(63, 185, 80, 0.3); }
.komuta-root .unplaced-pill.tone-medium { border-color: rgba(212, 168, 87, 0.3); }
.komuta-root .unplaced-pill.tone-cool { border-color: rgba(248, 81, 73, 0.3); }
.komuta-root .unplaced-name {
  font-weight: 500; max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.komuta-root .unplaced-num {
  color: #e6edf3; font-weight: 600; font-feature-settings: "tnum"; font-size: 10.5px;
}
.komuta-root .unplaced-delta {
  font-feature-settings: "tnum"; font-weight: 600; font-size: 10.5px;
  padding: 1px 5px; border-radius: 3px;
}
.komuta-root .unplaced-pill.tone-hot .unplaced-delta {
  background: rgba(63, 185, 80, 0.15); color: #56d364;
}
.komuta-root .unplaced-pill.tone-medium .unplaced-delta {
  background: rgba(212, 168, 87, 0.15); color: #d4a857;
}
.komuta-root .unplaced-pill.tone-muted .unplaced-delta {
  background: rgba(139, 148, 158, 0.15); color: #8b949e;
}
.komuta-root .unplaced-pill.tone-cool .unplaced-delta {
  background: rgba(248, 81, 73, 0.15); color: #f85149;
}

/* DONUT + TREND */
.komuta-root .donut-wrap { display: flex; align-items: center; gap: 18px; margin-bottom: 12px; }
.komuta-root .donut-svg { width: 130px; height: 130px; flex-shrink: 0; }
.komuta-root .channel-list { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.komuta-root .channel-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 12px; }
.komuta-root .channel-name { display: flex; align-items: center; gap: 8px; color: #c9d1d9; min-width: 0; flex: 1; }
.komuta-root .channel-pip { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.komuta-root .channel-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.komuta-root .channel-num { color: #e6edf3; font-weight: 600; font-feature-settings: "tnum"; }
.komuta-root .channel-pct { color: #8b949e; font-size: 11px; margin-left: 6px; font-feature-settings: "tnum"; }
.komuta-root .trend-mini { display: flex; gap: 4px; align-items: flex-end; height: 60px; padding: 8px 0; border-top: 1px solid #21262d; }
.komuta-root .trend-bar { flex: 1; background: linear-gradient(180deg, #d4a857, #8b6914); border-radius: 2px 2px 0 0; min-height: 6px; opacity: 0.85; }
.komuta-root .trend-bar.peak { background: linear-gradient(180deg, #f0c674, #d4a857); opacity: 1; }
.komuta-root .trend-bar.ramazan { background: linear-gradient(180deg, #c084fc, #9333ea); opacity: 0.6; }
.komuta-root .trend-labels { display: flex; gap: 4px; font-size: 10px; color: #6e7681; margin-top: 4px; }
.komuta-root .trend-labels span { flex: 1; text-align: center; }

/* CALENDAR SHRED */
.komuta-root .section-eyebrow {
  font-size: 10px; color: #6e7681; text-transform: uppercase; letter-spacing: 0.8px;
  margin: 18px 0 8px 4px; font-weight: 600;
}
.komuta-root .calendar-track {
  position: relative; height: 130px;
  background: linear-gradient(180deg, #0d1117 0%, #161b22 100%);
  border: 1px solid #30363d; border-radius: 8px;
  padding: 12px 16px 8px 16px;
  margin-bottom: 14px;
}
.komuta-root .cal-month-grid { position: relative; display: grid; grid-template-columns: repeat(12, 1fr); height: 100%; }
.komuta-root .cal-month { border-right: 1px dashed #21262d; position: relative; padding: 0 4px; }
.komuta-root .cal-month:last-child { border-right: none; }
.komuta-root .cal-month-label { font-size: 10px; color: #6e7681; text-align: center; padding-top: 4px; font-weight: 500; }
.komuta-root .cal-month-label.current { color: #d4a857; font-weight: 700; }
.komuta-root .cal-trend-svg { position: absolute; left: 16px; right: 16px; top: 36px; height: 60px; width: calc(100% - 32px); }
.komuta-root .cal-legend-row { display: flex; gap: 16px; padding: 8px 4px 0 4px; font-size: 10.5px; color: #8b949e; }
.komuta-root .legend-item { display: flex; align-items: center; gap: 5px; color: #c9d1d9; }
.komuta-root .legend-dot { width: 8px; height: 8px; border-radius: 50%; }

/* BATTLE GRID */
.komuta-root .battle-grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 14px; margin-bottom: 14px; }
.komuta-root .upcoming {
  background: linear-gradient(135deg, rgba(212, 168, 87, 0.08), rgba(192, 132, 252, 0.06));
  border: 1px solid #30363d; border-radius: 10px; padding: 18px;
  position: relative; overflow: hidden;
}
.komuta-root .upcoming::before {
  content: ''; position: absolute; top: 0; right: 0; width: 100px; height: 100px;
  background: radial-gradient(circle, rgba(212, 168, 87, 0.2) 0%, transparent 70%);
  pointer-events: none;
}
.komuta-root .upcoming-eyebrow { font-size: 10.5px; color: #d4a857; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; margin-bottom: 6px; position: relative; }
.komuta-root .upcoming-title { font-size: 22px; font-weight: 700; color: #e6edf3; letter-spacing: -0.5px; margin-bottom: 4px; position: relative; }
.komuta-root .upcoming-date { font-size: 12px; color: #8b949e; margin-bottom: 14px; position: relative; }
.komuta-root .upcoming-stat-grid { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: rgba(13, 17, 23, 0.6); border: 1px solid #30363d; border-radius: 6px; margin-bottom: 12px; position: relative; }
.komuta-root .upcoming-stat-row { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; padding: 3px 0; }
.komuta-root .upcoming-stat-row .lbl { color: #8b949e; }
.komuta-root .upcoming-stat-row .val { font-weight: 600; color: #3fb950; font-feature-settings: "tnum"; }
.komuta-root .upcoming-action-row { font-size: 12px; color: #c9d1d9; line-height: 1.5; margin-bottom: 8px; position: relative; }
.komuta-root .upcoming-action-row .hi { color: #d4a857; font-weight: 600; }
.komuta-root .upcoming-window { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(248, 81, 73, 0.08); border: 1px solid rgba(248, 81, 73, 0.3); border-radius: 6px; font-size: 11.5px; color: #f85149; font-weight: 500; position: relative; }

/* MATRIX */
.komuta-root .matrix-panel { padding: 16px; }
.komuta-root .matrix-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.komuta-root .matrix-table th { text-align: right; padding: 8px 10px; font-size: 10px; color: #8b949e; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #30363d; }
.komuta-root .matrix-table th:first-child { text-align: left; }
.komuta-root .matrix-table th .sub { display: block; font-size: 9px; color: #6e7681; font-weight: 500; text-transform: none; letter-spacing: 0; margin-top: 2px; }
.komuta-root .matrix-table th.current { color: #d4a857; }
.komuta-root .matrix-table td { padding: 7px 10px; border-bottom: 1px solid #21262d; text-align: right; font-feature-settings: "tnum"; color: #c9d1d9; }
.komuta-root .matrix-table td:first-child { text-align: left; color: #e6edf3; font-weight: 500; }
.komuta-root .matrix-table tr:last-child td { border-bottom: none; }
.komuta-root .matrix-table tr:hover td { background: rgba(212, 168, 87, 0.04); }
.komuta-root .matrix-cell-current { background: rgba(212, 168, 87, 0.06); color: #d4a857 !important; font-weight: 600; }
.komuta-root .delta-pill { display: inline-block; font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; font-weight: 600; }
.komuta-root .delta-pill.up { background: rgba(63, 185, 80, 0.15); color: #3fb950; }
.komuta-root .delta-pill.down { background: rgba(248, 81, 73, 0.15); color: #f85149; }

/* HEATMAP */
.komuta-root .heatmap-panel { padding: 16px; margin-bottom: 14px; }
.komuta-root .heatmap-grid { display: grid; gap: 4px; font-size: 11px; }
.komuta-root .heatmap-grid > .h-head { text-align: center; padding: 8px 4px; font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; border-bottom: 1px solid #30363d; }
.komuta-root .heatmap-grid > .h-head:first-child { text-align: left; padding-left: 8px; }
.komuta-root .heatmap-grid .h-head.right { text-align: right; padding-right: 8px; }
.komuta-root .heatmap-grid .h-region { padding: 11px 8px; color: #e6edf3; font-weight: 500; border-bottom: 1px solid #21262d; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.komuta-root .heatmap-grid .h-region .reg-sub { font-size: 9.5px; color: #6e7681; font-weight: 400; }
.komuta-root .heatmap-grid .h-cell { padding: 9px 6px; text-align: center; font-feature-settings: "tnum"; font-weight: 600; border-bottom: 1px solid #21262d; border-radius: 4px; }
.komuta-root .heatmap-grid .h-cell.cold { background: rgba(248, 81, 73, 0.45); color: #fff; }
.komuta-root .heatmap-grid .h-cell.cool { background: rgba(248, 81, 73, 0.18); color: #f85149; }
.komuta-root .heatmap-grid .h-cell.flat { background: rgba(139, 148, 158, 0.1); color: #8b949e; }
.komuta-root .heatmap-grid .h-cell.warm { background: rgba(63, 185, 80, 0.15); color: #56d364; }
.komuta-root .heatmap-grid .h-cell.hot { background: rgba(63, 185, 80, 0.30); color: #56d364; }
.komuta-root .heatmap-grid .h-cell.fire { background: rgba(212, 168, 87, 0.45); color: #fff; }
.komuta-root .heatmap-grid .h-avg { padding: 9px 8px; text-align: right; font-feature-settings: "tnum"; color: #d4a857; font-weight: 600; border-bottom: 1px solid #21262d; }

/* BOTTOM GRID */
.komuta-root .bottom-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
.komuta-root .leaderboard .lb-row { display: grid; grid-template-columns: 22px 1fr 80px 90px; gap: 10px; padding: 8px 0; border-bottom: 1px solid #21262d; align-items: center; font-size: 12px; }
.komuta-root .lb-row:last-child { border-bottom: none; }
.komuta-root .lb-rank { width: 22px; height: 22px; border-radius: 50%; background: #21262d; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #8b949e; }
.komuta-root .lb-rank.top1 { background: linear-gradient(135deg, #d4a857, #8b6914); color: #0d1117; }
.komuta-root .lb-rank.top2 { background: #6e7681; color: #0d1117; }
.komuta-root .lb-rank.top3 { background: #cd7f32; color: #0d1117; }
.komuta-root .lb-name { color: #e6edf3; }
.komuta-root .lb-region { color: #6e7681; font-size: 10.5px; display: block; margin-top: 1px; }
.komuta-root .lb-bar { height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; }
.komuta-root .lb-bar-fill { height: 100%; background: linear-gradient(90deg, #3fb950, #56d364); border-radius: 3px; }
.komuta-root .lb-bar-fill.warn { background: linear-gradient(90deg, #d4a857, #f0c674); }
.komuta-root .lb-bar-fill.bad { background: linear-gradient(90deg, #f85149, #da3633); }
.komuta-root .lb-pct { font-size: 11.5px; font-weight: 600; text-align: right; font-feature-settings: "tnum"; color: #e6edf3; }
.komuta-root .lb-pct.bad { color: #f85149; }
.komuta-root .lb-pct.warn { color: #d4a857; }

/* BRAND PORTFOLIO */
.komuta-root .brand-portfolio { padding: 16px; }
.komuta-root .bp-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.komuta-root .bp-table th { text-align: right; padding: 8px 10px; font-size: 10px; color: #8b949e; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #30363d; }
.komuta-root .bp-table th:first-child { text-align: left; }
.komuta-root .bp-table th.current { color: #d4a857; }
.komuta-root .bp-table td { padding: 9px 10px; border-bottom: 1px solid #21262d; font-feature-settings: "tnum"; color: #c9d1d9; }
.komuta-root .bp-table td:first-child { color: #e6edf3; font-weight: 500; }
.komuta-root .bp-table td.current { color: #d4a857; font-weight: 600; text-align: right; }
.komuta-root .bp-table td.right { text-align: right; }
.komuta-root .bp-table tr:last-child td { border-bottom: none; }
.komuta-root .bp-2yspark { display: inline-flex; gap: 2px; align-items: flex-end; height: 18px; }
.komuta-root .bp-2yspark .bar { width: 4px; background: #d4a857; border-radius: 1px; opacity: 0.7; }
.komuta-root .bp-2yspark .bar.last { opacity: 1; background: linear-gradient(180deg, #f0c674, #d4a857); }
.komuta-root .bp-2yspark .bar.last.declining { background: linear-gradient(180deg, #f85149, #da3633); }

/* TIER BADGES (PREM / LUX / CORE) */
.komuta-root .tier-badge {
  display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px;
  margin-left: 6px; vertical-align: middle; font-weight: 600;
  letter-spacing: 0.3px; text-transform: uppercase;
  border: 1px solid;
}
.komuta-root .tier-luxury {
  background: rgba(192, 132, 252, 0.12);
  color: #c084fc;
  border-color: rgba(192, 132, 252, 0.35);
}
.komuta-root .tier-premium {
  background: rgba(212, 168, 87, 0.15);
  color: #d4a857;
  border-color: rgba(212, 168, 87, 0.35);
}
.komuta-root .tier-core {
  background: rgba(88, 166, 255, 0.12);
  color: #58a6ff;
  border-color: rgba(88, 166, 255, 0.3);
}

/* AI INSIGHT */
.komuta-root .ai-insight {
  margin-top: 14px; padding: 14px 18px;
  background: linear-gradient(90deg, rgba(212, 168, 87, 0.08) 0%, rgba(212, 168, 87, 0.02) 100%);
  border: 1px solid rgba(212, 168, 87, 0.25); border-left: 3px solid #d4a857;
  border-radius: 8px; display: flex; gap: 14px; align-items: flex-start;
}
.komuta-root .ai-icon {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #d4a857, #8b6914);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: #0d1117;
}
.komuta-root .ai-text { flex: 1; min-width: 0; }
.komuta-root .ai-title { font-size: 11px; font-weight: 600; color: #d4a857; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.komuta-root .ai-body { font-size: 12.5px; color: #c9d1d9; line-height: 1.6; }
.komuta-root .ai-body strong { color: #e6edf3; }
.komuta-root .ai-body p { margin-bottom: 8px; }

.komuta-root .footer-bar {
  margin-top: 14px; padding: 10px 16px; display: flex; justify-content: space-between;
  font-size: 11px; color: #6e7681; flex-wrap: wrap; gap: 8px;
}
`;
