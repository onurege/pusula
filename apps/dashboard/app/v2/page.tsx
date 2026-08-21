import Link from "next/link";
import {
  BarChart3,
  ChartArea,
  Compass,
  Layers3,
  Map as MapIcon,
  Sparkles,
  Users,
} from "lucide-react";
import { getKomutaSnapshot, listMapRegions, type KomutaSnapshot } from "@/lib/api";
import { KpiStrip } from "@/components/komuta/panels/KpiStrip";
import { CalendarBanner } from "@/components/komuta/panels/CalendarBanner";
import { getTenantConfig } from "@/lib/tenant";

// `force-dynamic` kaldırıldı — Data Cache 5 dk RAM'de tutsun diye.
export const metadata = { title: "Radar · V2 · Insider" };

/**
 * V2 Radar (landing) — yöneticinin ilk açtığı sayfa.
 *
 * 1. KPI strip (Komuta snapshot'tan ilk 4 metrik)
 * 2. Yaklaşan etkinlik banner'ı (varsa)
 * 3. Risk dağılımı özet şeridi (cross-region toplamlardan)
 * 4. 4 ana sekme nav kartları (Komuta / Müşteri / Ürün / Saha)
 * 5. Hızlı erişim (Harita / Raporlar)
 * 6. Sistem durumu (sync date, müşteri sayısı, demo modu)
 */
