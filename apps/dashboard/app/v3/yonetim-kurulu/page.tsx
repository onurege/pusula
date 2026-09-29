import { getWietnauerYonetim, getWietnauerIskonto } from "@/lib/api";
import { cs, panelHidden } from "@/lib/content";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { GlobalDonemFilter } from "@/components/v3/GlobalDonemFilter";
import { donemLabel } from "@/lib/donem";
import { TopDistributorsPanel } from "@/components/v3/TopDistributorsPanel";
import { BrandContributionPanel } from "@/components/v3/BrandContributionPanel";
import { IskontoSegmentPanel } from "@/components/v3/iskonto/IskontoSegmentPanel";
import { SatisUnitToggle } from "@/components/v3/satis/SatisUnitToggle";
import { formatCompact } from "@/components/komuta/format";
import { getLocale, t, localizeVolumeUnit } from "@/lib/i18n";

// Sadece segment dilimine ihtiyacımız var — ticari-yatirim sayfasındaki tam
// IskontoSnapshot tipinin alt kümesi. Endpoint aynı, ödediğin bedel cache hit.
// Madde 8: `netHacim` eklendi (TL↔hacim toggle, IskontoSegmentPanel'e geçirilir).
type IskontoSegmentRowSlice = {
  segment: string;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  musteriSayi: number;
  faturaSayisi: number;
  netHacim: number;
};
// Madde 8/10: 2 panelden (segments/ekGrupSegments) 4 panele çıkarıldı —
// Yönetim Kurulu'nun segment kırılımları artık Müşteri Segmentasyon
// ekranıyla (md10) AYNI sırada: Müşteri Grubu → Müşteri Ek Saha →
// Müşteri Ek Grup → Müşteri Grup Kırılımı. Eski `segments`/`ekGrupSegments`
// alanları backend'de geriye dönük alias olarak duruyor ama burada
// tüketilmiyor — 4 yeni alan tek kaynak.
type IskontoSegmentsSlice = {
  /** 1) Müşteri Grubu — TBLMUSTERIGRUP. */
  segMusteriGrup: IskontoSegmentRowSlice[];
  /** 2) Müşteri Ek Saha — birleşik Saha1+2. */
  segEkSaha: IskontoSegmentRowSlice[];
  /** 3) Müşteri Ek Grup — TBLMUSTERIEKGRUP (ilk 5 + Diğer). */
  segEkGrup: IskontoSegmentRowSlice[];
  /** 4) Müşteri Grup Kırılımı — TBLMUSTERIGRUPKIRILIM (yeni boyut). */
  segGrupKirilim: IskontoSegmentRowSlice[];
};

export async function generateMetadata() {
  const locale = await getLocale();
  return { title: `${t(locale, "page.yonetim.title", "Yönetim Kurulu")} · V3 · Insider` };
}

/**
 * V3 Dashboard #1 — Yönetim Kurulu.
 *
 * Wietnauer talebi:
 *   - Türkiye geneli toplam satış performansı
 *   - Ciro, hacim, büyüme trendleri
 *   - Distribütör bazlı karşılaştırma
 *   - Bölge ve kanal dağılımı
 *   - Top 10/20/50 müşteri analizleri
 *   - Marka ve ürün grubu satış katkıları
 *   - Kârlılık ve iskonto analizleri
 *
 * Faz A kapsamı (bu sayfa): Top müşteri + Marka katkı + İskonto KPI.
 * Toplam ciro KPI hero + 3 panel single-page yönetici görünümü.
 */
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  searchParams: Promise<{ donem?: string; from?: string; to?: string; unit?: string }>;
};

