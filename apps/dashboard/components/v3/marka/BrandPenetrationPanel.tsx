import type { BrandPenetrationRow } from "./types";

/**
 * Dashboard #4 — Panel C: Marka Penetrasyon.
 *
 * Markanın "kaç farklı müşteri tarafından alındığı" oranı — sahaya yayılım
 * göstergesi. Ciro büyükse penetrasyon düşük olabilir (az müşteri, yüksek
 * ciro = konsantrasyon riski); ciro düşükken yüksek penetrasyon "yaygın ama
 * az satıyor" (geliştirilebilir hacim) anlamına gelir.
 *
 * Pastel YoY paleti: bar yatay horizontal bar; en yüksek penetrasyon en
 * üstte.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function BrandPenetrationPanel({
  rows,
  aktifMusteriToplam,
}: {
  rows: BrandPenetrationRow[];
  aktifMusteriToplam: number;
}) {
  if (panelHidden("panel.marka.penetration")) return null;
  // Core zaten Top 15 + "Diğer" + referans toplam döndürüyor — ekstra slice YOK.
  const dataRows = rows.filter((r) => !r.isOther && !r.isTotal);
  const hasData = dataRows.length > 0;
  const maxPen = Math.max(1, ...dataRows.map((r) => r.penetrasyonPct));

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.marka.penetration", "Marka Penetrasyonu")}</div>
          <div className="v3-panel-sub">
            Son 30g aktif portföy:{" "}
            <strong>{aktifMusteriToplam.toLocaleString("tr-TR")}</strong>{" "}
            müşteri · Markaların portföye yayılım oranı
          </div>
        </div>
      </div>

      <div className="pen-bars">
        {!hasData && (
          <div className="empty">Son 30 günde marka penetrasyon verisi yok.</div>
        )}
        {hasData &&
          rows.map((r) => {
            const kind = r.isTotal ? "total" : r.isOther ? "other" : r.isStratejik ? "strat" : "";
            return (
              <div key={r.markaKod || r.marka} className={`pen-row ${kind}`}>
                <div className="pen-name" title={r.marka}>
                  {!r.isOther && !r.isTotal && r.isStratejik && <span className="strat-dot" />}
                  {!r.isOther && !r.isTotal && <span className="pen-rank">#{r.rank}</span>}
                  {r.marka}
                </div>
                <div className="pen-track">
                  {!r.isTotal && (
                    <div
                      className="pen-fill"
                      style={{ width: `${Math.min((r.penetrasyonPct / maxPen) * 100, 100)}%` }}
                    />
                  )}
                  <span className="pen-pct">%{r.penetrasyonPct.toFixed(1)}</span>
                </div>
                <div className="pen-count">
                  {r.musteriSayi.toLocaleString("tr-TR")} /{" "}
                  {aktifMusteriToplam.toLocaleString("tr-TR")}
                </div>
              </div>
            );
          })}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .pen-bars { display: flex; flex-direction: column; gap: 6px; }
        .pen-row { display: grid; grid-template-columns: 200px 1fr 160px; align-items: center; gap: 12px; font-size: 12.5px; padding: 5px 0; }
        .pen-row.strat .pen-fill { background: var(--color-accent); opacity: 0.85; }
        .pen-row.other { border-top: 1px solid var(--color-border); }
        .pen-row.other .pen-name { font-style: italic; color: var(--color-muted); }
        .pen-row.other .pen-fill { opacity: 0.4; }
        .pen-row.total { border-top: 2px solid var(--color-fg); margin-top: 2px; }
        .pen-row.total .pen-name { font-weight: 700; color: var(--color-fg); }
        .pen-row.total .pen-count { color: var(--color-fg); font-weight: 600; }
        .pen-row.total .pen-track { background: transparent; }
        .pen-name { display: inline-flex; align-items: center; gap: 6px; color: var(--color-fg); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pen-rank { font-size: 10.5px; color: var(--color-muted-2); font-variant-numeric: tabular-nums; min-width: 22px; }
        .pen-track { position: relative; height: 22px; background: var(--color-surface-2); border-radius: 4px; overflow: hidden; }
        .pen-fill { height: 100%; background: #9FE1CB; border-radius: 4px; opacity: 0.7; transition: width 0.3s ease-out; }
        .pen-pct { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 11.5px; color: var(--color-fg); font-variant-numeric: tabular-nums; font-weight: 600; }
        .pen-count { text-align: right; color: var(--color-muted-2); font-size: 11px; font-variant-numeric: tabular-nums; }
        .strat-dot { display: inline-block; width: 8px; height: 8px; background: var(--color-accent); border-radius: 50%; }
        .empty { padding: 20px; text-align: center; color: var(--color-muted); font-size: 12.5px; }
      `,
        }}
      />
    </div>
  );
}
