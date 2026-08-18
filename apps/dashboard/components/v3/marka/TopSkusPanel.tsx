import { formatCompact } from "@/components/komuta/format";
import type { TopSkuRow } from "./types";

/**
 * Dashboard #4 — Panel B: Top 10 SKU.
 *
 * TBLURUN seviyesinde son 30g ciro şampiyonları. Marka chip ile birlikte
 * gösterilir; stratejik marka SKU'ları accent vurgusu alır.
 */
export function TopSkusPanel({ rows }: { rows: TopSkuRow[] }) {
  // "Diğer" ve dip toplam satırları pay yüzdesi toplamına dahil edilmez.
  const skuRows = rows.filter((r) => !r.isOther && !r.isTotal);
  const top10Pay = skuRows.reduce((a, r) => a + r.payPct, 0);

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Top 10 SKU</div>
          <div className="v3-panel-sub">
            Son 30g net ciro · İlk 10 ürün portföyün
            <strong> %{top10Pay.toFixed(1)}</strong>'ini taşıyor
          </div>
        </div>
      </div>

      <div className="v3-table-wrap">
        <table className="v3-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>SKU</th>
              <th>Marka</th>
              <th className="num">Ciro (30g)</th>
              <th className="num">Miktar</th>
              <th className="num">Müşteri</th>
              <th className="num">Pay</th>
            </tr>
          </thead>
          <tbody>
            {skuRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  Son 30 günde SKU verisi yok.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const special = r.isOther || r.isTotal;
                const rowClass = r.isTotal ? "total-row" : r.isOther ? "other-row" : "";
                return (
                  <tr key={r.urunKod} className={rowClass}>
                    <td className="rank">{special ? "" : r.rank}</td>
                    <td className="ad" title={r.ad}>
                      {r.ad.length > 60 ? r.ad.slice(0, 57) + "…" : r.ad}
                    </td>
                    <td>
                      {special ? null : (
                        <span
                          className={`brand-chip ${r.isStratejik ? "strat" : ""}`}
                          title={r.isStratejik ? "Stratejik marka" : undefined}
                        >
                          {r.isStratejik && <span className="strat-dot" />}
                          {r.marka || "—"}
                        </span>
                      )}
                    </td>
                    <td className="num">₺{formatCompact(r.ciro)}</td>
                    <td className="num">
                      {r.miktar.toLocaleString("tr-TR", {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="num">
                      {r.musteriSayi.toLocaleString("tr-TR")}
                    </td>
                    <td className="num pay">
                      {!r.isTotal && (
                        <span
                          className="pay-bar"
                          style={{ width: `${Math.min(r.payPct * 12, 100)}%` }}
                        />
                      )}
                      <span className="pay-val">%{r.payPct.toFixed(2)}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .v3-table-wrap { overflow-x: auto; margin: 0 -4px; }
        .v3-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 720px; }
        .v3-table thead th { text-align: left; padding: 8px 10px; font-size: 10.5px; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--color-border); }
        .v3-table thead th.num { text-align: right; }
        .v3-table tbody tr { border-bottom: 1px solid var(--color-border); }
        .v3-table tbody tr:hover { background: var(--color-surface-2); }
        .v3-table td { padding: 9px 10px; color: var(--color-fg); }
        .v3-table td.rank { font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; width: 30px; }
        .v3-table td.ad { font-weight: 500; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .v3-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .v3-table td.empty { text-align: center; color: var(--color-muted); padding: 24px; }
        .v3-table tbody tr.other-row td { font-style: italic; color: var(--color-muted); border-top: 1px solid var(--color-border); }
        .v3-table tbody tr.other-row:hover { background: transparent; }
        .v3-table tbody tr.total-row td { font-weight: 700; color: var(--color-fg); border-top: 2px solid var(--color-fg); }
        .v3-table tbody tr.total-row:hover { background: transparent; }
        .v3-table td.pay { position: relative; min-width: 90px; }
        .pay-bar { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); height: 4px; background: var(--color-accent-soft); border-radius: 2px; z-index: 0; opacity: 0.7; }
        .pay-val { position: relative; z-index: 1; color: var(--color-fg-2); font-weight: 500; }
        .brand-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; font-size: 11px; font-weight: 500; color: var(--color-fg-2); }
        .brand-chip.strat { background: var(--color-accent-soft, rgba(159, 225, 203, 0.18)); border-color: var(--color-accent); color: var(--color-fg); }
        .strat-dot { display: inline-block; width: 6px; height: 6px; background: var(--color-accent); border-radius: 50%; }
      `,
        }}
      />
    </div>
  );
}
