import type { SatisDistRow } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";
import { panelTitle, panelHidden } from "@/lib/content";

/**
 * md27: Nokta Başına Satış Hızı = ciro / aktif nokta (aktif müşteri).
 *
 * Backend (`packages/core/src/wietnauer-satis.ts`) `distLeaderboard` snapshot
 * satırına `satisHizi` alanını mevcut ciro/musteriSayi'dan türetir (bölme
 * sıfır koruması: musteriSayi=0 → 0). `apps/dashboard/lib/api.ts` tip aynası
 * bu görevin dosya kapsamı dışında olduğu için burada intersection ile
 * genişletiliyor — runtime payload alanı zaten içeriyor.
 */
export type SatisDistRowWithVelocity = SatisDistRow & { satisHizi: number };

type Props = {
  rows: SatisDistRowWithVelocity[];
  /**
   * md21 — birim filtresi. `"tl"` (varsayılan) → mevcut davranış (ciro bazlı
   * `satisHizi`). Tenant hacim birimi anahtarı (ör. `"9le"`) verilirse
   * `hacim / aktif nokta` gösterilir — snapshot zaten `hacim` alanını
   * taşıdığı için ek sorgu gerekmez, salt render-zamanı türetim.
   */
  unit?: string;
  /** Hacim birimi kısa etiketi (ör. "70cl") — yalnızca `unit !== "tl"` iken kullanılır. */
  volumeShort?: string;
  /** Seçili tarih aralığı etiketi (ör. "Son 30g" veya "12 Ağu – 19 Ağu"). */
  rangeLabel?: string;
};

/**
 * Yatay bar chart: hız DESC, Top 15. `fetchDistributorLeaderboard`
 * deseniyle aynı veri kaynağı (distLeaderboard) — Drop Size panelinden farkı:
 * ≥5 müşteri filtresi yok, tüm scope'lu distribütörler dahil (zaten
 * distLeaderboard rank'lı & scope uygulanmış geliyor).
 */
export function SalesVelocityPanel({ rows, unit = "tl", volumeShort, rangeLabel = "Son 30g" }: Props) {
  if (panelHidden("panel.satis.hiz")) return null;
  if (rows.length === 0) {
    return (
      <div className="v3-panel v3-panel-empty">
        <div className="v3-panel-title">
          {panelTitle("panel.satis.hiz", "Nokta Başına Satış Hızı")}
        </div>
        <p>{rangeLabel} içinde fatura kaydı bulunamadı.</p>
      </div>
    );
  }

  const useVolume = unit !== "tl" && Boolean(volumeShort);
  const withHiz = rows.map((r) => ({
    ...r,
    hiz: useVolume ? (r.musteriSayi > 0 ? r.hacim / r.musteriSayi : 0) : r.satisHizi,
  }));
  const top = [...withHiz].sort((a, b) => b.hiz - a.hiz).slice(0, 15);
  const maxHiz = Math.max(1, ...top.map((r) => r.hiz));

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">
            {panelTitle("panel.satis.hiz", "Nokta Başına Satış Hızı")}
          </div>
          <div className="v3-panel-sub">
            {rangeLabel} · {useVolume ? `hacim (${volumeShort})` : "ciro"} / aktif nokta (aktif müşteri) · Top {top.length}
          </div>
        </div>
      </div>

      <div className="v3-bars">
        {top.map((r) => (
          <div key={r.id} className="bar-row">
            <div className="bar-label" title={r.ad}>
              <span className="bar-rank">#{r.rank}</span>
              <span className="bar-name">{r.ad}</span>
              {r.region && <span className="bar-region">{r.region}</span>}
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(r.hiz / maxHiz) * 100}%` }}
              />
            </div>
            <div className="bar-meta">
              <span className="bar-val">
                {useVolume ? `${formatCompact(r.hiz)} ${volumeShort}` : `₺${formatCompact(r.hiz)}`}
              </span>
              <span className="bar-cust">
                {r.musteriSayi.toLocaleString("tr-TR")} nokta
              </span>
            </div>
          </div>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-empty p { font-size: 12.5px; color: var(--color-muted); margin: 8px 0 0; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .v3-bars { display: flex; flex-direction: column; gap: 5px; }
        .bar-row { display: grid; grid-template-columns: 220px 1fr 200px; align-items: center; gap: 12px; padding: 6px 0; font-size: 12.5px; }
        .bar-row:hover { background: var(--color-surface-2); margin: 0 -8px; padding: 6px 8px; border-radius: 6px; }
        .bar-label { display: inline-flex; align-items: center; gap: 6px; overflow: hidden; }
        .bar-rank { font-size: 10.5px; color: var(--color-muted-2); font-variant-numeric: tabular-nums; font-weight: 500; min-width: 22px; }
        .bar-name { font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .bar-region { font-size: 10.5px; color: var(--color-muted-2); white-space: nowrap; }
        .bar-track { height: 18px; background: var(--color-surface-2); border-radius: 4px; overflow: hidden; position: relative; }
        .bar-fill { height: 100%; background: var(--color-accent); border-radius: 4px; opacity: 0.65; transition: width 0.3s ease-out; }
        .bar-meta { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 10px; font-variant-numeric: tabular-nums; }
        .bar-val { color: var(--color-fg); font-weight: 600; min-width: 80px; text-align: right; }
        .bar-cust { color: var(--color-muted); font-size: 11.5px; min-width: 80px; text-align: right; }
      `,
        }}
      />
    </div>
  );
}
