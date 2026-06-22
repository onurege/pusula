import { Compass, Filter, ListChecks, Target, UserSearch } from "lucide-react";
import { PagePlaceholder } from "@/components/v2/PagePlaceholder";
import { SubTabNav, type SubTab } from "@/components/v2/SubTabNav";
import {
  getKomutaSnapshot,
  listMapRegions,
  type KomutaChannelMonthlyRow,
  type MapRegion,
} from "@/lib/api";
import { ChannelMixChart } from "@/components/komuta/ChannelMixChart";
import { getTenantConfig } from "@/lib/tenant";

// `force-dynamic` kaldırıldı — searchParams Promise zaten dynamic tetikliyor.
export const metadata = { title: "Müşteri · V2 · Enroute Pusula" };

const tabs: SubTab[] = [
  { id: "genel", label: "Genel", icon: <Compass size={12} /> },
  { id: "risk", label: "Risk Analizi", icon: <Target size={12} /> },
  { id: "funnel", label: "Funnel", icon: <Filter size={12} /> },
  { id: "foresight", label: "Foresight", icon: <ListChecks size={12} /> },
  { id: "musteri-360", label: "360°", icon: <UserSearch size={12} /> },
];

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function V2MusteriPage({ searchParams }: Props) {
  const sp = await searchParams;
  const active = sp.tab ?? "genel";

  // Genel + Risk için snapshot + regions paralel çek
  const [snapResult, regionsResult] = await Promise.allSettled([
    getKomutaSnapshot({}),
    listMapRegions({}),
  ]);
  const snap = snapResult.status === "fulfilled" ? snapResult.value : null;
  const regions =
    regionsResult.status === "fulfilled" ? regionsResult.value.regions : [];

  return (
    <div className="komuta-root">
      <header className="komuta-page-header">
        <div className="komuta-page-header-main">
          <div className="komuta-eyebrow">
            <span className="komuta-eyebrow-dot" />
            Müşteri
          </div>
          <h1 className="komuta-page-title">Müşteri Portföyü</h1>
          <p className="komuta-page-desc">
            Kanal dağılımı, risk skoru kırılımı, kayıp müşteri takibi.
            Sekme bazlı detaylar aşağıda.
          </p>
        </div>
        <SubTabNav tabs={tabs} defaultId="genel" />
      </header>

      {active === "genel" && (
        <MusteriGenelView
          regions={regions}
          channelByType={snap?.channelByType ?? []}
        />
      )}

      {active === "risk" && <MusteriRiskView regions={regions} />}

      {active === "funnel" && (
        <PagePlaceholder
          eyebrow="Müşteri · Funnel"
          title="Sales Funnel — Pipeline"
          description="Tabela → Ziyaret → Sipariş → Fatura → Tahsilat dönüşüm hunisi. Faz B2'de eklenecek."
          comingSoon={[
            "5 katmanlı funnel: Tabela / Ziyaret edildi / Sipariş alındı / Faturalandı / Tahsil edildi",
            "Conversion rate her aşamada",
            "Dropoff alarm — geçen aya göre %15+ düşüş varsa kırmızı",
            "Funnel × bölge breakdown",
          ]}
        />
      )}

      {active === "foresight" && (
        <PagePlaceholder
          eyebrow="Müşteri · Foresight"
          title="Foresight Inbox"
          description="14 günlük müşteri foresight'larının toplu özeti — hangi müşterilere ne zaman ulaşılmalı."
          comingSoon={[
            "Yaklaşan etkinlik bazlı foresight (Ramazan / Yılbaşı / Bayram)",
            "Yüksek baseline + son alış 7+ gün önce müşteri öneri listesi",
            "Müşteri × öneri Gemini açıklaması",
            "Aksiyon → Bu Hafta Yapılacaklar drawer'a ekle",
          ]}
        />
      )}

      {active === "musteri-360" && (
        <PagePlaceholder
          eyebrow="Müşteri · 360°"
          title="Müşteri 360° — Detay"
          description="Tek müşteri için tam profil — CustomerModal'ın tam sayfa versiyonu."
          comingSoon={[
            "Global arama (unvan / kısa ad / vergi no / dist kodu)",
            "Müşteri başlığı + Composite Risk Score kartı",
            "Son 90g ciro trendi",
            "Ürün karması — favori SKU'lar + bırakılan kategoriler",
            "Ziyaret tarihçesi timeline",
            "Foresight inline",
          ]}
        />
      )}
    </div>
  );
}

