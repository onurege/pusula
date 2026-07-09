import { Fragment } from "react";
import { formatCompact } from "@/components/komuta/format";

/**
 * Cross-segment heatmap: Müşteri Tipi × Marka.
 *
 * Tasarım /komuta'daki "Bölge × Ürün Grubu" heatmap'iyle birebir aynı:
 * grid layout, yatay sütun başlıkları (truncate'li), row label + alt etiket,
 * renkli hücreler + sağ "Tip Ort." sütunu. Renk paleti payPct'ye göre bucket
 * (0/flat/warm/hot/fire) — komuta YoY paletinden farklı çünkü bu metrik
 * tek yönlü (tüm değerler ≥ 0).
 *
 * Stratejik markalar sütun başlığında nokta ile işaretlenir.
 */
export type SegmentBrandCell = {
  tipKod: string;
  tipAd: string;
  marka: string;
  markaKod: string;
  ciro: number;
  payPct: number;
  isStratejik: boolean;
};

function payBucket(payPct: number): "empty" | "flat" | "warm" | "hot" | "fire" {
  if (payPct <= 0) return "empty";
  if (payPct < 1) return "flat";
  if (payPct < 3) return "warm";
  if (payPct < 7) return "hot";
  return "fire";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function SegmentBrandCrossPanel({
  data,
}: {
  data: {
    tipler: string[];
    markalar: string[];
    cells: SegmentBrandCell[];
  };
}) {
  const { tipler, markalar, cells } = data;
  const hasData = tipler.length > 0 && markalar.length > 0;

  // Hücre lookup için map.
  const cellMap = new Map<string, SegmentBrandCell>();
  for (const c of cells) {
    cellMap.set(`${c.tipAd}|${c.marka}`, c);
  }

  // Stratejik marka kontrolü için flat set.
  const stratejikMarkalar = new Set(
    cells.filter((c) => c.isStratejik).map((c) => c.marka),
  );

  // Her tip için satır ortalaması (sadece dolu hücreler).
  function rowAvg(tip: string): number | null {
    const vals = markalar
      .map((m) => cellMap.get(`${tip}|${m}`)?.payPct ?? 0)
      .filter((p) => p > 0);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  return (
    <div className="v3-panel cross-panel">
      <div className="cross-head">
        <div className="cross-title">Müşteri Tipi × Marka</div>
        <div className="cross-sub">
          Son 30g ciro payı (%) · {tipler.length}×{markalar.length} grid · stratejik markalar
          {" "}<span className="strat-dot" /> noktalı
        </div>
      </div>

      {!hasData ? (
        <div className="cross-empty">Cross-segment verisi alınamadı.</div>
      ) : (
        <div
          className="x-grid"
          style={{
            gridTemplateColumns: `minmax(120px, 1.2fr) repeat(${markalar.length}, minmax(56px, 1fr)) minmax(72px, 0.9fr)`,
          }}
        >
          {/* Başlık satırı */}
          <div className="x-head">Müşteri Tipi</div>
          {markalar.map((m) => (
            <div key={m} className="x-head" title={m}>
              {stratejikMarkalar.has(m) && <span className="strat-dot" />}
              {truncate(m, 12)}
            </div>
          ))}
          <div className="x-head right">Tip Ort.</div>

          {/* Veri satırları */}
          {tipler.map((tip) => {
            const avg = rowAvg(tip);
            return (
              <Fragment key={tip}>
                <div className="x-region" title={tip}>
                  {tip}
                </div>
                {markalar.map((m) => {
                  const c = cellMap.get(`${tip}|${m}`);
                  const pay = c?.payPct ?? 0;
                  const ciro = c?.ciro ?? 0;
                  const bucket = payBucket(pay);
                  return (
                    <div
                      key={m}
                      className={`x-cell ${bucket}`}
                      title={`${tip} × ${m}\nCiro: ₺${formatCompact(ciro)}\nPay: %${pay.toFixed(2)}`}
                    >
                      {pay > 0.3 ? `%${pay.toFixed(1)}` : ""}
                    </div>
                  );
                })}
                <div className="x-avg">
                  {avg == null ? "—" : `%${avg.toFixed(1)}`}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cross-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .cross-head { display: flex; flex-direction: column; gap: 2px; }
        .cross-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .cross-sub { font-size: 11.5px; color: var(--color-muted); display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .strat-dot { display: inline-block; width: 7px; height: 7px; background: var(--color-accent); border-radius: 50%; flex-shrink: 0; }
        .cross-empty { font-size: 12px; color: var(--color-muted); padding: 18px 0; text-align: center; }

        .x-grid { display: grid; gap: 4px; font-size: 11px; min-width: 720px; }
        .x-grid .x-head {
          display: flex; align-items: center; justify-content: center;
          gap: 4px;
          text-align: center; padding: 6px 4px;
          font-size: 10px; color: var(--color-muted);
          text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
          border-bottom: 1px solid var(--color-border);
          min-height: 32px;
        }
        .x-grid .x-head.right { justify-content: flex-end; padding-right: 8px; }

        .x-grid .x-region {
          display: flex; align-items: center;
          padding: 6px 10px; min-height: 44px;
          color: var(--color-fg); font-weight: 600; font-size: 11.5px;
          border-bottom: 1px solid var(--color-border);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .x-grid .x-cell {
          display: flex; align-items: center; justify-content: center;
          padding: 6px 4px; min-height: 44px;
          text-align: center; font-feature-settings: "tnum";
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          border-bottom: 1px solid var(--color-border);
          border-radius: 4px;
        }
        /* Pay yoğunluğu paletindeki 4 ton — komuta'daki kırmızı/yeşil bipolar
           yerine, tek yönlü mavi (accent) intensity gradient. */
        .x-grid .x-cell.empty { background: var(--color-surface-2, #f5f5f4); color: var(--color-muted-2, #a8a29e); }
        .x-grid .x-cell.flat  { background: rgba(99, 102, 241, 0.08); color: var(--color-fg); }
        .x-grid .x-cell.warm  { background: rgba(99, 102, 241, 0.20); color: #312e81; }
        .x-grid .x-cell.hot   { background: rgba(99, 102, 241, 0.42); color: #ffffff; }
        .x-grid .x-cell.fire  { background: rgba(79, 70, 229, 0.72); color: #ffffff; }

        .x-grid .x-avg {
          display: flex; align-items: center; justify-content: center;
          padding: 6px 4px; min-height: 44px;
          text-align: center; font-feature-settings: "tnum";
          font-variant-numeric: tabular-nums;
          color: var(--color-accent, #6366f1); font-weight: 700; font-size: 11.5px;
          border-bottom: 1px solid var(--color-border);
          border-radius: 4px;
          background: var(--color-surface-2, #fafaf9);
        }

        /* Dark mode override — komuta paletiyle hizalı */
        :root[data-theme="dark"] .x-grid .x-cell.empty { background: rgba(255,255,255,0.04); color: var(--color-muted-2, #71717a); }
        :root[data-theme="dark"] .x-grid .x-cell.flat  { background: rgba(129, 140, 248, 0.12); }
        :root[data-theme="dark"] .x-grid .x-cell.warm  { background: rgba(129, 140, 248, 0.25); color: #e0e7ff; }
        :root[data-theme="dark"] .x-grid .x-cell.hot   { background: rgba(99, 102, 241, 0.55); color: #ffffff; }
        :root[data-theme="dark"] .x-grid .x-cell.fire  { background: rgba(67, 56, 202, 0.85); color: #ffffff; }
        :root[data-theme="dark"] .x-grid .x-avg { background: rgba(255,255,255,0.03); }
      `,
        }}
      />
    </div>
  );
}