export default async function V3YonetimKuruluPage({ searchParams }: Props) {
  const tenant = getTenantConfig();
  const locale = await getLocale();
  const sp = await searchParams;
  const dateFrom = sp.from && ISO_DATE_RX.test(sp.from) ? sp.from : null;
  const dateTo = sp.to && ISO_DATE_RX.test(sp.to) ? sp.to : null;
  const donem = dateFrom && dateTo ? null : (sp.donem ?? "").toLowerCase() || null;
  // Madde 8 — TL↔hacim görünüm anahtarı. `SatisUnitToggle` ile AYNI desen:
  // ekran-düzeyi anahtar, sunucuya gitmez (snapshot zaten her iki metriği de
  // taşıyor) — yalnızca hangi alanın öne çıkarılacağını belirler.
  const volumeKey = tenant.volume.key;
  const unit = sp.unit === volumeKey ? volumeKey : "tl";
  const volShort = tenant.volume?.short ? localizeVolumeUnit(tenant.volume.short, locale) : "";
  const showVolumePrimary = unit === volumeKey && Boolean(volShort);
  let snap: Awaited<ReturnType<typeof getWietnauerYonetim>> | null = null;
  let iskonto: IskontoSegmentsSlice | null = null;
  let err: string | null = null;
  try {
    // İki endpoint paralel — toplam latency = en yavaş tek snapshot.
    [snap, iskonto] = await Promise.all([
      getWietnauerYonetim({ dateFrom, dateTo, donem }),
      getWietnauerIskonto<IskontoSegmentsSlice>({ dateFrom, dateTo, donem }),
    ]);
  } catch (e) {
    err = (e as Error).message;
  }

  // Türev metrikler — gerçek portföy toplamı (top-N değil)
  const toplamCiro = snap?.discount.net ?? 0;
  // Madde 8 — hero KPI'ın hacim karşılığı (70cl eşdeğer).
  const toplamHacim = snap?.discount.netHacim ?? 0;
  const toplamFatura = snap?.discount.faturaCount ?? 0;
  const aktifMusteri = snap?.discount.aktifMusteriCount ?? 0;
  // md22: Top 10 distribütör konsantrasyonu (payPct kapsam toplamına göre)
  const top10Pay = snap
    ? snap.topDistributors.slice(0, 10).reduce((a, d) => a + d.payPct, 0)
    : 0;
  const stratPay = snap
    ? snap.brands.filter((b) => b.isStratejik).reduce((a, b) => a + b.payPct, 0)
    : 0;
  const stratCount = snap?.brands.filter((b) => b.isStratejik).length ?? 0;
  const top10Count = snap ? Math.min(10, snap.topDistributors.length) : 0;

  // Seçili dönemin insan-okur etiketi — panel alt-başlıklarına da geçiriyoruz
  // (bkz. TopDistributorsPanel/BrandContributionPanel "Son 30 gün" yerine).
  const periodLabel = donemLabel(donem, dateFrom, dateTo, locale);
  // Sayfa açıklaması: snapshot varsa gerçek toplamlarla, yoksa generic fallback.
  const pageDescription =
    locale === "en"
      ? snap
        ? `${tenant.displayName} portfolio health with ${periodLabel} data: ₺${formatCompact(toplamCiro)} net revenue, ${aktifMusteri.toLocaleString("tr-TR")} active customers; top ${top10Count} distributors carry %${top10Pay.toFixed(1)} of total revenue, and ${stratCount} strategic brands carry %${stratPay.toFixed(1)}.`
        : `${tenant.displayName} portfolio health in one screen — Top customer concentration, brand contributions, and discount investment rate over ${periodLabel} net revenue.`
      : snap
        ? `${tenant.displayName} portföy sağlığı ${periodLabel} verisiyle: ₺${formatCompact(toplamCiro)} net ciro, ${aktifMusteri.toLocaleString("tr-TR")} aktif müşteri; top ${top10Count} distribütör toplam cironun %${top10Pay.toFixed(1)}'ini, ${stratCount} stratejik marka ise %${stratPay.toFixed(1)}'ini taşıyor.`
        : `${tenant.displayName} portföy sağlığı tek ekranda — Top müşteri konsantrasyonu, marka katkıları ve iskonto yatırım oranı ${periodLabel} net ciro üzerinden.`;

  return (
    <div className="v3-page">
      <V3PageHeader
        locale={locale}
        eyebrow={t(locale, "page.yonetim.eyebrow", "Dashboard 01")}
        title={t(locale, "page.yonetim.title", "Yönetim Kurulu")}
        contentKey="page.yonetim.title"
        descKey="page.yonetim.desc"
        description={pageDescription}
        dataNote="TBLMSDFATURA + TBLMSDBELGEDETAY · DBLNETTUTAR/DBLNETFIYAT · BYTTUR=0 · BYTDURUM=0"
        generatedAt={snap?.generatedAt}
      />

      <GlobalDonemFilter />
      {/* Madde 8 — TL↔hacim görünüm anahtarı; `SatisUnitToggle` Satış
          Performansı ekranıyla PAYLAŞILAN bileşen (tenant.volume tabanlı,
          sunucuya ek sorgu gitmez), burada da olduğu gibi reuse edilir. */}
      <div className="v3-controls-row">
        <SatisUnitToggle />
      </div>

      {err && (
        <div className="v3-error">
          <strong>{t(locale, "page.yonetim.error", "Veri alınamadı:")}</strong> {err}
          <div className="v3-error-hint">
            {t(locale, "page.yonetim.error_hint", "VPN kontrol et veya MSSQL bağlantı durumunu doğrula.")}
          </div>
        </div>
      )}

      {snap && (
        <>
          {/* Üst şerit: 4 KPI özet kartı — gerçek portföy toplamları */}
          <div className="v3-kpi-grid">
            {!panelHidden("kpi.yonetim.ciro") &&
              (showVolumePrimary ? (
                <KpiTile
                  label={`${cs("kpi.yonetim.hacim", t(locale, "kpi.yonetim.hacim", "Toplam Hacim"))} (${volShort})`}
                  value={`${formatCompact(toplamHacim)} ${volShort}`}
                  sub={
                    locale === "en"
                      ? `${periodLabel} · ₺${formatCompact(toplamCiro)} revenue`
                      : `${periodLabel} · ₺${formatCompact(toplamCiro)} ciro`
                  }
                />
              ) : (
                <KpiTile
                  label={cs("kpi.yonetim.ciro", t(locale, "kpi.yonetim.ciro", "Toplam Net Ciro"))}
                  value={`₺${formatCompact(toplamCiro)}`}
                  sub={`${periodLabel}${volShort ? ` · ${formatCompact(toplamHacim)} ${volShort}` : ""}`}
                />
              ))}
            {!panelHidden("kpi.yonetim.aktif") && (
            <KpiTile
              label={cs("kpi.yonetim.aktif", t(locale, "kpi.yonetim.aktif", "Aktif Müşteri"))}
              value={aktifMusteri.toLocaleString("tr-TR")}
              sub={`${toplamFatura.toLocaleString("tr-TR")} ${locale === "en" ? "invoices" : "fatura"}`}
            />
          )}
            {!panelHidden("kpi.yonetim.konsantrasyon") && (
            <KpiTile
              label={cs("kpi.yonetim.konsantrasyon", t(locale, "kpi.yonetim.konsantrasyon", "Top 10 Konsantrasyon"))}
              value={`%${top10Pay.toFixed(1)}`}
              sub={locale === "en" ? `share of the top ${top10Count} distributors` : `ilk ${top10Count} distribütörün payı`}
              tone={top10Pay > 50 ? "warn" : "neutral"}
            />
          )}
            {!panelHidden("kpi.yonetim.stratejik") && (
            <KpiTile
              label={cs("kpi.yonetim.stratejik", t(locale, "kpi.yonetim.stratejik", "Stratejik Marka Payı"))}
              value={`%${stratPay.toFixed(1)}`}
              sub={locale === "en" ? `${stratCount} brands tracked` : `${stratCount} marka takipte`}
              tone="accent"
            />
          )}
          </div>

          {/* Üst içerik: 2 sütun (Marka katkıları + Top Distribütör) */}
          <div className="v3-content-grid">
            <BrandContributionPanel
              brands={snap.brands}
              periodLabel={periodLabel}
              unit={unit}
              volumeShort={volShort}
              locale={locale}
            />
            <TopDistributorsPanel
              distributors={snap.topDistributors}
              periodLabel={periodLabel}
              unit={unit}
              volumeShort={volShort}
              locale={locale}
            />
          </div>

          {/* Alt içerik: Segment Kırılımı — madde 8, DÖRT boyut, md10 ile
              Müşteri Segmentasyon ekranıyla AYNI sırada:
              (1) Müşteri Grubu, (2) Müşteri Ek Saha,
              (3) Müşteri Ek Grup, (4) Müşteri Grup Kırılımı.
              Başlıklar `panel.segment.*` anahtarlarını PAYLAŞIR (Müşteri
              Segmentasyon ekranındaki aynı boyut panelleriyle) — admin bir
              boyutu yeniden adlandırırsa iki ekranda da tutarlı kalır. */}
          {iskonto && (
            <div className="v3-segment-grid">
              {iskonto.segMusteriGrup.length > 0 && (
                <IskontoSegmentPanel
                  segments={iskonto.segMusteriGrup}
                  title={cs("panel.segment.musterigrubu", t(locale, "panel.segment.musterigrubu", "Müşteri Grubu"))}
                  dimensionLabel={locale === "en" ? "Customer group" : "Müşteri grubu"}
                  unit={unit}
                  volumeShort={volShort}
                  locale={locale}
                />
              )}
              {iskonto.segEkSaha.length > 0 && (
                <IskontoSegmentPanel
                  segments={iskonto.segEkSaha}
                  title={cs("panel.segment.eksaha", t(locale, "panel.segment.eksaha", "Müşteri Ek Saha"))}
                  dimensionLabel={locale === "en" ? "Combined extended field" : "Birleşik ek saha"}
                  unit={unit}
                  volumeShort={volShort}
                  locale={locale}
                />
              )}
              {iskonto.segEkGrup.length > 0 && (
                <IskontoSegmentPanel
                  segments={iskonto.segEkGrup}
                  title={cs("panel.segment.ekgrup", t(locale, "panel.segment.ekgrup", "Müşteri Ek Grubu"))}
                  dimensionLabel={locale === "en" ? "Customer sub-group (top 5 + Other)" : "Müşteri ek grup (ilk 5 + Diğer)"}
                  unit={unit}
                  volumeShort={volShort}
                  locale={locale}
                />
              )}
              {iskonto.segGrupKirilim.length > 0 && (
                <IskontoSegmentPanel
                  segments={iskonto.segGrupKirilim}
                  title={cs("panel.segment.grupkirilim", t(locale, "panel.segment.grupkirilim", "Müşteri Grup Kırılımı"))}
                  dimensionLabel={locale === "en" ? "Customer group breakdown" : "Müşteri grup kırılımı"}
                  unit={unit}
                  volumeShort={volShort}
                  locale={locale}
                />
              )}
            </div>
          )}
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .v3-controls-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .v3-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .v3-content-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        @media (min-width: 1080px) {
          .v3-content-grid {
            grid-template-columns: 1.4fr 1fr;
            align-items: start;
          }
        }
        .v3-segment-wrap {
          display: block;
        }
        /* Madde 8/10 — 4 segment paneli (2×2 orta ekran, tek sütun dar
           ekran). IskontoSegmentPanel satırları geniş (200px etiket + bar +
           260px para kolonları) — 4'ü aynı anda yan yana sıkıştırmak yerine
           2×2 tercih edildi (Müşteri Segmentasyon ekranındaki daha dar
           TipSegmentRow panellerinden farklı). */
        .v3-segment-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1080px) {
          .v3-segment-grid {
            grid-template-columns: 1fr 1fr;
            align-items: start;
          }
        }
        .v3-error {
          background: var(--color-bad-bg, rgba(220, 38, 38, 0.05));
          border: 1px solid var(--color-bad, #dc2626);
          border-radius: 8px;
          padding: 14px 16px;
          margin-bottom: 20px;
          font-size: 13px;
          color: var(--color-fg);
        }
        .v3-error-hint {
          margin-top: 4px;
          font-size: 12px;
          color: var(--color-muted);
        }
      `,
        }}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warn" | "accent";
}) {
  const color =
    tone === "warn"
      ? "var(--color-bad)"
      : tone === "accent"
        ? "var(--color-accent)"
        : "var(--color-fg)";
  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--color-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--color-muted-2)",
        }}
      >
        {sub}
      </div>
    </div>
  );
}
