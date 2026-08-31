import { formatCompact } from "@/components/komuta/format";
import type { StrategicBrandDetail } from "./types";

/**
 * Dashboard #4 — Panel D: Stratejik Marka Zoom.
 *
 * tenant.strategicBrands listesindeki her marka için mini-kart:
 *   - Son 30g ciro (büyük rakam)
 *   - Distinct müşteri + fatura sayısı
 *   - Top 3 SKU (sıralı liste)
 *
 * Veride hiç işlem olmayan marka için placeholder kart — Wietnauer config'inde
 * "BRUGAL" var ama satış yoksa görsel açıklamayla beraber boş gösterilir.
 */
export function StrategicBrandZoom({
  brands,
  periodLabel = "Son 30g",
}: {
  brands: StrategicBrandDetail[];
  periodLabel?: string;
}) {
  if (brands.length === 0) {
    return (
      <div className="v3-panel empty">
        <div className="v3-panel-title">Stratejik Marka Zoom</div>
        <p className="empty-msg">
          tenant.strategicBrands listesi boş — stratejik marka takibi
          tanımlanmamış.
        </p>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
          .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); }
          .empty-msg { font-size: 12.5px; color: var(--color-muted); margin: 8px 0 0; }
        `,
          }}
        />
      </div>
    );
  }

  const aktif = brands.filter((b) => b.hasData);
  const totalCiro = aktif.reduce((a, b) => a + b.ciro, 0);

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Stratejik Marka Zoom</div>
          <div className="v3-panel-sub">
            {periodLabel} · {aktif.length}/{brands.length} marka aktif · Toplam
            stratejik ciro <strong>₺{formatCompact(totalCiro)}</strong>
          </div>
        </div>
      </div>

      <div className="strat-grid">
        {brands.map((b) => (
          <div
            key={b.marka}
            className={`strat-card ${b.hasData ? "" : "empty-card"}`}
          >
            <div className="card-head">
              <span className="strat-dot" />
              <span className="card-name" title={b.marka}>
                {b.marka}
              </span>
            </div>
            <div className="card-hero">
              {b.hasData ? `₺${formatCompact(b.ciro)}` : "—"}
            </div>
            <div className="card-meta">
              {b.hasData ? (
                <>
                  <span>{b.musteriSayi.toLocaleString("tr-TR")} müşteri</span>
                  <span className="dot">·</span>
                  <span>{b.faturaSayisi.toLocaleString("tr-TR")} fatura</span>
                </>
              ) : (
                <span>son 30g satış yok</span>
              )}
            </div>
            {b.hasData && b.topSkus.length > 0 && (
              <ol className="card-skus">
                {b.topSkus.map((s, i) => (
                  <li key={s.urunKod}>
                    <span className="sku-rank">{i + 1}</span>
                    <span className="sku-ad" title={s.ad}>
                      {s.ad.length > 36 ? s.ad.slice(0, 33) + "…" : s.ad}
                    </span>
                    <span className="sku-ciro">
                      ₺{formatCompact(s.ciro)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {b.hasData && b.topSkus.length === 0 && (
              <div className="card-no-sku">SKU detayı çekilemedi.</div>
            )}
          </div>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .strat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
        .strat-card { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
        .strat-card.empty-card { opacity: 0.55; }
        .card-head { display: inline-flex; align-items: center; gap: 6px; }
        .strat-dot { width: 8px; height: 8px; background: var(--color-accent); border-radius: 50%; flex-shrink: 0; }
        .card-name { font-size: 12.5px; font-weight: 600; color: var(--color-fg); letter-spacing: 0.01em; }
        .card-hero { font-size: 22px; font-weight: 700; color: var(--color-fg); font-variant-numeric: tabular-nums; line-height: 1.1; letter-spacing: -0.02em; }
        .card-meta { font-size: 11px; color: var(--color-muted); display: inline-flex; gap: 4px; }
        .card-meta .dot { opacity: 0.5; }
        .card-skus { list-style: none; margin: 6px 0 0; padding: 8px 0 0; border-top: 1px dashed var(--color-border); display: flex; flex-direction: column; gap: 4px; }
        .card-skus li { display: grid; grid-template-columns: 18px 1fr auto; align-items: baseline; gap: 6px; font-size: 11.5px; font-variant-numeric: tabular-nums; }
        .sku-rank { color: var(--color-muted-2); font-weight: 500; }
        .sku-ad { color: var(--color-fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sku-ciro { color: var(--color-fg); font-weight: 500; }
        .card-no-sku { font-size: 11px; color: var(--color-muted-2); border-top: 1px dashed var(--color-border); padding-top: 6px; }
      `,
        }}
      />
    </div>
  );
}
