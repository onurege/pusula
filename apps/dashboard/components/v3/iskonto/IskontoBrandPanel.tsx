import { formatCompact } from "@/components/komuta/format";

type BrandRow = {
  marka: string;
  markaKod: string;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  yoyNetPct: number | null;
  /** Madde 16 — geçen yıl AYNI dönemin iskonto oranı, yoksa null. */
  iskontoOraniPctPrevYil: number | null;
  rank: number;
  isStratejik: boolean;
};

/**
 * Panel C — Marka × İskonto Etkinliği (Top 15).
 *
 * Sıralama: brüt ciro DESC. Tablo: marka, brüt, iskonto, net, bu yıl iskonto
 * oranı, geçen yıl aynı dönemin iskonto oranı (madde 16 — yan yana, kullanıcı
 * ORAN karşılaştırması yapabilsin diye; eski "YoY Net" (net büyüme %)
 * kolonu kaldırıldı — oran karşılaştırmasıyla karışıyordu).
 *
 * Renk anlamı (iskonto/ciro %):
 *   <15%  → #16a34a sağlıklı
 *   15-25% → #d97706 nötr
 *   >25%  → #dc2626 yatırım uyarısı
 *
 * Geçen yıl oranı deltası: oran DÜŞTÜYSE (iyileşme) yeşil, ARTTIYSA
 * (kötüleşme) kırmızı, geçen yıl verisi yoksa gri "—".
 */
import { panelTitle, panelHidden } from "@/lib/content";
import { t, type Locale } from "@/lib/i18n";

export function IskontoBrandPanel({ brands, locale = "tr" }: { brands: BrandRow[]; locale?: Locale }) {
  if (panelHidden("panel.iskonto.brand")) return null;
  const stratList = brands.filter((b) => b.isStratejik);

  return (
    <div className="brand-panel">
      <div className="brand-head">
        <div>
          <div className="brand-title">{panelTitle("panel.iskonto.brand", t(locale, "panel.iskonto.brand", "Marka × İskonto Etkinliği"))}</div>
          <div className="brand-sub">
            {locale === "en"
              ? "Last 30d · Top 15 brands · Detail level (gross = unit × quantity)"
              : "Son 30g · Top 15 marka · Detay seviyesi (brüt = birim × miktar)"}
            {stratList.length > 0 && (
              <>
                {" · "}
                <span className="strat-dot" /> {stratList.length} {locale === "en" ? "strategic" : "stratejik"}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="brand-table-wrap">
        <table className="brand-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>{t(locale, "col.marka", "Marka")}</th>
              <th className="num">{locale === "en" ? "Gross" : "Brüt"}</th>
              <th className="num">{t(locale, "col.iskonto", "İskonto")}</th>
              <th className="num">{locale === "en" ? "Net" : "Net"}</th>
              <th className="num">{t(locale, "col.oran", "Oran")}</th>
              <th className="num">{t(locale, "col.oran_gecen_yil", "Geçen Yıl Oranı")}</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => {
              const oranColor =
                b.iskontoOraniPct < 15
                  ? "#16a34a"
                  : b.iskontoOraniPct < 25
                  ? "#d97706"
                  : "#dc2626";
              const delta =
                b.iskontoOraniPctPrevYil == null ? null : b.iskontoOraniPct - b.iskontoOraniPctPrevYil;
              // Oran düştüyse (delta<0) iyileşme → yeşil; arttıysa kötüleşme → kırmızı.
              const deltaColor =
                delta == null ? "var(--color-muted-2)" : delta <= 0 ? "#16a34a" : "#dc2626";
              return (
                <tr key={b.markaKod}>
                  <td className="rank">{b.rank}</td>
                  <td className="marka">
                    {b.isStratejik && <span className="strat-dot" />}
                    <span title={b.marka}>{b.marka}</span>
                  </td>
                  <td className="num">₺{formatCompact(b.brut)}</td>
                  <td className="num">₺{formatCompact(b.iskonto)}</td>
                  <td className="num">₺{formatCompact(b.net)}</td>
                  <td className="num oran" style={{ color: oranColor }}>
                    %{b.iskontoOraniPct.toFixed(1)}
                  </td>
                  <td className="num oran-prev">
                    {b.iskontoOraniPctPrevYil == null ? (
                      <span style={{ color: "var(--color-muted-2)" }}>—</span>
                    ) : (
                      <>
                        <span style={{ color: "var(--color-muted)" }}>
                          %{b.iskontoOraniPctPrevYil.toFixed(1)}
                        </span>
                        <span className="delta" style={{ color: deltaColor }}>
                          {" "}
                          ({delta! >= 0 ? "+" : ""}
                          {delta!.toFixed(1)})
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="brand-legend">
        {locale === "en" ? (
          <>
            <span style={{ color: "#16a34a" }}>● healthy &lt;15%</span>
            <span className="sep">·</span>
            <span style={{ color: "#d97706" }}>● neutral 15–25%</span>
            <span className="sep">·</span>
            <span style={{ color: "#dc2626" }}>● warning &gt;25%</span>
          </>
        ) : (
          <>
            <span style={{ color: "#16a34a" }}>● sağlıklı &lt;15%</span>
            <span className="sep">·</span>
            <span style={{ color: "#d97706" }}>● nötr 15–25%</span>
            <span className="sep">·</span>
            <span style={{ color: "#dc2626" }}>● uyarı &gt;25%</span>
          </>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .brand-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .brand-head { margin-bottom: 12px; }
        .brand-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .brand-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .strat-dot { display: inline-block; width: 8px; height: 8px; background: var(--color-accent); border-radius: 50%; margin-right: 6px; vertical-align: middle; }
        .brand-table-wrap { overflow-x: auto; margin: 0 -4px; }
        .brand-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 680px; }
        .brand-table thead th {
          text-align: left;
          padding: 8px 10px;
          font-size: 10.5px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border-bottom: 1px solid var(--color-border);
        }
        .brand-table thead th.num { text-align: right; }
        .brand-table tbody tr { border-bottom: 1px solid var(--color-border); }
        .brand-table tbody tr:hover { background: var(--color-surface-2); }
        .brand-table td { padding: 9px 10px; color: var(--color-fg); }
        .brand-table td.rank { font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; }
        .brand-table td.marka { font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .brand-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .brand-table td.oran { font-weight: 600; }
        .brand-table td.oran-prev { font-weight: 500; font-size: 12px; }
        .brand-table td.oran-prev .delta { font-weight: 600; font-size: 11.5px; }
        .brand-legend { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--color-border); font-size: 11px; color: var(--color-muted-2); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .brand-legend .sep { opacity: 0.4; }
      `,
        }}
      />
    </div>
  );
}
