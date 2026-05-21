import { Fragment } from "react";
import type { KomutaHeatmapRow } from "@/lib/api";
import { InfoHint } from "../InfoHint";
import { truncate } from "../format";

export function HeatmapPanel({ heatmap }: { heatmap: KomutaHeatmapRow[] }) {
  if (heatmap.length === 0) return null;
  const grupHeaders = heatmap[0]?.cells.map((c) => c.grup) ?? [];
  return (
    <div className="panel heatmap-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🔥</span> Bölge × Ürün Grubu · YoY Değişim Heatmap
          <InfoHint
            title="Heatmap YoY hesaplaması"
            source="TBLMSDFATURA × TBLMSDBELGEDETAY × TBLURUN × TBLURUNGRUP × TBLDIST × TBLDISTGRUP"
            window="Son 30g vs -395..-365g (geçen yıl aynı pencere)"
            base="SUM(DBLNETFIYAT) her bölge × her grup hücresi"
            notes={[
              "Top 8 bölge × Top 6 ürün grubu (detay ciro toplamına göre)",
              "yoyPct = (son − önceki)/önceki × 100; bucket sınıfı (fire/hot/warm/flat/cool/cold) Komuta CSS palette'i",
              "Sadece kırmızı (cool/cold) hücreler tıklanabilir → Finans Agentı modal",
            ]}
          />
        </div>
        <div className="panel-meta">Son 30g vs Geçen yıl aynı 30g</div>
      </div>
      <div
        className="heatmap-grid"
        style={{
          gridTemplateColumns: `repeat(${grupHeaders.length + 2}, 1fr)`,
        }}
      >
        <div className="h-head">Bölge</div>
        {grupHeaders.map((g) => (
          <div key={g} className="h-head" title={g}>{truncate(g, 12)}</div>
        ))}
        <div className="h-head right">Bölge Ort.</div>

        {heatmap.map((row) => (
          <Fragment key={row.bolge}>
            <div className="h-region">
              {row.bolge} <span className="reg-sub">{row.distSayisi} distribütör</span>
            </div>
            {row.cells.map((cell, i) => {
              const isAnomaly =
                (cell.bucket === "cool" || cell.bucket === "cold") &&
                cell.yoyPct != null;
              return (
                <div
                  key={i}
                  className={`h-cell ${cell.bucket}${isAnomaly ? " h-cell-clickable" : ""}`}
                  {...(isAnomaly
                    ? {
                        "data-finance-region": row.bolge,
                        "data-finance-product-group": cell.grup,
                        role: "button",
                        tabIndex: 0,
                        title: `${row.bolge} × ${cell.grup} — finans analizini aç`,
                      }
                    : {})}
                >
                  {cell.yoyPct == null ? "—" : `${cell.yoyPct >= 0 ? "+" : ""}%${cell.yoyPct.toFixed(0)}`}
                </div>
              );
            })}
            <div className="h-avg" style={row.rowAvgPct != null && row.rowAvgPct < 0 ? { color: "#dc2626" } : undefined}>
              {row.rowAvgPct == null ? "—" : `${row.rowAvgPct >= 0 ? "+" : ""}%${row.rowAvgPct.toFixed(1)}`}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
