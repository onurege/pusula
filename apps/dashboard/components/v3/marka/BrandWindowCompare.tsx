import { formatCompact } from "@/components/komuta/format";
import type { BrandWindowComparisonRow } from "./types";

/**
 * Dashboard #4 — Panel E: 30g vs 90g vs YTD karşılaştırma.
 *
 * 3 pencerede ciro + 2 ivme metriği:
 *   - son 30g'in 90g içindeki payı (%33 nötr; üstü hızlanma, altı yavaşlama)
 *   - son 30g'in YTD içindeki payı (mevsimsellik düzeltmesi)
 *
 * "Beklenen" pay sezonsallıksız durumda 30/90 = %33.3. Yeşil etiket >%40,
 * kırmızı etiket <%25.
 */
export function BrandWindowCompare({
  rows,
}: {
  rows: BrandWindowComparisonRow[];
}) {
  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">30g vs 90g vs YTD Karşılaştırma</div>
          <div className="v3-panel-sub">
            Top 10 marka · "Son 30g / 90g" oranı &gt;%33 ise hızlanıyor demek;
            &lt;%25 ise yavaşlama uyarısı.
          </div>
        </div>
      </div>

      <div className="v3-table-wrap">
        <table className="v3-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Marka</th>
              <th className="num">30g</th>
              <th className="num">90g</th>
              <th className="num">YTD</th>
              <th className="num">30g / 90g</th>
              <th className="num">30g / YTD</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  Pencere karşılaştırma verisi yok.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const tone90 =
                  r.son30Pay90Pct > 40
                    ? "good"
                    : r.son30Pay90Pct < 25
                      ? "bad"
                      : "neutral";
                return (
                  <tr
                    key={r.markaKod || r.marka}
                    className={r.isStratejik ? "strat" : ""}
                  >
                    <td className="rank">{r.rank}</td>
                    <td className="ad" title={r.marka}>
                      {r.isStratejik && <span className="strat-dot" />}
                      {r.marka}
                    </td>
                    <td className="num">₺{formatCompact(r.ciro30)}</td>
                    <td className="num muted">
                      ₺{formatCompact(r.ciro90)}
                    </td>
                    <td className="num muted">
                      ₺{formatCompact(r.ciroYtd)}
                    </td>
                    <td className={`num pill ${tone90}`}>
                      %{r.son30Pay90Pct.toFixed(1)}
                    </td>
                    <td className="num muted">
                      %{r.son30PayYtdPct.toFixed(1)}
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
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .v3-table-wrap { overflow-x: auto; margin: 0 -4px; }
        .v3-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 720px; }
        .v3-table thead th { text-align: left; padding: 8px 10px; font-size: 10.5px; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--color-border); }
        .v3-table thead th.num { text-align: right; }
        .v3-table tbody tr { border-bottom: 1px solid var(--color-border); }
        .v3-table tbody tr:hover { background: var(--color-surface-2); }
        .v3-table tbody tr.strat .ad { color: var(--color-fg); font-weight: 600; }
        .v3-table td { padding: 9px 10px; color: var(--color-fg); }
        .v3-table td.rank { font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; }
        .v3-table td.ad { font-weight: 500; display: inline-flex; align-items: center; gap: 6px; }
        .v3-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .v3-table td.muted { color: var(--color-muted); }
        .v3-table td.empty { text-align: center; color: var(--color-muted); padding: 24px; }
        .strat-dot { display: inline-block; width: 7px; height: 7px; background: var(--color-accent); border-radius: 50%; }
        .pill { font-weight: 600; }
        .pill.good { color: #16a34a; }
        .pill.bad { color: #dc2626; }
        .pill.neutral { color: var(--color-fg-2); }
      `,
        }}
      />
    </div>
  );
}
