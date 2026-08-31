"use client";

import { useMemo } from "react";
import type { MapCityYoY } from "@/lib/api";

type Props = {
  cities: MapCityYoY[];
  region: string;
};

function fmtCiro(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Mr ₺`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M ₺`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)} K ₺`;
  return `${Math.round(n)} ₺`;
}

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}%${n.toFixed(0)}`;
}

/**
 * /map view=city sayfasının üst panelinde, seçili bölgenin şehir bazlı
 * içgörüsünü 3 kart halinde gösterir:
 *   1. 🚀 En büyük absolute büyüme (Δ TL pozitif top 3)
 *   2. 📉 En büyük absolute kayıp (Δ TL negatif top 3)
 *   3. ⚠️ Acil aksiyon gerektiren (|Δ%| > 50 AND ciroPrev > 1M — gerçek bayi
 *      kaybı/kazancı sinyali, küçük baz etkisi değil)
 *
 * Amaç: matematiksel YoY %'nin yanıltıcı olabildiği durumlarda
 * (örn. Kars +%176 küçük baz, Hakkari -%78 kritik) gerçek aksiyon-değer'i
 * öne çıkarmak.
 */
export function CityInsights({ cities, region }: Props) {
  const insights = useMemo(() => {
    const cleaned = cities.filter((c) => c.ciro > 0 || c.ciroPrev > 0);

    // Sıralama: absolute delta TL'ye göre — büyük rakamlı şehirler öne çıksın
    const byAbsDelta = [...cleaned].map((c) => ({
      ...c,
      absDelta: c.ciro - c.ciroPrev,
    }));

    const growers = byAbsDelta
      .filter((c) => c.absDelta > 0)
      .sort((a, b) => b.absDelta - a.absDelta)
      .slice(0, 3);

    const decliners = byAbsDelta
      .filter((c) => c.absDelta < 0)
      .sort((a, b) => a.absDelta - b.absDelta)
      .slice(0, 3);

    // Acil aksiyon: ciroPrev > 1M (gerçek base) AND deltaPct < -50% (büyük düşüş)
    const urgent = byAbsDelta
      .filter(
        (c) =>
          c.ciroPrev > 1_000_000 &&
          c.deltaPct != null &&
          c.deltaPct < -50,
      )
      .sort((a, b) => a.deltaPct! - b.deltaPct!)
      .slice(0, 3);

    // Küçük baz etkisi örneği — bu BÖLGE'de yüksek +% ama küçük taban
    // ("Kars +%176") gibi şehir. Acil aksiyon yokken kullanıcıya hangi
    // şehrin bu kategoriye düştüğünü göstermek için.
    const smallBaseGrower = byAbsDelta
      .filter(
        (c) =>
          c.ciroPrev > 0 &&
          c.ciroPrev < 2_000_000 && // küçük baz
          c.deltaPct != null &&
          c.deltaPct > 100, // büyük yüzdesel sıçrama
      )
      .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];

    return { growers, decliners, urgent, smallBaseGrower, comparedCount: cleaned.length };
  }, [cities]);

  // Hiç veri yoksa render etme
  if (insights.growers.length === 0 && insights.decliners.length === 0) {
    return null;
  }

  return (
    <div className="ci-panel">
      <div className="ci-header">
        <div className="ci-title">
          🔎 <strong>{region}</strong> şehir içgörüleri
        </div>
        <div className="ci-sub">
          {insights.comparedCount} şehir · son 30g vs geçen yıl aynı 30g ·
          küçük baz etkisini görmek için mutlak Δ TL sıralı
        </div>
      </div>

      <div className="ci-grid">
        {/* En büyük büyüyenler — absolute Δ TL */}
        {insights.growers.length > 0 && (
          <div className="ci-card pos">
            <div className="ci-card-head">
              <span className="ci-card-icon">🚀</span>
              <span className="ci-card-title">En büyük büyüme</span>
              <span className="ci-card-meta">absolute Δ TL</span>
            </div>
            <div className="ci-rows">
              {insights.growers.map((c) => (
                <div key={c.sehirNorm} className="ci-row">
                  <div className="ci-row-name">{c.sehir}</div>
                  <div className="ci-row-stats">
                    <span className="ci-row-delta pos">
                      +{fmtCiro(c.absDelta)}
                    </span>
                    <span className="ci-row-pct pos">{pct(c.deltaPct)}</span>
                  </div>
                  <div className="ci-row-context">
                    {fmtCiro(c.ciro)} <span className="ci-row-vs">vs</span>{" "}
                    {fmtCiro(c.ciroPrev)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* En büyük düşenler — absolute Δ TL */}
        {insights.decliners.length > 0 && (
          <div className="ci-card neg">
            <div className="ci-card-head">
              <span className="ci-card-icon">📉</span>
              <span className="ci-card-title">En büyük kayıp</span>
              <span className="ci-card-meta">absolute Δ TL</span>
            </div>
            <div className="ci-rows">
              {insights.decliners.map((c) => (
                <div key={c.sehirNorm} className="ci-row">
                  <div className="ci-row-name">{c.sehir}</div>
                  <div className="ci-row-stats">
                    <span className="ci-row-delta neg">
                      {fmtCiro(c.absDelta)}
                    </span>
                    <span className="ci-row-pct neg">{pct(c.deltaPct)}</span>
                  </div>
                  <div className="ci-row-context">
                    {fmtCiro(c.ciro)} <span className="ci-row-vs">vs</span>{" "}
                    {fmtCiro(c.ciroPrev)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acil aksiyon — gerçek bayi kaybı sinyali */}
        {insights.urgent.length > 0 ? (
          <div className="ci-card urgent">
            <div className="ci-card-head">
              <span className="ci-card-icon">⚠️</span>
              <span className="ci-card-title">Acil aksiyon</span>
              <span className="ci-card-meta">
                |Δ%| &gt; 50, baz &gt; 1M ₺
              </span>
            </div>
            <div className="ci-rows">
              {insights.urgent.map((c) => (
                <div key={c.sehirNorm} className="ci-row">
                  <div className="ci-row-name">{c.sehir}</div>
                  <div className="ci-row-stats">
                    <span className="ci-row-delta neg">
                      {fmtCiro(c.absDelta)}
                    </span>
                    <span className="ci-row-pct neg">{pct(c.deltaPct)}</span>
                  </div>
                  <div className="ci-row-context">
                    {fmtCiro(c.ciro)} <span className="ci-row-vs">vs</span>{" "}
                    {fmtCiro(c.ciroPrev)}
                  </div>
                  <div className="ci-row-action">
                    Acil saha ziyareti — bayi/müşteri kaybı kontrolü
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="ci-card neutral">
            <div className="ci-card-head">
              <span className="ci-card-icon">✓</span>
              <span className="ci-card-title">Acil aksiyon yok</span>
              <span className="ci-card-meta">
                |Δ%| &gt; 50, baz &gt; 1M ₺
              </span>
            </div>
            <div className="ci-empty">
              {region} bölgesinde büyük tabanlı kritik düşüş tespit edilmedi.
              {insights.smallBaseGrower && (
                <>
                  {" "}Tabandaki sıçramalar (örn.{" "}
                  <strong>{insights.smallBaseGrower.sehir}</strong>{" "}
                  {pct(insights.smallBaseGrower.deltaPct)}) küçük baz etkisi —
                  kontrol edilmeye değer ama alarm değil.
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .ci-panel {
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
          padding: 10px 14px;
        }
        .ci-header {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        .ci-title {
          font-size: 12.5px;
          color: var(--color-fg);
        }
        .ci-sub {
          font-size: 10.5px;
          color: var(--color-muted);
          font-style: italic;
        }
        .ci-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        @media (min-width: 900px) {
          .ci-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }
        .ci-card {
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
          border-left: 3px solid var(--color-muted);
          border-radius: 6px;
          padding: 8px 10px;
          min-width: 0;
        }
        .ci-card.pos { border-left-color: var(--color-good); }
        .ci-card.neg { border-left-color: var(--color-bad); }
        .ci-card.urgent {
          border-left-color: var(--color-bad);
          background: linear-gradient(135deg, var(--color-bad-soft) 0%, var(--color-surface-2) 50%);
        }
        .ci-card.neutral { border-left-color: var(--color-muted); }
        .ci-card-head {
          display: flex;
          align-items: baseline;
          gap: 6px;
          margin-bottom: 6px;
          padding-bottom: 4px;
          border-bottom: 1px dashed var(--color-border);
        }
        .ci-card-icon { font-size: 14px; line-height: 1; }
        .ci-card-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--color-fg);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .ci-card-meta {
          font-size: 9.5px;
          color: var(--color-muted);
          margin-left: auto;
          font-style: italic;
        }
        .ci-empty {
          font-size: 10.5px;
          color: var(--color-muted);
          line-height: 1.45;
          padding: 4px 0;
        }
        .ci-rows {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ci-row {
          display: grid;
          grid-template-columns: minmax(80px, auto) 1fr;
          grid-template-rows: auto auto;
          gap: 1px 8px;
          align-items: baseline;
        }
        .ci-row + .ci-row {
          padding-top: 5px;
          border-top: 1px dashed var(--color-border);
        }
        .ci-row-name {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--color-fg);
          grid-row: 1;
        }
        .ci-row-stats {
          display: inline-flex;
          gap: 8px;
          justify-content: flex-end;
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          font-weight: 700;
          grid-row: 1;
        }
        .ci-row-delta.pos, .ci-row-pct.pos { color: var(--color-good); }
        .ci-row-delta.neg, .ci-row-pct.neg { color: var(--color-bad); }
        .ci-row-pct {
          opacity: 0.9;
        }
        .ci-row-context {
          grid-row: 2;
          grid-column: 1 / -1;
          font-size: 10px;
          color: var(--color-fg-2);
          font-variant-numeric: tabular-nums;
          opacity: 0.85;
        }
        .ci-row-vs {
          color: var(--color-muted);
          font-style: italic;
          opacity: 0.7;
        }
        .ci-row-action {
          grid-row: 3;
          grid-column: 1 / -1;
          font-size: 10px;
          color: var(--color-bad);
          font-weight: 600;
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}
