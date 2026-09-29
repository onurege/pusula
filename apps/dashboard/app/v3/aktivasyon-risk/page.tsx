import { getWietnauerAktivasyon, getAllowedDistributors, listMapCustomers, type AllowedDistributor, type VisitOrderRiskTier } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { ActiveCustomersPanel } from "@/components/v3/aktivasyon/ActiveCustomersPanel";
import { SilentCustomersPanel } from "@/components/v3/aktivasyon/SilentCustomersPanel";
import { StrategicSilencePanel } from "@/components/v3/aktivasyon/StrategicSilencePanel";
import { RiskTierPanel } from "@/components/v3/aktivasyon/RiskTierPanel";
import { RecoveryPanel } from "@/components/v3/aktivasyon/RecoveryPanel";
import { AktivasyonDistSelect } from "@/components/v3/aktivasyon/AktivasyonDistSelect";
import { RiskConfigBar } from "@/components/v3/aktivasyon/RiskConfigBar";
import type { AktivasyonSnapshot, RiskTierBucket } from "@/components/v3/aktivasyon/types";
import { getLocale, t } from "@/lib/i18n";

export async function generateMetadata() {
  const locale = await getLocale();
  return { title: `${t(locale, "page.risk.title", "Müşteri Aktivasyon & Risk")} · V3 · Insider` };
}

type Props = {
  searchParams: Promise<{
    distId?: string;
    /** Madde 13(c) — map ile AYNI param'lar (URL-state, deep-link tutarlı). */
    riskPriority?: string;
    riskTiersInScope?: string;
    /** Madde 13(d) — bu ekrana özel pencere seçici (harita üstteki dönem
     *  seçicisini kullanır; bu sayfada ayrı bir dönem filtresi yok). */
    riskWindowDays?: string;
  }>;
};

const VISIT_ORDER_TIER_VALUES = ["red", "orange", "yellow", "green"] as const;

function parseRiskTiersInScope(raw: string | undefined): VisitOrderRiskTier[] | undefined {
  if (!raw) return undefined;
  const valid = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is VisitOrderRiskTier => (VISIT_ORDER_TIER_VALUES as readonly string[]).includes(s));
  return valid.length > 0 ? valid : undefined;
}

/**
 * V3 Dashboard #6 — Müşteri Aktivasyon & Risk.
 *
 * Wietnauer talebi:
 *   - Son 3 ayda aktif müşteri sayısı (tenant-konfigüre müşteri kırılımı — Wietnauer'da birleşik ek saha)
 *   - 3 ay sessizleşen müşteriler (kayıp listesi)
 *   - Stratejik markada sessizleşen müşteriler
 *   - Risk tier dağılımı
 *   - Yeniden kazanım fırsatları (saha aksiyon listesi)
 *
 * Veri kaynağı: MSSQL (aktif, sessiz, stratejik) + SQLite map_customers
 * mirror (risk tier, recovery targets). Stratejik marka listesi tenant
 * config'ten gelir, SQL'e parametre olarak ilerler.
 */
