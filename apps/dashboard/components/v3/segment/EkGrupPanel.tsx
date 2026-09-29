import { formatCompact } from "@/components/komuta/format";

/**
 * Müşteri Ek Grubu (bayilik formatı) segment paneli.
 *
 * Aktif müşteri oranı = son 30g'de en az 1 fatura kesmiş / o grupta toplam
 * tanımlı müşteri. Düşük oran = inaktif portföy uyarısı (sağdaki rozet renkli).
 */
export type EkGrupSegmentRow = {
  kod: string;
  ad: string;
  musteriSayi: number;
  aktifMusteriSayi: number;
  aktifMusteriOraniPct: number;
  ciro: number;
  payPct: number;
};

import { panelTitle, panelHidden } from "@/lib/content";
import { t, type Locale } from "@/lib/i18n";

export function EkGrupPanel({ rows, locale = "tr" }: { rows: EkGrupSegmentRow[]; locale?: Locale }) {
  if (panelHidden("panel.segment.ekgrup")) return null;
  const visible = rows.slice(0, 12);
  const maxCiro = Math.max(1, ...visible.map((r) => r.ciro));

  return (
    <div className="v3-panel segb-panel">
      <div className="segb-head">
        <div className="segb-title">{panelTitle("panel.segment.ekgrup", t(locale, "panel.segment.ekgrup", "Müşteri Ek Grubu"))}</div>
        <div className="segb-sub">
          {locale === "en" ? `Dealer format · ${rows.length} groups` : `Bayilik formatı · ${rows.length} grup`}
          {rows.length > 12
            ? locale === "en"
              ? ` · top ${visible.length} shown`
              : ` · top ${visible.length} gösterimde`
            : ""}
        </div>
      </div>

      <div className="segb-list">
        {visible.length === 0 && (
          <div className="segb-empty">{t(locale, "seg.empty_ekgrup", "Henüz tanımlı ek grup yok")}</div>
        )}
        {visible.map((r) => {
          const aktifTone =
            r.aktifMusteriOraniPct >= 50
              ? "good"
              : r.aktifMusteriOraniPct >= 20
              ? "neutral"
              : "warn";
          const musteriLabel = locale === "en" ? "customers" : "müşteri";
          const aktifLabel = locale === "en" ? "active" : "aktif";
          const title = `${r.ad} · ${r.musteriSayi.toLocaleString("tr-TR")} ${musteriLabel} · ₺${formatCompact(r.ciro)} · ${aktifLabel} %${r.aktifMusteriOraniPct.toFixed(0)}`;
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
                  <span className={`active-pill ${aktifTone}`}>
                    {aktifLabel} %{r.aktifMusteriOraniPct.toFixed(0)}
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
        .active-pill { padding: 1px 7px; border-radius: 9px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.01em; flex-shrink: 0; }
        .active-pill.good { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
        .active-pill.neutral { background: var(--color-surface); color: var(--color-muted); border: 1px solid var(--color-border); }
        .active-pill.warn { background: rgba(220, 38, 38, 0.10); color: #dc2626; }
        .segb-empty { font-size: 12px; color: var(--color-muted); padding: 12px 0; text-align: center; }
      `,
        }}
      />
    </div>
  );
}
