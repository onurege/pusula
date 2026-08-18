import { Award, Building2, CalendarClock, Layers3 } from "lucide-react";
import { notFound } from "next/navigation";
import { getKomutaSnapshot, type KomutaSnapshot, type ValueUnit } from "@/lib/api";
import { SubTabNav, type SubTab } from "@/components/v2/SubTabNav";
import { RepLeaderboard } from "@/components/komuta/panels/RepLeaderboard";
import { DistLeaderboard } from "@/components/komuta/panels/DistLeaderboard";
import { ChannelMixChart } from "@/components/komuta/ChannelMixChart";
import { UnitToggle } from "@/components/komuta/UnitToggle";
import { getTenantConfig } from "@/lib/tenant";

// `force-dynamic` kaldırıldı — searchParams Promise zaten dynamic tetikliyor.
export const metadata = { title: "Saha · V2 · NORA 4Sight" };

const tabs: SubTab[] = [
  { id: "temsilciler", label: "Temsilciler", icon: <Award size={12} /> },
  { id: "distributorler", label: "Distribütörler", icon: <Building2 size={12} /> },
  { id: "ziyaret", label: "Ziyaret Performansı", icon: <CalendarClock size={12} /> },
  { id: "kanal-mix", label: "Kanal Mix", icon: <Layers3 size={12} /> },
];

type Props = {
  searchParams: Promise<{ tab?: string; unit?: string }>;
};

export default async function V2SahaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tenant = getTenantConfig();
  const active = sp.tab ?? "temsilciler";
  const unit: ValueUnit = sp.unit === "9le" ? "9le" : "tl";

  // Snapshot tüm Saha sekmeleri için gerekli (reps / dists / channelByType)
  let snap: KomutaSnapshot | null = null;
  try {
    snap = await getKomutaSnapshot({ unit });
  } catch {
    notFound();
  }
  if (!snap) notFound();

  return (
    <div className="komuta-root">
      <header className="komuta-page-header">
        <div className="komuta-page-header-main">
          <div className="komuta-eyebrow">
            <span className="komuta-eyebrow-dot" />
            Saha
          </div>
          <h1 className="komuta-page-title">Satış Operasyonu</h1>
          <p className="komuta-page-desc">
            Temsilci + Distribütör + Ziyaret + Kanal Mix. V1'deki ayrı
            paneller burada konsolide. Aşağıdaki sekmelerden geç.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SubTabNav tabs={tabs} defaultId="temsilciler" />
          <UnitToggle />
        </div>
      </header>

      {active === "temsilciler" && (
        <RepLeaderboard reps={snap.reps} unit={snap.unit} />
      )}

      {active === "distributorler" && (
        <DistLeaderboard dists={snap.topDists} unit={snap.unit} />
      )}

      {active === "ziyaret" && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <span className="icon">📋</span> Ziyaret Performansı
            </div>
            <div className="panel-meta">V1 sayfasına bağ</div>
          </div>
          <div
            style={{
              padding: "16px 4px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <p
              style={{
                fontSize: 13,
                color: "var(--color-fg-2)",
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Ziyaret analitiği V1&apos;de detaylı bir sayfa olarak mevcut —
              <strong> rut içi vs rut dışı dağılım, ziyaret → sipariş
              dönüşümü, sahada kesilen belge sayıları</strong> hepsi orada.
              V2 IA&apos;da ayrı bir sekme olarak burada görünüyor; tam
              taşıma Faz B2&apos;de.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 10,
              }}
            >
              <a
                href="/ziyaret"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-accent-soft) 0%, var(--color-surface) 100%)",
                  border: "1px solid var(--color-accent)",
                  borderRadius: 8,
                  padding: "14px 18px",
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--color-accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.6px",
                      fontWeight: 700,
                      marginBottom: 4,
                    }}
                  >
                    Mevcut canlı sayfa
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--color-fg)",
                    }}
                  >
                    Ziyaret Detay Analizi
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--color-muted)",
                      marginTop: 2,
                    }}
                  >
                    Bölge başına kapsama, rut içi/dışı dağılım, dönüşüm
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--color-accent)",
                    fontWeight: 700,
                  }}
                >
                  /ziyaret →
                </span>
              </a>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-muted)",
                padding: "8px 12px",
                background: "var(--color-surface-2)",
                borderRadius: 6,
                borderLeft: "3px solid var(--color-muted)",
              }}
            >
              <strong>Faz B2 planı:</strong> /ziyaret sayfasındaki
              TBLPMPZIYARETBASLIK + TBLPMPZIYARETDETAY agregasyonları
              buraya taşınacak — Temsilciler / Distribütörler /
              Kanal Mix sekmeleriyle aynı &quot;komuta&quot; layout&apos;u
              içinde, snapshot tek noktadan beslenecek.
            </div>
          </div>
        </div>
      )}

      {active === "kanal-mix" && (
        <ChannelMixChart
          rows={snap.channelByType}
          unit={snap.unit}
          title={tenant.labels.channelTypeTitle}
          icon={tenant.industry === "alcohol" ? "🍸" : "🛒"}
          category="müşteri tipi"
          sourceNote={tenant.labels.channelTypeSource}
        />
      )}
    </div>
  );
}
