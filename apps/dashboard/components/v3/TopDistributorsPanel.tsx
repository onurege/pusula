"use client";

import { useState } from "react";
import type { WietnauerTopDistributor } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";
import { useContent } from "@/components/content-provider";
import { t as translate, type Locale } from "@/lib/i18n";

type Limit = 10 | 20 | 0; // 0 = Tümü

/**
 * md22/md23 — Top Distribütör analizi (eski Top Müşteri analizinin yerine).
 *
 * Distribütör bazında son 30g net ciro DESC. Ek olarak (md23):
 *   - Aktif Müşteri: dist portföyündeki BYTDURUM=0 müşteri (kapsam paydası)
 *   - FKMS: son 30g fatura kesilen distinct müşteri
 *   - Kapsam%: FKMS / Aktif Müşteri — portföyün ne kadarına 30g'de satış yapıldı
 * Pay% = kapsamın toplam cirosuna göre konsantrasyon.
 *
 * Madde 8 — TL↔hacim toggle. Backend yalnızca `hacim` alanını taşır, hacim
 * bazlı pay% BİLE İSTEMEZ döndürmez (bkz. `WietnauerTopDistributor.hacim`
 * doc'u); FE burada tam portföy toplamına göre kendi hacim payını türetir —
 * `SalesVelocityPanel`/`BrandContributionPanel` ile AYNI `unit`/`volumeShort`
 * prop deseni (`unit !== "tl" && volumeShort` → hacim modu).
 */
export function TopDistributorsPanel({
  distributors,
  periodLabel,
  unit = "tl",
  volumeShort,
  locale = "tr",
}: {
  distributors: WietnauerTopDistributor[];
  /** Seçili dönemin insan-okur etiketi (örn. "son 30 gün", "bu ay"). */
  periodLabel?: string;
  /** `"tl"` (varsayılan) → ciro. Tenant hacim birimi anahtarı verilirse hacim. */
  unit?: string;
  /** Hacim birimi kısa etiketi (ör. "70cl") — yalnızca `unit !== "tl"` iken kullanılır. */
  volumeShort?: string;
  locale?: Locale;
}) {
  const { t, isHidden } = useContent();
  const [limit, setLimit] = useState<Limit>(10);
  const period = periodLabel ?? (locale === "en" ? "last 30 days" : "son 30 gün");
  const useVolume = unit !== "tl" && Boolean(volumeShort);
  // Portföy toplamı üzerinden hacim payı — ciro payPct'i backend'in aynı
  // mantıkla (kapsamın toplamına göre) hesapladığı desenin JS karşılığı.
  const toplamHacim = distributors.reduce((a, d) => a + d.hacim, 0);
  const withDisplay = distributors.map((d) => ({
    ...d,
    displayVal: useVolume ? d.hacim : d.ciro,
    displayPay: useVolume ? (toplamHacim > 0 ? (d.hacim / toplamHacim) * 100 : 0) : d.payPct,
  }));
  const visible = limit === 0 ? withDisplay : withDisplay.slice(0, limit);
  const cumulative = visible.reduce((a, d) => a + d.displayPay, 0);

  if (isHidden("panel.yonetim.topdist")) return null;

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">
            {t("panel.yonetim.topdist.title", translate(locale, "panel.yonetim.topdist", "Top Distribütör Analizi"))}
          </div>
          <div className="v3-panel-sub">
            {locale === "en" ? (
              <>
                {period} net {useVolume ? "volume" : "revenue"} · Top {visible.length} distributors carry
                <strong> %{cumulative.toFixed(1)}</strong> of total {useVolume ? "volume" : "revenue"}
              </>
            ) : (
              <>
                {period} net {useVolume ? "hacim" : "ciro"} · İlk {visible.length} distribütör toplam {useVolume ? "hacmin" : "cironun"}
                <strong> %{cumulative.toFixed(1)}</strong>'ini taşıyor
              </>
            )}
          </div>
        </div>
        <div className="v3-toggle">
          {([10, 20, 0] as Limit[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setLimit(n)}
              className={limit === n ? "active" : ""}
              aria-pressed={limit === n}
            >
              {n === 0 ? (locale === "en" ? "All" : "Tümü") : `Top ${n}`}
            </button>
          ))}
        </div>
      </div>

      <div className="v3-table-wrap">
        <table className="v3-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>{translate(locale, "col.distributor", "Distribütör")}</th>
              <th>{translate(locale, "col.bolge", "Bölge")}</th>
              <th className="num">
                {useVolume
                  ? locale === "en"
                    ? "Volume (30d)"
                    : "Hacim (30g)"
                  : locale === "en"
                    ? "Revenue (30d)"
                    : "Ciro (30g)"}
              </th>
              <th className="num">{locale === "en" ? "Active Customers" : "Aktif Müşteri"}</th>
              <th className="num">FKMS</th>
              <th className="num">{translate(locale, "col.kapsama", "Kapsam")}</th>
              <th className="num">{translate(locale, "col.pay", "Pay")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.id}>
                <td className="rank">{d.rank}</td>
                <td className="unvan" title={d.ad}>
                  {d.ad.length > 50 ? d.ad.slice(0, 47) + "…" : d.ad}
                </td>
                <td>{d.bolge || "—"}</td>
                <td className="num">
                  {useVolume ? `${formatCompact(d.displayVal)} ${volumeShort}` : `₺${formatCompact(d.displayVal)}`}
                </td>
                <td className="num">{d.aktifMusteriSayi.toLocaleString("tr-TR")}</td>
                <td className="num">{d.fkms.toLocaleString("tr-TR")}</td>
                <td className="num kapsam">%{d.kapsamPct.toFixed(1)}</td>
                <td className="num pay">
                  <span className="pay-bar" style={{ width: `${Math.min(d.displayPay * 4, 100)}%` }} />
                  <span className="pay-val">%{d.displayPay.toFixed(1)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
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
        .v3-toggle {
          display: inline-flex;
          gap: 2px;
          padding: 2px;
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
          border-radius: 7px;
        }
        .v3-toggle button {
          padding: 5px 12px;
          border: 0;
          background: transparent;
          font-size: 11.5px;
          font-weight: 500;
          color: var(--color-muted);
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.12s;
        }
        .v3-toggle button:hover {
          color: var(--color-fg);
        }
        .v3-toggle button.active {
          background: var(--color-surface);
          color: var(--color-fg);
          font-weight: 600;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .v3-table-wrap {
          overflow-x: auto;
          margin: 0 -4px;
        }
        .v3-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
          min-width: 720px;
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
        }
        .v3-table thead th.num {
          text-align: right;
        }
        .v3-table tbody tr {
          border-bottom: 1px solid var(--color-border);
        }
        .v3-table tbody tr:hover {
          background: var(--color-surface-2);
        }
        .v3-table td {
          padding: 9px 10px;
          color: var(--color-fg);
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
        .v3-table td.kapsam {
          color: var(--color-fg-2);
          font-weight: 500;
        }
        .v3-table td.pay {
          position: relative;
          min-width: 90px;
        }
        .pay-bar {
          position: absolute;
          left: 10px;
          right: auto;
          top: 50%;
          transform: translateY(-50%);
          height: 4px;
          background: var(--color-accent-soft);
          border-radius: 2px;
          z-index: 0;
          opacity: 0.7;
        }
        .pay-val {
          position: relative;
          z-index: 1;
          color: var(--color-fg-2);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
