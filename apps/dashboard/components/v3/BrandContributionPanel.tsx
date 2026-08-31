import type { WietnauerBrandContribution } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";

/**
 * Marka katkı paneli — Wietnauer Yönetim Kurulu dashboard'unun ana
 * narrative'i. Stratejik markalar (tenant config'inden) yıldızlı + accent
 * renkle ayrıştırılır; bar chart yatay görselleştirme.
 *
 * Backend Top 50 marka döner, panelde Top 15 gösterilir. Stratejik markalar
 * stratejik olmayanlardan önce gelecek şekilde değil — gerçek ciro sırasına
 * göre listelenir; "stratejik" işareti vurgu için. Top 5 stratejik markanın
 * toplam payı üst-banner'da öne çıkarılır.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function BrandContributionPanel({
  brands,
}: {
  brands: WietnauerBrandContribution[];
}) {
  if (panelHidden("panel.yonetim.brands")) return null;
  const visible = brands.slice(0, 15);
  const maxCiro = Math.max(1, ...visible.map((b) => b.ciro));
  const stratPayToplam = brands
    .filter((b) => b.isStratejik)
    .reduce((a, b) => a + b.payPct, 0);
  const stratList = brands.filter((b) => b.isStratejik);

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.yonetim.brands", "Marka Katkıları")}</div>
          <div className="v3-panel-sub">
            Son 30g · Net ciro sıralaması ·{" "}
            {stratList.length > 0 ? (
              <>
                <span className="strat-dot" /> {stratList.length} stratejik
                marka portföyün <strong>%{stratPayToplam.toFixed(1)}</strong>
                'sini taşıyor
              </>
            ) : (
              "stratejik marka tanımı yok"
            )}
          </div>
        </div>
      </div>

      <div className="v3-bars">
        {visible.map((b) => (
          <div key={b.markaKod} className={`bar-row ${b.isStratejik ? "strat" : ""}`}>
            <div className="bar-label" title={b.marka}>
              {b.isStratejik && <span className="strat-dot" />}
              <span className="bar-rank">#{b.rank}</span>
              <span className="bar-name">{b.marka}</span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(b.ciro / maxCiro) * 100}%` }}
              />
            </div>
            <div className="bar-meta">
              <span className="bar-val">₺{formatCompact(b.ciro)}</span>
              <span className="bar-pay">%{b.payPct.toFixed(1)}</span>
              <span className="bar-cust">
                {b.musteriSayi.toLocaleString("tr-TR")}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="v3-bars-legend">
        <span><span className="strat-dot" /> stratejik marka</span>
        <span className="sep">·</span>
        <span>net ciro</span>
        <span className="sep">·</span>
        <span>portföy payı</span>
        <span className="sep">·</span>
        <span>distinct müşteri</span>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; display: inline-flex; align-items: center; gap: 4px; }
        .strat-dot { display: inline-block; width: 8px; height: 8px; background: var(--color-accent); border-radius: 50%; flex-shrink: 0; }
        .v3-bars { display: flex; flex-direction: column; gap: 5px; }
        .bar-row { display: grid; grid-template-columns: 200px 1fr 200px; align-items: center; gap: 12px; padding: 6px 0; font-size: 12.5px; }
        .bar-row:hover { background: var(--color-surface-2); margin: 0 -8px; padding: 6px 8px; border-radius: 6px; }
        .bar-row.strat .bar-fill { background: var(--color-accent); }
        .bar-label { display: inline-flex; align-items: center; gap: 6px; overflow: hidden; }
        .bar-rank { font-size: 10.5px; color: var(--color-muted-2); font-variant-numeric: tabular-nums; font-weight: 500; min-width: 22px; }
        .bar-name { font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar-track { height: 18px; background: var(--color-surface-2); border-radius: 4px; overflow: hidden; position: relative; }
        .bar-fill { height: 100%; background: var(--color-muted-2); border-radius: 4px; opacity: 0.75; transition: width 0.3s ease-out; }
        .bar-meta { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 10px; font-variant-numeric: tabular-nums; }
        .bar-val { color: var(--color-fg); font-weight: 600; min-width: 70px; text-align: right; }
        .bar-pay { color: var(--color-muted); font-size: 11.5px; min-width: 42px; text-align: right; }
        .bar-cust { color: var(--color-muted-2); font-size: 11.5px; min-width: 56px; text-align: right; }
        .v3-bars-legend { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--color-border); font-size: 11px; color: var(--color-muted-2); display: inline-flex; align-items: center; gap: 8px; }
        .v3-bars-legend .sep { opacity: 0.4; }
      `,
        }}
      />
    </div>
  );
}
