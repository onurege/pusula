import { formatCompact } from "@/components/komuta/format";

/**
 * Müşteri Grubu segment paneli — Müşteri Grup Kırılımı
 * (TBLMUSTERI.TXTGRUPKIRILIMKOD × TBLMUSTERIGRUPKIRILIM).
 *
 * 3 kırılım yan yana'nın ilk boyutu — Müşteri Grubu + Ek Grubu + Müşteri
 * Tipi. Bu panel Prestige / Premium / Premium Plus / Standart / Standart
 * Plus gibi müşteri grup kırılımı etiketlerini gösterir — `EkSahaPanel`
 * ("Müşteri Tipi") ile AYNI kaynağı kullanır.
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

export function MusteriGrupPanel({ rows }: { rows: MusteriGrupSegmentRow[] }) {
  if (panelHidden("panel.segment.musterigrubu")) return null;
  const maxCiro = Math.max(1, ...rows.map((r) => r.ciro));
  const toplamMusteri = rows.reduce((a, r) => a + r.musteriSayi, 0);

  return (
    <div className="v3-panel seg-panel">
      <div className="seg-head">
        <div className="seg-title">{panelTitle("panel.segment.musterigrubu", "Müşteri Grubu")}</div>
        <div className="seg-sub">
          Müşteri Grup Kırılımı (TBLMUSTERIGRUPKIRILIM) · {rows.length} kırılım · {toplamMusteri.toLocaleString("tr-TR")} müşteri
        </div>
      </div>

      <div className="seg-list">
        {rows.length === 0 && (
          <div className="seg-empty">Henüz veri yok</div>
        )}
        {rows.map((r) => (
          <div key={r.kod} className="seg-row">
            <div className="seg-row-label" title={r.ad}>
              {r.ad}
            </div>
            <div className="seg-row-track">
              <div
                className="seg-row-fill"
                style={{ width: `${(r.ciro / maxCiro) * 100}%` }}
              />
              <div className="seg-row-meta">
                <span className="num">{r.musteriSayi.toLocaleString("tr-TR")} müşteri</span>
                <span className="sep">·</span>
                <span className="num">₺{formatCompact(r.ciro)}</span>
                <span className="sep">·</span>
                <span className="pay">%{r.payPct.toFixed(1)}</span>
                <span className="sep">·</span>
                <span className="disc">isk. %{r.ortIskontoOraniPct.toFixed(1)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .seg-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .seg-head { display: flex; flex-direction: column; gap: 2px; }
        .seg-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .seg-sub { font-size: 11.5px; color: var(--color-muted); }
        .seg-list { display: flex; flex-direction: column; gap: 10px; }
        .seg-row { display: grid; grid-template-columns: 130px 1fr; gap: 12px; align-items: center; }
        .seg-row-label { font-size: 12.5px; font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .seg-row-track { position: relative; height: 30px; background: var(--color-surface-2); border-radius: 5px; overflow: hidden; }
        .seg-row-fill { position: absolute; inset: 0 auto 0 0; background: var(--color-accent-soft, rgba(59, 130, 246, 0.18)); border-radius: 5px; transition: width 0.3s ease-out; }
        .seg-row-meta { position: relative; display: flex; align-items: center; gap: 6px; height: 100%; padding: 0 10px; font-size: 11.5px; color: var(--color-fg); font-variant-numeric: tabular-nums; }
        .seg-row-meta .sep { opacity: 0.35; }
        .seg-row-meta .pay { font-weight: 600; }
        .seg-row-meta .disc { color: var(--color-muted); }
        .seg-empty { font-size: 12px; color: var(--color-muted); padding: 12px 0; text-align: center; }
      `,
        }}
      />
    </div>
  );
}
