import { getWietnauerAktivasyon, getAllowedDistributors, type AllowedDistributor } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { ActiveCustomersPanel } from "@/components/v3/aktivasyon/ActiveCustomersPanel";
import { SilentCustomersPanel } from "@/components/v3/aktivasyon/SilentCustomersPanel";
import { StrategicSilencePanel } from "@/components/v3/aktivasyon/StrategicSilencePanel";
import { RiskTierPanel } from "@/components/v3/aktivasyon/RiskTierPanel";
import { RecoveryPanel } from "@/components/v3/aktivasyon/RecoveryPanel";
import { AktivasyonDistSelect } from "@/components/v3/aktivasyon/AktivasyonDistSelect";
import type { AktivasyonSnapshot } from "@/components/v3/aktivasyon/types";

export const metadata = {
  title: "Müşteri Aktivasyon & Risk · V3 · Insider",
};

type Props = {
  searchParams: Promise<{ distId?: string }>;
};

/**
 * V3 Dashboard #6 — Müşteri Aktivasyon & Risk.
 *
 * Wietnauer talebi:
 *   - Son 3 ayda aktif müşteri sayısı (müşteri grup kırılımı — TBLMUSTERIGRUPKIRILIM)
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
  const sp = await searchParams;
  const distIdParsed = sp.distId != null ? Number(sp.distId) : null;
  const distId = distIdParsed != null && Number.isFinite(distIdParsed) ? distIdParsed : null;

  let snap: AktivasyonSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerAktivasyon<AktivasyonSnapshot>({ distId });
  } catch (e) {
    err = (e as Error).message;
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

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 06"
        title="Müşteri Aktivasyon & Risk"
        contentKey="page.risk.title"
        descKey="page.risk.desc"
        description={
          selectedDist
            ? `${selectedDist.ad} — son 90 günde aktif/sessiz ayrımı, stratejik marka sessizliği ve risk skoru bazlı yeniden kazanım hedefleri. Saha ekibi için aksiyon listesi.`
            : `${tenant.displayName} tüm portföyde son 90 günde aktif/sessiz ayrımı, stratejik marka sessizliği ve risk skoru bazlı yeniden kazanım hedefleri. Belirli bir distribütöre odaklanmak için dropdown'dan seç.`
        }
        dataNote="TBLMSDFATURA · 90/180g pencere · TBLMUSTERIGRUPKIRILIM müşteri grup kırılımı · map_customers risk_tier_v2"
        generatedAt={snap?.generatedAt}
      />

      {err && (
        <div className="v3-error">
          <strong>Veri alınamadı:</strong> {err}
          <div className="v3-error-hint">
            VPN kontrol et veya MSSQL bağlantı durumunu doğrula.
          </div>
        </div>
      )}

      {snap && (
        <AktivasyonDistSelect distributors={distributors} selectedDistId={distId} />
      )}

      {snap && (
        <div className="v3-content-grid">
          <div className="col-left">
            <ActiveCustomersPanel data={snap.active} />
            <SilentCustomersPanel items={snap.silent} />
          </div>
          <div className="col-right">
            <RiskTierPanel buckets={snap.riskTiers} />
            <StrategicSilencePanel items={snap.strategicSilence} />
            <RecoveryPanel items={snap.recovery} />
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
