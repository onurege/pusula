import type { KomutaPortfolioRow, ProductTier, ValueUnit } from "@/lib/api";
import { InfoHint } from "../InfoHint";
import { Val, truncate } from "../format";

function TierBadge({ tier }: { tier: ProductTier }) {
  if (tier === "value") return null;
  const label = tier === "luxury" ? "LUX" : tier === "premium" ? "PREM" : "CORE";
  return <span className={`tier-badge tier-${tier}`}>{label}</span>;
}

export function PortfolioPanel({
  portfolio,
  unit = "tl",
}: {
  portfolio: KomutaPortfolioRow[];
  unit?: ValueUnit;
}) {
  return (
    <div className="panel brand-portfolio">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🥃</span> Ürün Grubu Portföyü · 2 Yıllık Yörünge
          <InfoHint
            title="Portföy hesaplaması"
            source="TBLMSDFATURA × TBLMSDBELGEDETAY × TBLURUN × TBLURUNGRUP"
            window="3 dönem: son 30g, geçen yıl aynı 30g (-395..-365g), 2 yıl önce aynı 30g (-760..-730g)"
            base="SUM(DBLNETFIYAT) detay-bazlı + PeriodScales ile fatura tabanına normalize"
            notes={[
              "Tier sınıflandırma (luxury/premium/core/value) ürün grubu adına göre keyword eşleşmesi",
              "yoyPct = (bu − geçenYıl)/geçenYıl × 100",
              "twoYrPct = (bu − ikiYılÖnce)/ikiYılÖnce × 100",
              "Reel TL/ÖTV modunda baz değerler multiplier ile bugünün TL'sine çevrilir",
            ]}
          />
        </div>
        <div className="panel-meta">Top 10 grup</div>
      </div>
      {portfolio.length === 0 ? (
        <div className="empty-note">Portföy verisi yok.</div>
      ) : (
        <table className="bp-table">
          <thead>
            <tr>
              <th>Ürün Grubu</th>
              <th className="current">Son 30g</th>
              <th>1 yıl önce</th>
              <th>2 yıl önce</th>
              <th>YoY</th>
              <th>2-yıl Δ</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.map((p) => {
              const maxBar = Math.max(p.bu, p.oneYearAgo, p.twoYearsAgo) || 1;
              const h0 = (p.twoYearsAgo / maxBar) * 100;
              const h1 = (p.oneYearAgo / maxBar) * 100;
              const h2 = (p.bu / maxBar) * 100;
              const declining = p.yoyPct != null && p.yoyPct < 0;
              return (
                <tr key={p.grup}>
                  <td title={p.grup}>
                    {truncate(p.grup, 26)}
                    <TierBadge tier={p.tier} />
                  </td>
                  <td className="current"><Val n={p.bu} unit={unit} /></td>
                  <td className="right"><Val n={p.oneYearAgo} unit={unit} /></td>
                  <td className="right"><Val n={p.twoYearsAgo} unit={unit} /></td>
                  <td className="right">
                    {p.yoyPct == null ? (
                      "—"
                    ) : (
                      <span className={`delta-pill ${p.yoyPct >= 0 ? "up" : "down"}`}>
                        {p.yoyPct >= 0 ? "+" : ""}%{p.yoyPct.toFixed(0)}
                      </span>
                    )}
                  </td>
                  <td className="right">
                    {p.twoYrPct == null ? (
                      "—"
                    ) : (
                      <span className={`delta-pill ${p.twoYrPct >= 0 ? "up" : "down"}`}>
                        {p.twoYrPct >= 0 ? "+" : ""}%{p.twoYrPct.toFixed(0)}
                      </span>
                    )}
                  </td>
                  <td className="right">
                    <span className="bp-2yspark">
                      <span className="bar" style={{ height: `${h0}%` }} />
                      <span className="bar" style={{ height: `${h1}%` }} />
                      <span
                        className={`bar last${declining ? " declining" : ""}`}
                        style={{ height: `${h2}%` }}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