export default async function V3AktivasyonRiskPage({ searchParams }: Props) {
  const tenant = getTenantConfig();
  const locale = await getLocale();
  const sp = await searchParams;
  const distIdParsed = sp.distId != null ? Number(sp.distId) : null;
  const distId = distIdParsed != null && Number.isFinite(distIdParsed) ? distIdParsed : null;

  // Madde 13(c)(d) — "visit-order" risk modeli (yalnız Wietnauer) ekran-bazlı
  // config. Composite tenant'larda (`tenant.riskModel !== "visit-order"`)
  // TAMAMEN devre dışı — snap.riskTiers AYNEN kullanılır, sıfır regresyon.
  const isVisitOrderModel = tenant.riskModel === "visit-order";
  const riskPriorityRaw = sp.riskPriority;
  const riskPriority: "visit" | "order" =
    riskPriorityRaw === "visit" || riskPriorityRaw === "order"
      ? riskPriorityRaw
      : (tenant.riskConfig?.priority ?? "visit");
  const riskTiersInScope: VisitOrderRiskTier[] =
    parseRiskTiersInScope(sp.riskTiersInScope) ?? (tenant.riskConfig?.riskTiers as VisitOrderRiskTier[] | undefined) ?? ["red", "orange"];
  const riskWindowDaysParsed = sp.riskWindowDays ? Number(sp.riskWindowDays) : undefined;
  const riskWindowDays: 30 | 60 | 90 =
    riskWindowDaysParsed === 30 || riskWindowDaysParsed === 60 || riskWindowDaysParsed === 90
      ? riskWindowDaysParsed
      : 30;

  let snap: AktivasyonSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerAktivasyon<AktivasyonSnapshot>({ distId });
  } catch (e) {
    err = (e as Error).message;
  }

  // Madde 13(c)(d) — `getWietnauerAktivasyon`'un kendi `riskTiers`'ı sabit
  // 30g pencere + tenant varsayılan öncelik/tier-kapsamıyla hesaplanır
  // (backend override almıyor — bkz. packages/core/src/wietnauer-aktivasyon.ts
  // `RISK_DISTRIBUTION_WINDOW_DAYS`). Kullanıcı önceliği/tier-kapsamını/
  // pencereyi DEĞİŞTİREBİLSİN diye — ve harita ile TUTARLI kalsın diye —
  // dağılımı burada AYRICA `/api/map/customers`'tan (backend bu 3 parametreyi
  // TAM destekliyor, bkz. packages/core/src/map.ts computeVisitOrderRisk)
  // canlı hesaplıyoruz; tek satırlık müşteri kaydı yerine yalnız tier sayımı
  // lazım ama ayrı bir "sadece sayım" endpoint'i yok — mevcut endpoint'i
  // (haritanın zaten her yüklemede çektiği veri hacmiyle aynı mertebede)
  // yeniden kullanmak, backend'e dokunmadan (Faz A4 kapsamı DIŞI) gerçek bir
  // config sunmanın tek yolu.
  let liveRiskTiers: RiskTierBucket[] | null = null;
  let liveRiskTiersErr: string | null = null;
  if (isVisitOrderModel) {
    try {
      const { customers } = await listMapCustomers({
        distKod: distId ?? undefined,
        riskPriority,
        riskTiersInScope,
        riskWindowDays,
        limit: 50000,
      });
      const counts = new Map<string, number>();
      for (const c of customers) {
        const tier = c.visitOrderRisk?.tier;
        if (!tier) continue;
        counts.set(tier, (counts.get(tier) ?? 0) + 1);
      }
      const toplam = [...counts.values()].reduce((a, b) => a + b, 0);
      liveRiskTiers = [...counts.entries()].map(([tier, musteriSayi]) => ({
        tier,
        musteriSayi,
        payPct: toplam > 0 ? (musteriSayi / toplam) * 100 : 0,
      }));
    } catch (e) {
      // fail-soft — snap.riskTiers'a (tenant varsayılanı, sabit 30g) düş.
      liveRiskTiersErr = (e as Error).message;
    }
  }

  // Distribütör dropdown'u ayrı, hataya toleranslı — bu çağrı başarısız olsa
  // bile (ör. yetki listesi alınamazsa) ana snapshot etkilenmesin. Pattern
  // ticari-yatırım (iskonto) sayfasıyla aynı.
  let distributors: AllowedDistributor[] = [];
  try {
    distributors = await getAllowedDistributors();
  } catch {
    distributors = [];
  }

  const selectedDist = distId != null ? distributors.find((d) => d.id === distId) ?? null : null;

  // Madde 13(c) — kontrolün GÖRÜNÜR etkisi: her tier'ın müşteri adedi +
  // seçili (risk sayılan) tier'ların TOPLAMI. Tier seçimi değişince bu sayı
  // değişir → kontrol artık işlevsel.
  const voBuckets = isVisitOrderModel && liveRiskTiers ? liveRiskTiers : [];
  const tierCountMap: Partial<Record<VisitOrderRiskTier, number>> = {};
  for (const b of voBuckets) tierCountMap[b.tier as VisitOrderRiskTier] = b.musteriSayi;
  const riskMusteriSayisi = voBuckets
    .filter((b) => riskTiersInScope.includes(b.tier as VisitOrderRiskTier))
    .reduce((a, b) => a + b.musteriSayi, 0);

  return (
    <div className="v3-page">
      <V3PageHeader
        locale={locale}
        eyebrow={t(locale, "page.risk.eyebrow", "Dashboard 06")}
        title={t(locale, "page.risk.title", "Müşteri Aktivasyon & Risk")}
        contentKey="page.risk.title"
        descKey="page.risk.desc"
        description={
          locale === "en"
            ? selectedDist
              ? `${selectedDist.ad} — active/silent split over the last 90 days, strategic brand silence, and risk-score-based win-back targets. Action list for the field team.`
              : `${tenant.displayName} across the full portfolio — active/silent split over the last 90 days, strategic brand silence, and risk-score-based win-back targets. Pick a distributor from the dropdown to focus on one.`
            : selectedDist
              ? `${selectedDist.ad} — son 90 günde aktif/sessiz ayrımı, stratejik marka sessizliği ve risk skoru bazlı yeniden kazanım hedefleri. Saha ekibi için aksiyon listesi.`
              : `${tenant.displayName} tüm portföyde son 90 günde aktif/sessiz ayrımı, stratejik marka sessizliği ve risk skoru bazlı yeniden kazanım hedefleri. Belirli bir distribütöre odaklanmak için dropdown'dan seç.`
        }
        dataNote={
          isVisitOrderModel
            ? locale === "en"
              ? `TBLMSDFATURA · TBLPMPZIYARETBASLIK (visit) · TBLMSDSIPARIS (order) · visit-order risk (${riskWindowDays}d window)`
              : `TBLMSDFATURA · TBLPMPZIYARETBASLIK (ziyaret) · TBLMSDSIPARIS (sipariş) · ziyaret-sipariş riski (${riskWindowDays}g pencere)`
            : locale === "en"
              ? "TBLMSDFATURA · 90/180d window · map_customers risk_tier_v2"
              : "TBLMSDFATURA · 90/180g pencere · map_customers risk_tier_v2"
        }
        generatedAt={snap?.generatedAt}
      />

      {err && (
        <div className="v3-error">
          <strong>{t(locale, "page.risk.error", "Veri alınamadı:")}</strong> {err}
          <div className="v3-error-hint">
            {t(locale, "page.risk.error_hint", "VPN kontrol et veya MSSQL bağlantı durumunu doğrula.")}
          </div>
        </div>
      )}

      {snap && (
        <AktivasyonDistSelect distributors={distributors} selectedDistId={distId} locale={locale} />
      )}

      {/* Madde 13(c)(d) — yalnız "visit-order" risk modelinde (Wietnauer)
          gösterilir; composite tenant'larda (Pernod/fmcg-demo) hiç render
          edilmez (regresyonsuz). */}
      {snap && isVisitOrderModel && (
        <RiskConfigBar
          priority={riskPriority}
          tiersInScope={riskTiersInScope}
          windowDays={riskWindowDays}
          tierCounts={tierCountMap}
          riskCount={riskMusteriSayisi}
          locale={locale}
        />
      )}

      {snap && isVisitOrderModel && liveRiskTiersErr && (
        <div className="v3-error">
          <strong>{t(locale, "page.risk.error", "Veri alınamadı:")}</strong> {liveRiskTiersErr}
          <div className="v3-error-hint">
            {locale === "en"
              ? "Falling back to the default (90d snapshot) distribution below."
              : "Aşağıda varsayılan (90g anlık) dağılıma düşüldü."}
          </div>
        </div>
      )}

      {snap && (
        <div className="v3-content-grid">
          <div className="col-left">
            <ActiveCustomersPanel data={snap.active} locale={locale} />
            <SilentCustomersPanel items={snap.silent} locale={locale} />
          </div>
          <div className="col-right">
            <RiskTierPanel
              buckets={liveRiskTiers ?? snap.riskTiers}
              locale={locale}
              riskModel={tenant.riskModel}
              windowDays={isVisitOrderModel ? riskWindowDays : undefined}
              tiersInScope={isVisitOrderModel ? riskTiersInScope : undefined}
              priority={isVisitOrderModel ? riskPriority : undefined}
            />
            <StrategicSilencePanel items={snap.strategicSilence} locale={locale} />
            <RecoveryPanel items={snap.recovery} locale={locale} />
          </div>
        </div>
      )}

      {/* Shared v3-panel + v3-table skin — aktivasyon panelleri kendi style'larına
          ek olarak ortak iskeleti buradan alır. Pattern: Yönetim Kurulu page'iyle
          aynı, ama orada skin TopCustomersPanel'in içinde — burada page-level. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .v3-content-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1080px) {
          .v3-content-grid {
            grid-template-columns: 1.4fr 1fr;
            align-items: start;
          }
        }
        .col-left, .col-right {
          display: flex; flex-direction: column; gap: 16px; min-width: 0;
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

        /* --- Ortak v3-panel iskeleti --- */
        .v3-panel {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 10px;
          padding: 18px 20px;
        }
        .v3-panel-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .v3-panel-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--color-fg);
          letter-spacing: -0.01em;
        }
        .v3-panel-sub {
          font-size: 12px;
          color: var(--color-muted);
          margin-top: 2px;
        }

        /* --- Ortak v3-table iskeleti --- */
        .v3-table-wrap {
          overflow-x: auto;
          margin: 0 -4px;
        }
        .v3-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
        }
        .v3-table thead th {
          text-align: left;
          padding: 8px 10px;
          font-size: 10.5px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border-bottom: 1px solid var(--color-border);
          white-space: nowrap;
        }
        .v3-table thead th.num {
          text-align: right;
        }
        .v3-table tbody tr {
          border-bottom: 1px solid var(--color-border);
        }
        .v3-table tbody tr:hover {
          background: var(--color-surface-2, rgba(0,0,0,0.02));
        }
        .v3-table td {
          padding: 9px 10px;
          color: var(--color-fg);
          vertical-align: middle;
        }
        .v3-table td.rank {
          font-weight: 600;
          color: var(--color-muted);
          font-variant-numeric: tabular-nums;
          width: 30px;
        }
        .v3-table td.unvan {
          font-weight: 500;
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .v3-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      `,
        }}
      />
    </div>
  );
}
