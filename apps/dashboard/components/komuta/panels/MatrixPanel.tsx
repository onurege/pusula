import type { KomutaMatrixRow, ProductTier, ValueUnit } from "@/lib/api";
import { InfoHint } from "../InfoHint";
import { Val, truncate, trendEmoji } from "../format";

function TierBadge({ tier }: { tier: ProductTier }) {
  if (tier === "value") return null;
  const label = tier === "luxury" ? "LUX" : tier === "premium" ? "PREM" : "CORE";
  return <span className={`tier-badge tier-${tier}`}>{label}</span>;
}

export function MatrixPanel({
  matrix,
  unit = "tl",
}: {
  matrix: KomutaMatrixRow[];
  unit?: ValueUnit;
}) {
  return (
    <div className="panel matrix-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">📋</span> Ürün Grubu × Dönem · Net Ciro Karşılaştırma
          <InfoHint
            title="Matrix hesaplaması"
            source="TBLMSDFATURA × TBLMSDBELGEDETAY × TBLURUN × TBLURUNGRUP"
            window="5 dönem: bu ay, geçen ay, 3 ay önce, geçen yıl aynı ay, 2 yıl önce aynı ay"
            base="SUM(DBLNETFIYAT) detay-bazlı + PeriodScales ile fatura tabanına normalize"
            notes={[
              "Detay ciro fatura toplamından ~%5-15 farklı; her dönem için fatura/detay oranı (PeriodScales) hesaplanıp çarpılır",
              "TBLURUNGRUP join'inde LNGDISTKOD=u.LNGDISTKOD ekleme yapma (her ikisi NULL→JOIN boşalır)",
              "Reel TL modunda her dönem TÜFE multiplier'ı uygulanır",
            ]}
          />
        </div>
        <div className="panel-meta">Top 8 grup</div>
      </div>
      {matrix.length === 0 ? (
        <div className="empty-note">Ürün grubu verisi yok.</div>
      ) : (
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Ürün Grubu</th>
              <th className="current">Bu Ay<span className="sub">son 30g</span></th>
              <th>Geçen Ay<span className="sub">30-60g</span></th>
              <th>3 Ay Önce<span className="sub">90-120g</span></th>
              <th>Geçen Yıl<span className="sub">~365g</span></th>
              <th>2 Yıl Önce<span className="sub">~730g</span></th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.grup}>
                <td title={row.grup}>
                  {truncate(row.grup, 28)}
                  <TierBadge tier={row.tier} />
                </td>
                <td className="matrix-cell-current"><Val n={row.buAy} unit={unit} /></td>
                <td><Val n={row.gecenAy} unit={unit} /></td>
                <td><Val n={row.ucAyOnce} unit={unit} /></td>
                <td>
                  <Val n={row.gecenYil} unit={unit} />
                  {row.yoyPct != null && (
                    <span className={`delta-pill ${row.yoyPct >= 0 ? "up" : "down"}`}>
                      {row.yoyPct >= 0 ? "+" : ""}%{row.yoyPct.toFixed(0)}
                    </span>
                  )}
                </td>
                <td><Val n={row.ikiYilOnce} unit={unit} /></td>
                <td>{trendEmoji(row.trend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