/** GENEL — Toplam müşteri + bölge dağılımı + müşteri tipi 12 ay paneli */
function MusteriGenelView({
  regions,
  channelByType,
}: {
  regions: MapRegion[];
  channelByType: KomutaChannelMonthlyRow[];
}) {
  // Müşteri tipi panel başlığı/source tenant-özel — Pernod'da
  // "Pernod Müşteri Tipi", FMCG demo'da generic "Müşteri Tipi".
  const tenant = getTenantConfig();
  const totalCustomers = regions.reduce(
    (a, r) => a + (r.musteriSayisi ?? 0),
    0,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          padding: "14px 18px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          Toplam Müşteri Portföyü
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--color-fg)",
            marginBottom: 10,
          }}
        >
          {totalCustomers.toLocaleString("tr-TR")}{" "}
          <span
            style={{
              fontSize: 13,
              color: "var(--color-muted)",
              fontWeight: 500,
            }}
          >
            aktif müşteri · {regions.length} bölge
          </span>
        </div>
        <RegionBreakdown regions={regions} total={totalCustomers} />
      </div>

      {channelByType.length > 0 && (
        <ChannelMixChart
          rows={channelByType}
          title={tenant.labels.channelTypeTitle}
          icon={tenant.industry === "alcohol" ? "🍸" : "🛒"}
          category="müşteri tipi"
          sourceNote={tenant.labels.channelTypeSource}
        />
      )}
    </div>
  );
}