export default async function V2RadarPage() {
  const tenant = getTenantConfig();
  const [snapResult, regionsResult] = await Promise.allSettled([
    getKomutaSnapshot({}),
    listMapRegions({}),
  ]);
  const snap: KomutaSnapshot | null =
    snapResult.status === "fulfilled" ? snapResult.value : null;
  const regions =
    regionsResult.status === "fulfilled" ? regionsResult.value.regions : [];

  const totalCustomers = regions.reduce(
    (a, r) => a + (r.musteriSayisi ?? 0),
    0,
  );
  const totalCritical = regions.reduce((a, r) => a + (r.critical ?? 0), 0);
  const totalRisk = regions.reduce((a, r) => a + (r.risk ?? 0), 0);
  const totalWatch = regions.reduce((a, r) => a + (r.watch ?? 0), 0);
  const totalHealthy = regions.reduce((a, r) => a + (r.healthy ?? 0), 0);

  return (
    <div className="komuta-root">
      <header className="komuta-page-header">
        <div className="komuta-page-header-main">
          <div className="komuta-eyebrow">
            <span className="komuta-eyebrow-dot" />
            Radar · executive panel
          </div>
          <h1 className="komuta-page-title">
            {tenant.labels.morningHeadline}
          </h1>
          <p className="komuta-page-desc">
            <strong>30 saniyelik genel görünüm:</strong> KPI özeti, yaklaşan
            etkinlikler, sekme bazlı detay erişimi. Derin analiz için aşağıdaki
            kartlardan ilgili sekmeye geç.
          </p>
        </div>
      </header>

      {snap && snap.kpis.length > 0 && <KpiStrip kpis={snap.kpis} />}
      {snap?.upcomingEvent && <CalendarBanner event={snap.upcomingEvent} />}

      {totalCustomers > 0 && (
        <RiskSummaryStrip
          total={totalCustomers}
          critical={totalCritical}
          risk={totalRisk}
          watch={totalWatch}
          healthy={totalHealthy}
        />
      )}

      <div className="v2r-nav-grid">
        <NavCard
          href="/v2/komuta"
          icon={<ChartArea size={20} />}
          eyebrow="Komuta"
          title="Executive Özet"
          desc="Bölge sağlığı, dönem karşılaştırma, ürün × bölge heatmap. CEO sabah görünümü."
          accent="indigo"
        />
        <NavCard
          href="/v2/musteri"
          icon={<Users size={20} />}
          eyebrow="Müşteri"
          title="Portföy Analizi"
          desc="Kanal dağılımı, risk skoru kırılımı, kayıp müşteri takibi."
          accent="green"
        />
        <NavCard
          href="/v2/urun"
          icon={<BarChart3 size={20} />}
          eyebrow="Ürün"
          title="Marka & SKU"
          desc="Treemap, 2-yıllık yörünge, bölge × ürün grubu YoY heatmap."
          accent="purple"
        />
        <NavCard
          href="/v2/saha"
          icon={<Compass size={20} />}
          eyebrow="Saha"
          title="Satış Operasyonu"
          desc="Temsilci leaderboard, distribütör performansı, ziyaret kapsamı, kanal mix."
          accent="orange"
        />
      </div>

      <div className="v2r-quick-grid">
        <NavCard
          href="/v2/harita"
          icon={<MapIcon size={18} />}
          eyebrow="Hızlı erişim"
          title="Satış Haritası"
          desc="Müşteri marker + bölge polygon view, risk tier görselleştirme."
          accent="cyan"
          compact
        />
        <NavCard
          href="/v2/raporlar"
          icon={<Layers3 size={18} />}
          eyebrow="Hızlı erişim"
          title="Raporlar + Şema"
          desc="Kayıtlı raporlar, Gemini destekli SQL üretici, şema gezgini."
          accent="amber"
          compact
        />
      </div>

      <SystemFooter snap={snap} customerCount={totalCustomers} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v2r-nav-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          margin: 16px 0;
        }
        @media (min-width: 720px) { .v2r-nav-grid { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 1100px) { .v2r-nav-grid { grid-template-columns: repeat(4, 1fr); } }
        .v2r-quick-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin: 12px 0;
        }
        @media (min-width: 720px) { .v2r-quick-grid { grid-template-columns: 1fr 1fr; } }
        .v2r-nav-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
          border-color: var(--color-accent);
        }
      `,
        }}
      />
    </div>
  );
}

function RiskSummaryStrip({
  total,
  critical,
  risk,
  watch,
  healthy,
}: {
  total: number;
  critical: number;
  risk: number;
  watch: number;
  healthy: number;
}) {
  const pct = (n: number) =>
    total > 0 ? `%${Math.round((n / total) * 100)}` : "—";
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-2) 100%)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "12px 16px",
        margin: "14px 0",
        display: "flex",
        gap: 24,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            color: "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontWeight: 700,
          }}
        >
          Portföy Sağlığı
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--color-fg)",
            marginTop: 2,
          }}
        >
          {total.toLocaleString("tr-TR")}{" "}
          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
            müşteri
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <RiskPill label="Sağlıklı" count={healthy} pct={pct(healthy)} color="var(--color-good)" />
        <RiskPill label="İzle" count={watch} pct={pct(watch)} color="#d97706" />
        <RiskPill label="Risk" count={risk} pct={pct(risk)} color="#ea580c" />
        <RiskPill label="Kritik" count={critical} pct={pct(critical)} color="var(--color-bad)" />
      </div>
      <Link
        href="/v2/musteri?tab=risk"
        style={{
          marginLeft: "auto",
          fontSize: 12,
          color: "var(--color-accent)",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Detay →
      </Link>
    </div>
  );
}

function RiskPill({
  label,
  count,
  pct,
  color,
}: {
  label: string;
  count: number;
  pct: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        minWidth: 75,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "var(--color-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count.toLocaleString("tr-TR")}{" "}
        <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>
          {pct}
        </span>
      </div>
    </div>
  );
}

function NavCard({
  href,
  icon,
  eyebrow,
  title,
  desc,
  accent,
  compact,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  desc: string;
  accent: "indigo" | "green" | "purple" | "orange" | "cyan" | "amber";
  compact?: boolean;
}) {
  const accentColor: Record<string, string> = {
    indigo: "#6366f1",
    green: "#16a34a",
    purple: "#9333ea",
    orange: "#d97706",
    cyan: "#0891b2",
    amber: "#b45309",
  };
  const color = accentColor[accent];
  return (
    <Link
      href={href}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-strong)",
        borderTop: `3px solid ${color}`,
        borderRadius: 10,
        padding: compact ? "12px 14px" : "16px 18px",
        textDecoration: "none",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 4 : 6,
        transition: "all 0.15s",
        cursor: "pointer",
      }}
      className="v2r-nav-card"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color,
        }}
      >
        {icon}
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.6px",
            fontWeight: 700,
          }}
        >
          {eyebrow}
        </span>
      </div>
      <div
        style={{
          fontSize: compact ? 14 : 16,
          fontWeight: 700,
          color: "var(--color-fg)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--color-muted)",
          lineHeight: 1.45,
        }}
      >
        {desc}
      </div>
    </Link>
  );
}

function SystemFooter({
  snap,
  customerCount,
}: {
  snap: KomutaSnapshot | null;
  customerCount: number;
}) {
  return (
    <div
      style={{
        marginTop: 20,
        padding: "10px 14px",
        borderTop: "1px solid var(--color-border)",
        fontSize: 11,
        color: "var(--color-muted)",
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span>
        Müşteri: <strong>{customerCount.toLocaleString("tr-TR")}</strong>
      </span>
      {snap?.demoDate && (
        <span>
          Demo modu: <strong>{snap.demoDate}</strong>
        </span>
      )}
      {snap?.generatedAt && (
        <span>
          Snapshot:{" "}
          <strong>
            {new Date(snap.generatedAt).toLocaleString("tr-TR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </strong>
        </span>
      )}
      <span style={{ marginLeft: "auto", color: "var(--color-accent)" }}>
        <Sparkles size={11} style={{ display: "inline", marginRight: 4 }} />
        V2 Beta
      </span>
    </div>
  );
}
