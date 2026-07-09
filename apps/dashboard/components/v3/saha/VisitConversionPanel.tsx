export type ConversionRow = {
  tip: "Rut İçi" | "Rut Dışı";
  ziyaret: number;
  siparisli: number;
  faturali: number;
  irsaliyeli: number;
  donusumPct: number;
};

/**
 * Ziyaret → sipariş dönüşüm paneli. Rut içi vs rut dışı karşılaştırma.
 * Rut içi'nde dönüşüm yüksek olmalı (planlanmış nokta); rut dışı'nda
 * fırsatçı satış göstergesi.
 */
export function VisitConversionPanel({ rows }: { rows: ConversionRow[] }) {
  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Ziyaret → Sipariş Dönüşümü</div>
          <div className="v3-panel-sub">
            Son 30g · Rut içi vs Rut dışı · sipariş, fatura, irsaliye
            kırılımıyla
          </div>
        </div>
      </div>

      <div className="conv-grid">
        {rows.map((r) => {
          const color = r.tip === "Rut İçi" ? "#9FE1CB" : "#FAC775";
          const accent =
            r.donusumPct >= 70 ? "#16a34a" : r.donusumPct >= 40 ? "#78716c" : "#dc2626";
          return (
            <div key={r.tip} className="conv-card">
              <div className="conv-head">
                <span className="conv-dot" style={{ background: color }} />
                <span className="conv-title">{r.tip}</span>
              </div>
              <div className="conv-hero" style={{ color: accent }}>
                %{r.donusumPct.toFixed(1)}
              </div>
              <div className="conv-sub">dönüşüm oranı</div>
              <table className="conv-table">
                <tbody>
                  <tr>
                    <td>Ziyaret</td>
                    <td className="num">{r.ziyaret.toLocaleString("tr-TR")}</td>
                  </tr>
                  <tr>
                    <td>Siparişli</td>
                    <td className="num">{r.siparisli.toLocaleString("tr-TR")}</td>
                  </tr>
                  <tr>
                    <td>Faturalı</td>
                    <td className="num">{r.faturali.toLocaleString("tr-TR")}</td>
                  </tr>
                  <tr>
                    <td>İrsaliyeli</td>
                    <td className="num">{r.irsaliyeli.toLocaleString("tr-TR")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .conv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 600px) { .conv-grid { grid-template-columns: 1fr; } }
        .conv-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 8px; padding: 14px 16px; }
        .conv-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .conv-dot { width: 10px; height: 10px; border-radius: 50%; }
        .conv-title { font-size: 13px; font-weight: 600; color: var(--color-fg); }
        .conv-hero { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1; }
        .conv-sub { font-size: 11px; color: var(--color-muted); margin: 2px 0 10px; }
        .conv-table { width: 100%; font-size: 12px; border-collapse: collapse; }
        .conv-table td { padding: 4px 0; color: var(--color-fg-2); border-bottom: 1px dashed var(--color-border); }
        .conv-table td.num { text-align: right; font-variant-numeric: tabular-nums; color: var(--color-fg); font-weight: 500; }
      `,
        }}
      />
    </div>
  );
}