function RegionBreakdown({
  regions,
  total,
}: {
  regions: MapRegion[];
  total: number;
}) {
  const sorted = [...regions]
    .filter((r) => r.musteriSayisi > 0)
    .sort((a, b) => b.musteriSayisi - a.musteriSayisi);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {sorted.map((r) => {
        const pct = total > 0 ? (r.musteriSayisi / total) * 100 : 0;
        return (
          <div
            key={r.bolge}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr auto",
              gap: 10,
              alignItems: "center",
              fontSize: 11.5,
            }}
          >
            <span style={{ color: "var(--color-fg-2)", fontWeight: 500 }}>
              {r.bolge}
            </span>
            <div
              style={{
                height: 8,
                background: "var(--color-surface-2)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: r.color ?? "var(--color-accent)",
                  borderRadius: 4,
                }}
              />
            </div>
            <span
              style={{
                color: "var(--color-fg)",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                minWidth: 90,
                textAlign: "right",
              }}
            >
              {r.musteriSayisi.toLocaleString("tr-TR")}{" "}
              <span
                style={{
                  color: "var(--color-muted)",
                  fontWeight: 400,
                  fontSize: 10.5,
                }}
              >
                %{pct.toFixed(0)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** RİSK ANALİZİ — Risk tier histogram + bölge × tier matrix */
function MusteriRiskView({ regions }: { regions: MapRegion[] }) {
  const total = regions.reduce((a, r) => a + (r.musteriSayisi ?? 0), 0);
  const critical = regions.reduce((a, r) => a + (r.critical ?? 0), 0);
  const risk = regions.reduce((a, r) => a + (r.risk ?? 0), 0);
  const watch = regions.reduce((a, r) => a + (r.watch ?? 0), 0);
  const healthy = regions.reduce((a, r) => a + (r.healthy ?? 0), 0);
  const unknown = regions.reduce((a, r) => a + (r.unknown ?? 0), 0);
  const ranked = critical + risk + watch + healthy;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          padding: "14px 18px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontWeight: 700,
            marginBottom: 4,
          }}
        >
          Composite Risk Score Dağılımı
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--color-muted)",
            marginBottom: 12,
          }}
        >
          {ranked.toLocaleString("tr-TR")} skorlanmış müşteri ·{" "}
          {unknown.toLocaleString("tr-TR")} yeterli veri yok
        </div>
        <RiskBar
          parts={[
            { label: "Sağlıklı", count: healthy, color: "#16a34a" },
            { label: "İzle", count: watch, color: "#d97706" },
            { label: "Risk", count: risk, color: "#ea580c" },
            { label: "Kritik", count: critical, color: "#dc2626" },
          ]}
          total={ranked}
        />
      </div>

      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          padding: "14px 18px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontWeight: 700,
            marginBottom: 4,
          }}
        >
          Bölge × Risk Tier Matrix
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--color-muted)",
            marginBottom: 12,
          }}
        >
          Her bölgenin risk profili — kritik yığılması olan bölgeleri yakala
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 700,
              borderCollapse: "collapse",
              fontSize: 11.5,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th style={thStyle}>Bölge</th>
                <th style={thNumStyle}>Toplam</th>
                <th style={{ ...thNumStyle, color: "#16a34a" }}>Sağlıklı</th>
                <th style={{ ...thNumStyle, color: "#d97706" }}>İzle</th>
                <th style={{ ...thNumStyle, color: "#ea580c" }}>Risk</th>
                <th style={{ ...thNumStyle, color: "#dc2626" }}>Kritik</th>
                <th style={thNumStyle}>Yetersiz Veri</th>
                <th style={thStyle}>Kritik Yoğunluğu</th>
              </tr>
            </thead>
            <tbody>
              {regions
                .slice()
                .sort((a, b) => {
                  const aDens =
                    a.musteriSayisi > 0 ? a.critical / a.musteriSayisi : 0;
                  const bDens =
                    b.musteriSayisi > 0 ? b.critical / b.musteriSayisi : 0;
                  return bDens - aDens;
                })
                .map((r) => {
                  const dens =
                    r.musteriSayisi > 0
                      ? (r.critical / r.musteriSayisi) * 100
                      : 0;
                  return (
                    <tr
                      key={r.bolge}
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      <td style={tdStyle}>{r.bolge}</td>
                      <td style={tdNumStyle}>
                        {r.musteriSayisi.toLocaleString("tr-TR")}
                      </td>
                      <td style={{ ...tdNumStyle, color: "#16a34a" }}>
                        {r.healthy.toLocaleString("tr-TR")}
                      </td>
                      <td style={{ ...tdNumStyle, color: "#d97706" }}>
                        {r.watch.toLocaleString("tr-TR")}
                      </td>
                      <td style={{ ...tdNumStyle, color: "#ea580c" }}>
                        {r.risk.toLocaleString("tr-TR")}
                      </td>
                      <td
                        style={{
                          ...tdNumStyle,
                          color: "#dc2626",
                          fontWeight: 700,
                        }}
                      >
                        {r.critical.toLocaleString("tr-TR")}
                      </td>
                      <td
                        style={{ ...tdNumStyle, color: "var(--color-muted)" }}
                      >
                        {r.unknown.toLocaleString("tr-TR")}
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            background:
                              dens > 50
                                ? "rgba(220,38,38,0.12)"
                                : dens > 30
                                  ? "rgba(234,88,12,0.12)"
                                  : dens > 15
                                    ? "rgba(217,119,6,0.12)"
                                    : "rgba(22,163,74,0.12)",
                            color:
                              dens > 50
                                ? "#dc2626"
                                : dens > 30
                                  ? "#ea580c"
                                  : dens > 15
                                    ? "#d97706"
                                    : "#16a34a",
                            fontWeight: 700,
                            fontSize: 11,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          %{dens.toFixed(0)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              <tr style={{ borderTop: "2px solid var(--color-border-strong)" }}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>TOPLAM</td>
                <td style={{ ...tdNumStyle, fontWeight: 700 }}>
                  {total.toLocaleString("tr-TR")}
                </td>
                <td style={{ ...tdNumStyle, color: "#16a34a", fontWeight: 700 }}>
                  {healthy.toLocaleString("tr-TR")}
                </td>
                <td style={{ ...tdNumStyle, color: "#d97706", fontWeight: 700 }}>
                  {watch.toLocaleString("tr-TR")}
                </td>
                <td style={{ ...tdNumStyle, color: "#ea580c", fontWeight: 700 }}>
                  {risk.toLocaleString("tr-TR")}
                </td>
                <td style={{ ...tdNumStyle, color: "#dc2626", fontWeight: 700 }}>
                  {critical.toLocaleString("tr-TR")}
                </td>
                <td
                  style={{
                    ...tdNumStyle,
                    color: "var(--color-muted)",
                    fontWeight: 700,
                  }}
                >
                  {unknown.toLocaleString("tr-TR")}
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      color: "var(--color-bad)",
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    %{total > 0 ? ((critical / total) * 100).toFixed(1) : "—"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 10,
  color: "var(--color-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  fontWeight: 700,
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "var(--color-fg)",
};
const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

function RiskBar({
  parts,
  total,
}: {
  parts: Array<{ label: string; count: number; color: string }>;
  total: number;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 24,
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--color-surface-2)",
        }}
      >
        {parts.map((p) => {
          const pct = total > 0 ? (p.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={p.label}
              title={`${p.label}: ${p.count.toLocaleString("tr-TR")} (%${pct.toFixed(1)})`}
              style={{
                width: `${pct}%`,
                background: p.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {pct > 5 ? `%${pct.toFixed(0)}` : ""}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {parts.map((p) => (
          <div
            key={p.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                background: p.color,
                borderRadius: 2,
              }}
            />
            <span style={{ color: "var(--color-fg-2)", fontWeight: 500 }}>
              {p.label}:{" "}
              <strong
                style={{
                  color: "var(--color-fg)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {p.count.toLocaleString("tr-TR")}
              </strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
