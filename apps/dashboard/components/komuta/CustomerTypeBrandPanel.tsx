"use client";

import { Fragment, useState } from "react";
import type { KomutaCustomerTypeBrandSnapshot } from "@/lib/api";
import { formatCompact, truncate } from "@/components/komuta/format";

type Metric = "ciro" | "miktar";

/**
 * md34 — Müşteri Tipi × Marka kırılım paneli (cockpit).
 *
 * Tasarım Komuta'daki "Bölge × Ürün Grubu" heatmap'iyle aynı ızgara deseni:
 * satır = müşteri tipi, sütun = Top 8 marka + "Diğer", sağ uçta satır
 * toplamı, en alt satır (isTotal) dip toplam. Backend her hücrede hem ciro
 * hem hacim (adet) taşıdığı için Hacim/Ciro toggle'ı client-side, refetch
 * olmadan çalışır (transform-only, layout thrash yok — sadece metin/renk
 * güncellenir, grid boyutları sabit kalır).
 */
export function CustomerTypeBrandPanel({
  data,
  title = "Müşteri Tipi × Marka",
  icon = "🧭",
}: {
  data: KomutaCustomerTypeBrandSnapshot;
  title?: string;
  icon?: string;
}) {
  const [metric, setMetric] = useState<Metric>("ciro");
  const { markalar, rows } = data;
  const hasData = markalar.length > 0 && rows.length > 0;
  const unitLabel = metric === "ciro" ? "₺" : "adet";

  const rowTotal = (cells: { marka: string; ciro: number; miktar: number }[]) =>
    cells.reduce((a, c) => a + c[metric], 0);

  // Küçük veri seti (≤9 tip × ≤9 marka) — memoize etmeye gerek yok, her
  // render'da yeniden hesaplamak ölçülemeyecek kadar ucuz.
  const totalRow = rows.find((r) => r.isTotal);
  const grandTotal = totalRow ? rowTotal(totalRow.cells) : 0;

  function bucket(v: number): "empty" | "flat" | "warm" | "hot" | "fire" {
    if (grandTotal <= 0 || v <= 0) return "empty";
    const pct = (v / grandTotal) * 100;
    if (pct < 1) return "flat";
    if (pct < 3) return "warm";
    if (pct < 7) return "hot";
    return "fire";
  }

  return (
    <div className="panel ctb-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">{icon}</span> {title}
        </div>
        <div className="ctb-toggle" role="tablist" aria-label="Ölçü birimi">
          <button
            type="button"
            role="tab"
            aria-selected={metric === "ciro"}
            className={metric === "ciro" ? "on" : ""}
            onClick={() => setMetric("ciro")}
          >
            Ciro
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={metric === "miktar"}
            className={metric === "miktar" ? "on" : ""}
            onClick={() => setMetric("miktar")}
          >
            Hacim
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="empty-note">Müşteri tipi × marka verisi yok.</div>
      ) : (
        <div
          className="ctb-grid"
          style={{
            gridTemplateColumns: `minmax(120px, 1.2fr) repeat(${markalar.length}, minmax(58px, 1fr)) minmax(78px, 0.9fr)`,
          }}
        >
          <div className="ctb-head">Müşteri Tipi</div>
          {markalar.map((m) => (
            <div key={m} className="ctb-head" title={m}>
              {truncate(m, 12)}
            </div>
          ))}
          <div className="ctb-head right">Tip Toplam</div>

          {rows.map((row) => {
            const total = rowTotal(row.cells);
            const rowCls = row.isTotal ? " ctb-total-row" : "";
            return (
              <Fragment key={row.musteriTipi}>
                <div className={`ctb-region${rowCls}`} title={row.musteriTipi}>
                  {row.musteriTipi}
                </div>
                {row.cells.map((cell) => {
                  const v = cell[metric];
                  return (
                    <div
                      key={cell.marka}
                      className={`ctb-cell ${bucket(v)}${rowCls}`}
                      title={`${row.musteriTipi} × ${cell.marka}\nCiro: ${formatCompact(cell.ciro)} ₺\nHacim: ${formatCompact(cell.miktar)} adet`}
                    >
                      {v > 0 ? formatCompact(v) : ""}
                    </div>
                  );
                })}
                <div className={`ctb-rowtotal${rowCls}`}>
                  {total > 0 ? formatCompact(total) : "—"}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}

      <div className="ctb-hint">
        Son 30g · Top 8 marka (ciroya göre) + "Diğer" · birim: {unitLabel} · dip satır tüm
        müşteri tiplerinin toplamı.
      </div>

      <style jsx>{`
        .ctb-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .ctb-toggle {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 2px;
          border-radius: 8px;
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
        }
        .ctb-toggle button {
          appearance: none;
          border: none;
          background: transparent;
          color: var(--color-muted);
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
            color 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .ctb-toggle button.on {
          background: var(--color-surface);
          color: var(--color-fg);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        .ctb-toggle button:hover:not(.on) {
          color: var(--color-fg);
        }

        .ctb-grid {
          display: grid;
          gap: 4px;
          font-size: 11px;
          overflow-x: auto;
        }
        .ctb-grid .ctb-head {
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 6px 4px;
          font-size: 10px;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.4px;
          font-weight: 600;
          border-bottom: 1px solid var(--color-border);
          min-height: 32px;
        }
        .ctb-grid .ctb-head.right {
          justify-content: flex-end;
          padding-right: 8px;
        }
        .ctb-grid .ctb-region {
          display: flex;
          align-items: center;
          padding: 6px 10px;
          min-height: 40px;
          color: var(--color-fg);
          font-weight: 600;
          font-size: 11.5px;
          border-bottom: 1px solid var(--color-border);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ctb-grid .ctb-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px 4px;
          min-height: 40px;
          text-align: center;
          font-feature-settings: "tnum";
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          border-bottom: 1px solid var(--color-border);
          border-radius: 4px;
        }
        .ctb-grid .ctb-rowtotal {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 6px 8px;
          min-height: 40px;
          font-feature-settings: "tnum";
          font-variant-numeric: tabular-nums;
          color: var(--color-accent, #6366f1);
          font-weight: 700;
          font-size: 11.5px;
          border-bottom: 1px solid var(--color-border);
        }
        /* Pay yoğunluğu — tek yönlü mavi (accent) gradient (komuta heatmap'in
           bipolar kırmızı/yeşil paletinden farklı çünkü metrik tek yönlü ≥0). */
        .ctb-grid .ctb-cell.empty { color: var(--color-muted-2, #a8a29e); }
        .ctb-grid .ctb-cell.flat { background: rgba(99, 102, 241, 0.08); color: var(--color-fg); }
        .ctb-grid .ctb-cell.warm { background: rgba(99, 102, 241, 0.2); color: #312e81; }
        .ctb-grid .ctb-cell.hot { background: rgba(99, 102, 241, 0.42); color: #ffffff; }
        .ctb-grid .ctb-cell.fire { background: rgba(79, 70, 229, 0.72); color: #ffffff; }

        .ctb-grid .ctb-region.ctb-total-row,
        .ctb-grid .ctb-rowtotal.ctb-total-row {
          font-weight: 700;
          border-top: 1px solid var(--color-border-strong, var(--color-border));
          background: var(--color-surface-2);
        }
        .ctb-grid .ctb-cell.ctb-total-row {
          border-top: 1px solid var(--color-border-strong, var(--color-border));
          background: var(--color-surface-2);
          font-weight: 700;
        }

        :root[data-theme="dark"] .ctb-grid .ctb-cell.flat { background: rgba(129, 140, 248, 0.12); }
        :root[data-theme="dark"] .ctb-grid .ctb-cell.warm { background: rgba(129, 140, 248, 0.25); color: #e0e7ff; }
        :root[data-theme="dark"] .ctb-grid .ctb-cell.hot { background: rgba(99, 102, 241, 0.55); color: #ffffff; }
        :root[data-theme="dark"] .ctb-grid .ctb-cell.fire { background: rgba(67, 56, 202, 0.85); color: #ffffff; }

        .ctb-hint {
          font-size: 10.5px;
          color: var(--color-muted-2);
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
