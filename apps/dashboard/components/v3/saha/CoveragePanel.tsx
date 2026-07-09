import type { WietnauerSahaSnapshot } from "@/lib/api";

/**
 * Panel B — Aktif müşteri kapsama oranı + segment kırılımı.
 *
 * Aktif = son 90g'de fatura kesilmiş müşteri.
 * Kapsanan = son 30g'de ziyaret edilmiş müşteri.
 *
 * SVG donut + segment listesi. Wietnauer'da segment kaynağı
 * TBLMUSTERIEKSAHA(LNGEKSAHAKODU=8) — şu an iki seçenek tanımlı
 * (OFF-TRADE WHITE OUTLET, OFF-TRADE YATIRIMLI), kalan müşteriler
 * "(Tanımsız)" altında.
 */
export function CoveragePanel({
  coverage,
}: {
  coverage: WietnauerSahaSnapshot["coverage"];
}) {
  const pct = Math.max(0, Math.min(100, coverage.kapsamaPct));
  // Donut: 100×100 viewBox, radius 40, strokeWidth 14.
  const r = 40;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const tone =
    pct >= 60
      ? "var(--color-good, #16a34a)"
      : pct >= 35
        ? "var(--color-accent, #9FE1CB)"
        : "var(--color-bad, #dc2626)";

  const maxSegAktif = Math.max(1, ...coverage.segments.map((s) => s.aktif));

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Aktif Müşteri Kapsama</div>
          <div className="v3-panel-sub">
            Son 30g'de ziyaret edilen / son 90g'de aktif (fatura kesilmiş)
            müşteri.
          </div>
        </div>
      </div>

      <div className="cov-grid">
        <div className="cov-donut-wrap">
          <svg viewBox="0 0 100 100" className="cov-donut">
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="var(--color-surface-2)"
              strokeWidth="14"
            />
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={tone}
              strokeWidth="14"
              strokeDasharray={`${dash} ${c}`}
              strokeDashoffset={c / 4}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
            <text
              x="50"
              y="48"
              textAnchor="middle"
              className="cov-donut-pct"
              style={{ fill: "var(--color-fg)" }}
            >
              %{pct.toFixed(1)}
            </text>
            <text
              x="50"
              y="60"
              textAnchor="middle"
              className="cov-donut-sub"
              style={{ fill: "var(--color-muted)" }}
            >
              kapsama
            </text>
          </svg>
          <div className="cov-totals">
            <div>
              <span className="num">
                {coverage.totalZiyaretEdilen.toLocaleString("tr-TR")}
              </span>
              <span className="lbl">ziyaret edilen (30g)</span>
            </div>
            <div>
              <span className="num">
                {coverage.totalAktif.toLocaleString("tr-TR")}
              </span>
              <span className="lbl">aktif portföy (90g)</span>
            </div>
          </div>
        </div>

        <div className="cov-segments">
          <div className="cov-seg-head">
            <span>Segment</span>
            <span className="num">Aktif</span>
            <span className="num">Ziyaret</span>
            <span className="num">Kapsama</span>
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
              <div className="cov-seg-track">
                <div
                  className="cov-seg-track-aktif"
                  style={{ width: `${(s.aktif / maxSegAktif) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {coverage.segments.length === 0 && (
            <div className="cov-empty">Segment verisi yok.</div>
          )}
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cov-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
        }
        @media (min-width: 720px) {
          .cov-grid { grid-template-columns: 220px 1fr; align-items: start; }
        }
        .cov-donut-wrap {
          display: flex;
          flex-direction: column;
          gap: 12px;
          align-items: center;
        }
        .cov-donut {
          width: 180px;
          height: 180px;
        }
        .cov-donut-pct {
          font-size: 13px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .cov-donut-sub {
          font-size: 5.5px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .cov-totals {
          display: flex;
          flex-direction: column;
          gap: 6px;
          text-align: center;
        }
        .cov-totals .num {
          font-size: 16px;
          font-weight: 700;
          color: var(--color-fg);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
          margin-right: 6px;
        }
        .cov-totals .lbl {
          font-size: 11px;
          color: var(--color-muted);
        }
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
