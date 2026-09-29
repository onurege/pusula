import type { WietnauerSahaSnapshot } from "@/lib/api";

/**
 * Panel B — Aktif müşteri kapsama oranı + segment kırılımı.
 *
 * Aktif = seçili dönemde (yoksa son 30g) fatura kesilmiş müşteri.
 * Kapsanan = AYNI dönemde aktif olan VE ayrıca ziyaret edilmiş müşteri
 * (aktif ∩ ziyaret kesişimi) — bu yüzden kapsamaPct her zaman ≤%100'dür.
 *
 * SVG donut + segment listesi. Segment kaynağı tenant-konfigüre müşteri
 * kırılımı (getCustomerBreakdownMeta — Wietnauer'da birleşik ek saha Saha1+2),
 * kırılımı olmayan müşteriler "(Tanımsız)" altında. Pencere: seçili dönem.
 */
import { panelTitle, panelHidden } from "@/lib/content";
import { t, type Locale } from "@/lib/i18n";

export function CoveragePanel({
  coverage,
  locale = "tr",
}: {
  coverage: WietnauerSahaSnapshot["coverage"];
  locale?: Locale;
}) {
  if (panelHidden("panel.saha.coverage")) return null;
  const pct = Math.max(0, Math.min(100, coverage.kapsamaPct));
  const tone =
    pct >= 60
      ? "var(--color-good, #16a34a)"
      : pct >= 35
        ? "var(--color-accent, #9FE1CB)"
        : "var(--color-bad, #dc2626)";

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.saha.coverage", t(locale, "panel.saha.coverage", "Aktif Müşteri Kapsama"))}</div>
          <div className="v3-panel-sub">
            {locale === "en" ? (
              <>
                Share of active (invoiced) customers also visited in the
                selected period · by customer breakdown{" "}
                {coverage.segments.length > 0 ? `(${coverage.segments.length} breakdowns)` : ""}
              </>
            ) : (
              <>
                Seçili dönemde aktif (fatura kesilmiş) müşterilerden ziyaret de
                edilenlerin oranı · müşteri kırılımına göre{" "}
                {coverage.segments.length > 0 ? `(${coverage.segments.length} kırılım)` : ""}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="cov-segments">
        <div className="cov-seg-head">
          <span>{locale === "en" ? "Customer Breakdown" : "Müşteri Kırılımı"}</span>
          <span className="num">{locale === "en" ? "Active" : "Aktif"}</span>
          <span className="num">{locale === "en" ? "Covered" : "Kapsanan"}</span>
          <span className="num">{t(locale, "col.kapsama", "Kapsama")}</span>
        </div>
        {coverage.segments.map((s) => (
          <div key={s.segment} className="cov-seg-row">
            <div className="cov-seg-label" title={s.segment}>
              {s.segment}
            </div>
            <div className="num">{s.aktif.toLocaleString("tr-TR")}</div>
            <div className="num">
              {s.ziyaretEdilen.toLocaleString("tr-TR")}
            </div>
            <div className="cov-seg-bar-wrap">
              <span
                className="cov-seg-bar"
                style={{
                  width: `${Math.min(s.kapsamaPct, 100)}%`,
                  background:
                    s.kapsamaPct >= 60
                      ? "var(--color-good, #16a34a)"
                      : s.kapsamaPct >= 35
                        ? "#9FE1CB"
                        : "#FAC775",
                }}
              />
              <span className="cov-seg-pct">%{s.kapsamaPct.toFixed(1)}</span>
            </div>
          </div>
        ))}
        {coverage.segments.length === 0 && (
          <div className="cov-empty">{locale === "en" ? "No group breakdown data." : "Grup kırılımı verisi yok."}</div>
        )}
        {coverage.segments.length > 0 && (
          <div className="cov-seg-row cov-seg-total">
            <div className="cov-seg-label">{locale === "en" ? "TOTAL" : "TOPLAM"}</div>
            <div className="num">{coverage.totalAktif.toLocaleString("tr-TR")}</div>
            <div className="num">{coverage.totalZiyaretEdilen.toLocaleString("tr-TR")}</div>
            <div className="cov-seg-bar-wrap">
              <span className="cov-seg-bar" style={{ width: `${Math.min(pct, 100)}%`, background: tone }} />
              <span className="cov-seg-pct">%{pct.toFixed(1)}</span>
            </div>
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cov-segments {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cov-seg-head, .cov-seg-row {
          display: grid;
          grid-template-columns: 1.5fr 0.7fr 0.7fr 1.2fr;
          gap: 10px;
          padding: 6px 8px;
          align-items: center;
        }
        .cov-seg-head {
          font-size: 10px;
          color: var(--color-muted-2);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--color-border);
        }
        .cov-seg-row {
          font-size: 12px;
          color: var(--color-fg);
          border-bottom: 1px solid var(--color-border);
        }
        .cov-seg-row:last-child { border-bottom: none; }
        .cov-seg-total {
          margin-top: 4px;
          border-top: 2px solid var(--color-border);
          border-bottom: none;
          font-weight: 700;
          font-size: 12.5px;
        }
        .cov-seg-total .cov-seg-label { font-weight: 700; }
        .cov-seg-label {
          font-weight: 500;
          color: var(--color-fg);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .cov-seg-bar-wrap {
          position: relative;
          height: 16px;
          background: var(--color-surface-2);
          border-radius: 3px;
          overflow: hidden;
        }
        .cov-seg-bar {
          display: block;
          height: 100%;
          border-radius: 3px;
        }
        .cov-seg-pct {
          position: absolute;
          top: 0;
          left: 6px;
          line-height: 16px;
          font-size: 10px;
          font-weight: 600;
          color: var(--color-fg-2, var(--color-fg));
          font-variant-numeric: tabular-nums;
        }
        .cov-seg-track { display: none; }
        .cov-empty {
          padding: 16px 8px;
          font-size: 12px;
          color: var(--color-muted);
          text-align: center;
        }
      `,
        }}
      />
    </div>
  );
}
