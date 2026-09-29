"use client";

import { useMemo, useState } from "react";
import type { StockRiskTier, WietnauerStockSkuRow } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";
import { t, type Locale } from "@/lib/i18n";

const PAGE_SIZE_OPTIONS = [25, 50] as const;
const DEFAULT_PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 25;

type Props = {
  rows: WietnauerStockSkuRow[];
  locale?: Locale;
};

/**
 * md38: "Tüm SKU'lar + pagination" — fetcher artık kırpma yapmadan tüm
 * SKU × dist satırlarını döner (`WietnauerStockSnapshot.items`); bu client
 * component büyük listeyi client-side sayfalar. Sunucu tarafında ek sorgu
 * yok, tüm veri zaten tek RSC render'ında elde var — sayfa değişimi network
 * gitmeden anında olur.
 *
 * Dist filtre değişince üst bileşen (`page.tsx`) bu component'i farklı bir
 * `key` ile yeniden mount eder; böylece sayfa numarası her filtre
 * değişiminde 1'e döner.
 */
export function StokSkuTable({ rows, locale = "tr" }: Props) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => rows.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize),
    [rows, clampedPage, pageSize],
  );

  const rangeStart = rows.length === 0 ? 0 : clampedPage * pageSize + 1;
  const rangeEnd = Math.min(rows.length, clampedPage * pageSize + pageRows.length);

  function goTo(next: number) {
    setPage(Math.min(Math.max(next, 0), pageCount - 1));
  }

  function onPageSizeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextSize = Number(e.target.value);
    // Görünür ilk satır aynı kalacak şekilde sayfayı yeni boyuta göre yeniden konumlandır.
    const firstVisibleIndex = clampedPage * pageSize;
    setPageSize(nextSize);
    setPage(Math.floor(firstVisibleIndex / nextSize));
  }

  return (
    <>
      <div className="stok-table-wrap">
        <table className="stok-table">
          <thead>
            <tr>
              <th>{t(locale, "col.sku", "SKU")}</th>
              <th>{t(locale, "col.distributor", "Distribütör")}</th>
              <th>{t(locale, "col.marka", "Marka")}</th>
              <th>{t(locale, "col.risk", "Risk")}</th>
              <th className="num">{locale === "en" ? "Remaining" : "Kalan"}</th>
              <th>{locale === "en" ? "Stockout" : "Tükenme"}</th>
              <th className="num">{t(locale, "col.stok", "Stok")}</th>
              <th className="num">{t(locale, "col.satis90g", "90g Satış")}</th>
              <th className="num">{locale === "en" ? "Forecast/day" : "Tahmin/gün"}</th>
              <th className="num">{locale === "en" ? "Turnover" : "Devir"}</th>
              <th className="num">ROP</th>
              <th className="num">{locale === "en" ? "Shortfall" : "Eksik"}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={12} className="stok-empty">
                  {locale === "en" ? "No records." : "Kayıt yok."}
                </td>
              </tr>
            )}
            {pageRows.map((row) => (
              <tr key={`${row.distId}-${row.skuId}`}>
                <td>
                  <div className="stok-sku">
                    <span className="stok-sku-name">{row.skuName}</span>
                    <span className="stok-sku-code">{row.skuCode || `#${row.skuId}`}</span>
                  </div>
                </td>
                <td>{row.distName}</td>
                <td>{row.brand ?? "-"}</td>
                <td>
                  <div className="stok-risk-cell">
                    <RiskBadge tier={row.riskTier} locale={locale} />
                    {row.lowConfidence && (
                      <span
                        className="stok-lowconf"
                        title={
                          locale === "en"
                            ? `Low confidence: on-hand stock is only %${row.netSignalPct ?? "?"} of total movement — a small difference of large in/out flows. A single unrecorded receipt could flip this. Should be verified with a physical count.`
                            : `Düşük güven: eldeki stok toplam hareketin yalnızca %${row.netSignalPct ?? "?"}'i — büyük giriş/çıkış akışının küçük farkı. Tek kaydedilmemiş giriş bu sonucu tersine çevirebilir. Fiziksel stok sayımıyla doğrulanmalı.`
                        }
                      >
                        {locale === "en" ? "low confidence" : "düşük güven"}
                      </span>
                    )}
                    <span className={`confidence confidence-${row.stockConfidence}`}>
                      {confidenceLabel(row.stockConfidence, locale)} · {row.stockConfidenceScore}
                    </span>
                  </div>
                </td>
                <td className="num">{formatDays(row.daysLeft, locale)}</td>
                <td>{row.estimatedStockoutDate ? formatDate(row.estimatedStockoutDate, locale) : "-"}</td>
                <td className="num">{formatQty(row.onHandQty)}</td>
                <td className="num">{formatQty(row.soldQty90d)}</td>
                <td className="num">
                  <span
                    title={
                      locale === "en"
                        ? `Croston 180d: ${formatQty(row.crostonDailyQty)} · trend x${row.trendFactor.toFixed(2)} · seasonality x${row.seasonalityFactor.toFixed(2)}${row.seasonalityReason ? ` (${row.seasonalityReason})` : ""}`
                        : `Croston 180g: ${formatQty(row.crostonDailyQty)} · trend x${row.trendFactor.toFixed(2)} · mevsim x${row.seasonalityFactor.toFixed(2)}${row.seasonalityReason ? ` (${row.seasonalityReason})` : ""}`
                    }
                  >
                    {formatQty(row.forecastDailyQty)}
                  </span>
                </td>
                <td className="num">{row.turnover90d == null ? "-" : row.turnover90d.toFixed(2)}</td>
                <td className="num">
                  <span
                    title={
                      locale === "en"
                        ? `Lead time: ${row.leadTimeDays} days (${leadTimeSourceLabel(row.leadTimeSource, locale)}) · safety stock: ${formatQty(row.safetyStockQty)}`
                        : `Lead time: ${row.leadTimeDays} gün (${leadTimeSourceLabel(row.leadTimeSource, locale)}) · emniyet stok: ${formatQty(row.safetyStockQty)}`
                    }
                  >
                    {formatQty(row.reorderPointQty)}
                  </span>
                </td>
                <td className="num">
                  <span
                    title={
                      locale === "en"
                        ? `ROP - inventory position. Position: stock ${formatQty(row.onHandQty)} + on order ${formatQty(row.openOrderQty)} = ${formatQty(row.inventoryPositionQty)}`
                        : `ROP - envanter pozisyonu. Pozisyon: stok ${formatQty(row.onHandQty)} + yolda ${formatQty(row.openOrderQty)} = ${formatQty(row.inventoryPositionQty)}`
                    }
                  >
                    {row.reorderGapQty > 0 ? formatQty(row.reorderGapQty) : "-"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stok-pagination">
        <span className="stok-pagination-count">
          {rangeStart.toLocaleString("tr-TR")}-{rangeEnd.toLocaleString("tr-TR")} / {rows.length.toLocaleString("tr-TR")} SKU
        </span>
        <div className="stok-pagination-controls">
          <label className="stok-pagination-size">
            {locale === "en" ? "Per page" : "Sayfa başına"}
            <select value={pageSize} onChange={onPageSizeChange}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="stok-pagination-btn"
            onClick={() => goTo(clampedPage - 1)}
            disabled={clampedPage <= 0}
          >
            {locale === "en" ? "‹ Back" : "‹ Geri"}
          </button>
          <span className="stok-pagination-page">
            {locale === "en" ? `Page ${clampedPage + 1} / ${pageCount}` : `Sayfa ${clampedPage + 1} / ${pageCount}`}
          </span>
          <button
            type="button"
            className="stok-pagination-btn"
            onClick={() => goTo(clampedPage + 1)}
            disabled={clampedPage >= pageCount - 1}
          >
            {locale === "en" ? "Next ›" : "İleri ›"}
          </button>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .stok-empty {
          text-align: center;
          color: var(--color-muted);
          padding: 24px 12px;
        }
        .stok-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 10px 16px;
          border-top: 1px solid var(--color-border);
          font-size: 12px;
        }
        .stok-pagination-count {
          color: var(--color-muted);
          font-variant-numeric: tabular-nums;
        }
        .stok-pagination-controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .stok-pagination-size {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--color-muted);
          font-size: 11.5px;
        }
        .stok-pagination-size select {
          padding: 4px 6px;
          font-size: 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 5px;
          color: var(--color-fg);
          font-family: inherit;
        }
        .stok-pagination-btn {
          padding: 5px 10px;
          font-size: 12px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 5px;
          color: var(--color-fg);
          cursor: pointer;
          font-family: inherit;
        }
        .stok-pagination-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .stok-pagination-btn:not(:disabled):hover {
          background: var(--color-surface-2);
        }
        .stok-pagination-page {
          color: var(--color-fg);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      `,
        }}
      />
    </>
  );
}

function RiskBadge({ tier, locale = "tr" }: { tier: StockRiskTier; locale?: Locale }) {
  const labels: Record<StockRiskTier, string> = locale === "en"
    ? { critical: "Critical", risk: "Risk", watch: "Watch", healthy: "Healthy", unknown: "Unknown" }
    : { critical: "Kritik", risk: "Risk", watch: "İzle", healthy: "Sağlıklı", unknown: "Belirsiz" };
  return <span className={`risk-badge risk-${tier}`}>{labels[tier]}</span>;
}

function confidenceLabel(value: WietnauerStockSkuRow["stockConfidence"], locale: Locale = "tr"): string {
  return locale === "en"
    ? { high: "high", medium: "medium", low: "low" }[value]
    : { high: "yüksek", medium: "orta", low: "düşük" }[value];
}

function leadTimeSourceLabel(value: WietnauerStockSkuRow["leadTimeSource"], locale: Locale = "tr"): string {
  if (locale === "en") return value === "dist-table" ? "distributor-defined" : "default";
  return value === "dist-table" ? "distribütör tanımı" : "varsayılan";
}

function formatDays(days: number | null, locale: Locale = "tr"): string {
  if (days == null || !Number.isFinite(days)) return "-";
  const unit = locale === "en" ? "d" : "gün";
  if (days < 1) return `<1 ${unit}`;
  return `${days < 10 ? days.toFixed(1) : Math.round(days).toLocaleString("tr-TR")} ${unit}`;
}

function formatQty(value: number): string {
  if (Math.abs(value) >= 10000) return formatCompact(value);
  return value.toLocaleString("tr-TR", {
    maximumFractionDigits: value === Math.trunc(value) ? 0 : 1,
  });
}

function formatDate(isoDate: string, locale: Locale = "tr"): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString(locale === "en" ? "en-US" : "tr-TR", {
    day: "2-digit",
    month: "short",
  });
}
