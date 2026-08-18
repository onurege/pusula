import { formatCompact } from "@/components/komuta/format";
import type { MarkaPortfolioRow } from "./types";

/**
 * Dashboard #4 — Panel A: Marka Portföyü.
 *
 * Backend Top 20 marka, panelde Top 15 yatay bar chart. Stratejik markalar
 * accent rengiyle vurgulanır. Yönetim Kurulu'ndaki BrandContributionPanel'in
 * "fatura" sütunu eklenmiş, daha detaylı sürümü.
 */
export function BrandPortfolioPanel({
  rows,
}: {
  rows: MarkaPortfolioRow[];
}) {
  // Core zaten Top 15 + "Diğer" + dip toplam döndürüyor — burada ekstra slice YOK.
  const dataRows = rows.filter((b) => !b.isOther && !b.isTotal);
  const maxCiro = Math.max(1, ...dataRows.map((b) => b.ciro));
  const stratList = dataRows.filter((b) => b.isStratejik);
  const stratPay = stratList.reduce((a, b) => a + b.payPct, 0);

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Marka Portföyü</div>
          <div className="v3-panel-sub">
            Son 30g · Top {dataRows.length} marka net ciroya göre ·{" "}
            {stratList.length > 0 ? (
              <>
                <span className="strat-dot" /> {stratList.length} stratejik
                marka portföyün <strong>%{stratPay.toFixed(1)}</strong>
                'sini taşıyor
              </>
            ) : (
              "stratejik marka tanımı yok"
            )}
          </div>
        </div>
      </div>

      <div className="v3-bars">
        {rows.map((b) => {
          const kind = b.isTotal ? "total" : b.isOther ? "other" : b.isStratejik ? "strat" : "";
          return (
            <div key={b.markaKod || b.marka} className={`bar-row ${kind}`}>
              <div className="bar-label" title={b.marka}>
                {!b.isOther && !b.isTotal && b.isStratejik && <span className="strat-dot" />}
                {!b.isOther && !b.isTotal && <span className="bar-rank">#{b.rank}</span>}
                <span className="bar-name">{b.marka}</span>
              </div>
              <div className="bar-track">
                {!b.isTotal && (
                  <div
                    className="bar-fill"
                    style={{ width: `${Math.min((b.ciro / maxCiro) * 100, 100)}%` }}
                  />
                )}
              </div>
              <div className="bar-meta">
                <span className="bar-val">₺{formatCompact(b.ciro)}</span>
                <span className="bar-pay">%{b.payPct.toFixed(1)}</span>
                <span className="bar-cust">
                  {b.musteriSayi.toLocaleString("tr-TR")} müş
                </span>
                <span className="bar-fat">
                  {b.faturaSayisi.toLocaleString("tr-TR")} fat
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="v3-bars-legend">
        <span>
          <span className="strat-dot" /> stratejik marka
        </span>
        <span className="sep">·</span>
        <span>net ciro</span>
        <span className="sep">·</span>
        <span>portföy payı</span>
        <span className="sep">·</span>
        <span>distinct müşteri</span>
        <span className="sep">·</span>
        <span>fatura sayısı</span>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .strat-dot { display: inline-block; width: 8px; height: 8px; background: var(--color-accent); border-radius: 50%; flex-shrink: 0; }
        .v3-bars { display: flex; flex-direction: column; gap: 5px; }
        .bar-row { display: grid; grid-template-columns: 200px 1fr 280px; align-items: center; gap: 12px; padding: 6px 0; font-size: 12.5px; }
        .bar-row:hover { background: var(--color-surface-2); margin: 0 -8px; padding: 6px 8px; border-radius: 6px; }
        .bar-row.strat .bar-fill { background: var(--color-accent); }
        .bar-row.other { border-top: 1px solid var(--color-border); }
        .bar-row.other .bar-name { font-style: italic; color: var(--color-muted); }
        .bar-row.other .bar-meta { opacity: 0.75; }
        .bar-row.other .bar-fill { background: var(--color-muted-2); opacity: 0.4; }
        .bar-row.total { border-top: 2px solid var(--color-fg); margin-top: 2px; }
        .bar-row.total .bar-name { font-weight: 700; color: var(--color-fg); }
        .bar-row.total .bar-val { font-weight: 700; color: var(--color-fg); }
        .bar-row.total .bar-pay, .bar-row.total .bar-cust, .bar-row.total .bar-fat { color: var(--color-fg); font-weight: 600; }
        .bar-label { display: inline-flex; align-items: center; gap: 6px; overflow: hidden; }
        .bar-rank { font-size: 10.5px; color: var(--color-muted-2); font-variant-numeric: tabular-nums; font-weight: 500; min-width: 22px; }
        .bar-name { font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar-track { height: 18px; background: var(--color-surface-2); border-radius: 4px; overflow: hidden; position: relative; }
        .bar-fill { height: 100%; background: var(--color-muted-2); border-radius: 4px; opacity: 0.75; transition: width 0.3s ease-out; }
        .bar-meta { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 10px; font-variant-numeric: tabular-nums; }
        .bar-val { color: var(--color-fg); font-weight: 600; min-width: 70px; text-align: right; }
        .bar-pay { color: var(--color-muted); font-size: 11.5px; min-width: 42px; text-align: right; }
        .bar-cust { color: var(--color-muted-2); font-size: 11.5px; min-width: 60px; text-align: right; }
        .bar-fat { color: var(--color-muted-2); font-size: 11.5px; min-width: 56px; text-align: right; }
        .v3-bars-legend { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--color-border); font-size: 11px; color: var(--color-muted-2); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .v3-bars-legend .sep { opacity: 0.4; }
      `,
        }}
      />
    </div>
  );
}
