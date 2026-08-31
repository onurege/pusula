import { getWietnauerIskonto, getAllowedDistributors, type AllowedDistributor } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { IskontoFilterBar } from "@/components/v3/iskonto/IskontoFilterBar";
import { IskontoHeroPanel } from "@/components/v3/iskonto/IskontoHeroPanel";
import { IskontoMonthlyTrendPanel } from "@/components/v3/iskonto/IskontoMonthlyTrendPanel";
import { IskontoBrandPanel } from "@/components/v3/iskonto/IskontoBrandPanel";
import { IskontoCustomerPanel } from "@/components/v3/iskonto/IskontoCustomerPanel";
import { IskontoSegmentPanel } from "@/components/v3/iskonto/IskontoSegmentPanel";

export const metadata = { title: "Ticari Yatırım & İskonto · V3 · Insider" };

/**
 * V3 Dashboard #7 — Ticari Yatırım & İskonto.
 *
 * Wietnauer talebi:
 *   - Harcanan iskonto tutarı + iskonto/ciro oranı (KPI hero)
 *   - Aylık iskonto trendi (12 ay)
 *   - Marka × iskonto etkinliği (Top 15, yoY net büyüme dahil)
 *   - Müşteri ROI Top 20 (premium / sağlıklı / iskonto bağımlı etiketi)
 *   - Segment kırılımı (Müşteri Tipi × ortalama iskonto oranı)
 *
 * Tüm metrikler son 30g kapalı pencere. Marka tablosu tenant.brandTable
 * üzerinden parametre (Wietnauer: TBLURUNGRUP, Pernod: TBLURUNEKGRUP).
 */

// Backend tipiyle eşleşen sayfa-içi şema (api.ts unknown döner)
type IskontoSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  overall: {
    brut: number;
    iskonto: number;
    net: number;
    iskontoOraniPct: number;
    faturaCount: number;
    aktifMusteriCount: number;
  };
  monthly: Array<{
    yyyymm: string;
    ay: string;
    brut: number;
    iskonto: number;
    net: number;
    iskontoOraniPct: number;
  }>;
  brands: Array<{
    marka: string;
    markaKod: string;
    brut: number;
    iskonto: number;
    net: number;
    iskontoOraniPct: number;
    yoyNetPct: number | null;
    rank: number;
    isStratejik: boolean;
  }>;
  topCustomers: Array<{
    id: number;
    unvan: string;
    sehir: string | null;
    brut: number;
    iskonto: number;
    net: number;
    iskontoOraniPct: number;
    faturaSayisi: number;
    rank: number;
    etiket: "premium" | "saglikli" | "bagimli";
  }>;
  segments: Array<{
    segment: string;
    brut: number;
    iskonto: number;
    net: number;
    iskontoOraniPct: number;
    musteriSayi: number;
    faturaSayisi: number;
  }>;
};

// `from`/`to` yalnızca YYYY-MM-DD kabul edilir — biçim bozuksa aralık yok
// sayılır (backend'in `normalizeDateRange`'iyle tutarlı, kısmi aralık kabul
// edilmez).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return ISO_DATE_RE.test(s) ? s : null;
}

type Props = {
  searchParams: Promise<{ distId?: string; from?: string; to?: string }>;
};

export default async function V3TicariYatirimPage({ searchParams }: Props) {
  const tenant = getTenantConfig();
  const sp = await searchParams;

  const distIdParsed = sp.distId != null ? Number(sp.distId) : null;
  const distId = distIdParsed != null && Number.isFinite(distIdParsed) ? distIdParsed : null;

  const fromParsed = parseDateParam(sp.from);
  const toParsed = parseDateParam(sp.to);
  // Kısmi aralık (yalnız biri) yok sayılır — ikisi de olmalı.
  const dateFrom = fromParsed && toParsed ? fromParsed : null;
  const dateTo = fromParsed && toParsed ? toParsed : null;

  let snap: IskontoSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerIskonto<IskontoSnapshot>({ distId, dateFrom, dateTo });
  } catch (e) {
    err = (e as Error).message;
  }

  // Distribütör dropdown'u ayrı, hataya toleranslı — bu çağrı başarısız olsa
  // bile (ör. yetki listesi alınamazsa) ana snapshot etkilenmesin.
  let distributors: AllowedDistributor[] = [];
  try {
    distributors = await getAllowedDistributors();
  } catch {
    distributors = [];
  }

  const rangeLabel = dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : null;

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 07"
        title="Ticari Yatırım & İskonto"
        contentKey="page.iskonto.title"
        descKey="page.iskonto.desc"
        description={
          rangeLabel
            ? `${tenant.displayName} için ${rangeLabel} aralığında iskonto yatırımı: ` +
              "brüt → iskonto → net akışı, marka & müşteri & segment ROI'leri."
            : `${tenant.displayName} için iskonto yatırımı uçtan uca: ` +
              "brüt → iskonto → net akışı, 12 aylık trend, marka & müşteri & segment ROI'leri. " +
              "Sağlıklı iskonto = küçük yatırım, büyük büyüme."
        }
        dataNote="TBLMSDFATURA · DBLISKONTOTUTARI + TBLMSDBELGEDETAY · BYTTUR=0 · BYTDURUM=0"
        generatedAt={snap?.generatedAt}
      />

      <IskontoFilterBar
        distributors={distributors}
        selectedDistId={distId}
        dateFrom={dateFrom}
        dateTo={dateTo}
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
        <div className="iskonto-stack">
          <IskontoHeroPanel
            brut={snap.overall.brut}
            iskonto={snap.overall.iskonto}
            net={snap.overall.net}
            iskontoOraniPct={snap.overall.iskontoOraniPct}
            faturaCount={snap.overall.faturaCount}
            aktifMusteriCount={snap.overall.aktifMusteriCount}
          />

          <IskontoMonthlyTrendPanel points={snap.monthly} />

          <div className="iskonto-twocol">
            <IskontoBrandPanel brands={snap.brands} />
            <IskontoSegmentPanel segments={snap.segments} />
          </div>

          <IskontoCustomerPanel customers={snap.topCustomers} />
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .iskonto-stack { display: flex; flex-direction: column; gap: 16px; }
        .iskonto-twocol {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1180px) {
          .iskonto-twocol {
            grid-template-columns: 3fr 2fr;
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
