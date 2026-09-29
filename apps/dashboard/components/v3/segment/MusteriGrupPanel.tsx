import { formatCompact } from "@/components/komuta/format";

/**
 * Müşteri Grubu segment paneli — TBLMUSTERI.TXTGRUPKOD × TBLMUSTERIGRUP
 * (OFF TRADE / ON TRADE / TURİZM / TEDARİKÇİ / CP&S vb.).
 *
 * 4 kırılım yan yana'nın 1. boyutu (Müşteri Grubu → Ek Saha → Ek Grup →
 * Grup Kırılımı). md10 v8'de kaynak swap'landı: bu panel artık TBLMUSTERIGRUP
 * (Müşteri Grubu) gösterir; birleşik ek saha `EkSahaPanel`'de, Prestige/Premium
 * gibi grup kırılımı ise ayrı `GrupKirilimPanel`'de.
 *
 * Sol: yatay bar — ciro payı yüzdesi (her bar normalize).
 * Sağ: müşteri sayısı, ciro, ortalama iskonto oranı sayısal kolonları.
 */
export type MusteriGrupSegmentRow = {
  kod: string;
  ad: string;
  musteriSayi: number;
  ciro: number;
  payPct: number;
  ortIskontoOraniPct: number;
};

import { panelTitle, panelHidden } from "@/lib/content";
import { t, type Locale } from "@/lib/i18n";

export function MusteriGrupPanel({ rows, locale = "tr" }: { rows: MusteriGrupSegmentRow[]; locale?: Locale }) {
  if (panelHidden("panel.segment.musterigrubu")) return null;
  const maxCiro = Math.max(1, ...rows.map((r) => r.ciro));
  const toplamMusteri = rows.reduce((a, r) => a + r.musteriSayi, 0);

  return (
    <div className="v3-panel segb-panel">
      <div className="segb-head">
        <div className="segb-title">{panelTitle("panel.segment.musterigrubu", t(locale, "panel.segment.musterigrubu", "Müşteri Grubu"))}</div>
        <div className="segb-sub">
          {locale === "en"
            ? `Customer Group (TBLMUSTERIGRUP) · ${rows.length} groups · ${toplamMusteri.toLocaleString("tr-TR")} customers`
            : `Müşteri Grubu (TBLMUSTERIGRUP) · ${rows.length} grup · ${toplamMusteri.toLocaleString("tr-TR")} müşteri`}
        </div>
      </div>

      <div className="segb-list">
        {rows.length === 0 && (
          <div className="segb-empty">{t(locale, "seg.empty", "Henüz veri yok")}</div>
        )}
        {rows.map((r) => {
          const musteriLabel = locale === "en" ? "customers" : "müşteri";
          const iskLabel = locale === "en" ? "disc." : "isk.";
          const title = `${r.ad} · ${r.musteriSayi.toLocaleString("tr-TR")} ${musteriLabel} · ₺${formatCompact(r.ciro)} · ${iskLabel} %${r.ortIskontoOraniPct.toFixed(1)}`;
          return (
            <div key={r.kod} className="segb-row" title={title}>
              <div className="segb-row-fill" style={{ width: `${maxCiro > 0 ? (r.ciro / maxCiro) * 100 : 0}%` }} />
              <div className="segb-row-content">
                <div className="segb-row-r1">
                  <span className="segb-row-label">{r.ad}</span>
                  <span className="segb-row-pay">%{r.payPct.toFixed(1)}</span>
                </div>
                <div className="segb-row-r2">
                  <span className="segb-row-ciro">₺{formatCompact(r.ciro)}</span>
                  <span className="segb-row-meta2">
                    {r.musteriSayi.toLocaleString("tr-TR")} {musteriLabel}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .segb-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .segb-head { display: flex; flex-direction: column; gap: 2px; }
        .segb-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .segb-sub { font-size: 11.5px; color: var(--color-muted); }
        .segb-list { display: flex; flex-direction: column; gap: 7px; }
        .segb-row { position: relative; border-radius: 7px; background: var(--color-surface-2); overflow: hidden; }
        .segb-row-fill { position: absolute; inset: 0 auto 0 0; background: var(--color-accent-soft, rgba(59, 130, 246, 0.22)); }
        .segb-row-content { position: relative; padding: 8px 11px; display: flex; flex-direction: column; gap: 2px; }
        .segb-row-r1 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .segb-row-label { font-size: 12.5px; font-weight: 600; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .segb-row-pay { font-size: 13px; font-weight: 700; color: var(--color-fg); flex-shrink: 0; font-variant-numeric: tabular-nums; }
        .segb-row-r2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .segb-row-ciro { font-size: 11px; font-weight: 600; color: var(--color-fg-2, var(--color-fg)); font-variant-numeric: tabular-nums; }
        .segb-row-meta2 { font-size: 10.5px; color: var(--color-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .segb-empty { font-size: 12px; color: var(--color-muted); padding: 12px 0; text-align: center; }
      `,
        }}
      />
    </div>
  );
}
