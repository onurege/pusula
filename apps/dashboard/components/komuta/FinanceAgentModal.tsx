"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import {
  getFinanceAnalysis,
  type FinanceAnalysis,
  type FinanceFacts,
  type FinanceFactor,
} from "@/lib/api";
import { addAction as addWeeklyAction } from "@/components/weekly-actions/store";

type Props = {
  region: string | null;
  /** Heatmap hücresinden veya ileride başka bir trigger'dan gelirse, modal
   *  içinde bağlam satırı + haftalık aksiyon payload'ına eklenir. Opsiyonel
   *  kalır; manuel picker akışında undefined gelir. */
  productGroup?: string;
  onClose: () => void;
};

/**
 * Finans Agentı modali — bir bölgenin YoY anomalisini analiz eder.
 *
 * Açıldığında /api/komuta/finance/:region çağırır; Gemini'den dönen
 * markdown'ı + yapılandırılmış kırılım tablolarını gösterir.
 */
export function FinanceAgentModal({ region, productGroup, onClose }: Props) {
  const [data, setData] = useState<FinanceAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Haftalık aksiyon listesine eklendi mi — region değiştikçe (modal yeni
  // bölge için açıldı) sıfırlanır; aynı modal açık kalırken tekrar ekleme
  // engellenir.
  const [addedToWeekly, setAddedToWeekly] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Yeni bölge açıldığında haftalık aksiyon ekleme durumunu sıfırla
  useEffect(() => {
    setAddedToWeekly(false);
  }, [region]);

  useEffect(() => {
    if (!region) return;
    setData(null);
    setError(null);
    setLoading(true);
    getFinanceAnalysis(region, {
      refresh: refreshNonce > 0,
      productGroup,
    })
      .then((res) => {
        if (mountedRef.current) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : "Bilinmeyen hata.");
          setLoading(false);
        }
      });
  }, [region, productGroup, refreshNonce]);

  // ESC ile kapatma
  useEffect(() => {
    if (!region) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [region, onClose]);

  if (!region) return null;
  if (typeof document === "undefined") return null;

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} Mr ₺`;
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M ₺`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)} K ₺`;
    return `${n.toFixed(0)} ₺`;
  };
  const pct = (n: number | null) =>
    n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

  // Map drill-down URL — region varsa bolge filter, her durumda riskTier=high.
  // basePath URL'den auto-detect: V3 Cockpit'ten açıldıysa /v3/harita'ya,
  // V2 Komuta'dan /v2/harita'ya, aksi /map'e. TurkeyMapPolygon ile aynı
  // kural.
  const pathname = usePathname() ?? "";
  const mapBase = pathname.startsWith("/v3")
    ? "/v3/harita"
    : pathname.startsWith("/v2")
      ? "/v2/harita"
      : "/map";
  const mapHrefParams = new URLSearchParams();
  if (region) mapHrefParams.set("bolge", region);
  mapHrefParams.set("riskTier", "high");
  const mapHref = `${mapBase}?${mapHrefParams.toString()}`;

  const handleAddToWeekly = () => {
    if (!region || addedToWeekly) return;
    const text = `${region} bölgesindeki finans anomalisi için kök neden analizi tamamlandı; riskli müşteriler haritada incelensin.`;
    addWeeklyAction({
      text,
      source: "finance",
      region,
      ...(productGroup ? { productGroup } : {}),
      reason: "Finans Agentı kök neden analizi",
    });
    setAddedToWeekly(true);
  };

  return createPortal(
    <div className="fa-overlay" onClick={onClose}>
      <div className="fa-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fa-header">
          <div>
            <div className="fa-eyebrow">💼 Finans Agentı · Bölge Analizi</div>
            <h2 className="fa-title">{region}</h2>
            {productGroup && (
              <div className="fa-subcontext">
                Ürün grubu: <strong>{productGroup}</strong>
              </div>
            )}
          </div>
          <div className="fa-actions">
            <button
              type="button"
              className="fa-btn-ghost"
              onClick={() => setRefreshNonce((n) => n + 1)}
              disabled={loading}
              title="Yeniden analiz et"
            >
              ↻ Yenile
            </button>
            <button type="button" className="fa-btn-close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="fa-body">
          {loading && (
            <div className="fa-loading">
              <div className="fa-spinner" />
              <div>
                Finans agentı çalışıyor — bölge verisi decompose ediliyor, ardından
                Gemini ile yorum üretilecek...
              </div>
            </div>
          )}

          {error && (
            <div className="fa-error">
              <strong>Analiz alınamadı:</strong> {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Hero cümle — bir bakışta hikaye: ne oldu, ne kadar, kim etken. */}
              <HeroSentence
                facts={data.facts}
                region={region}
                fmt={fmt}
                pct={pct}
              />

              {/* Slim KPI strip — 4 tile (eski 6'dan indirildi).
                  Story zaten hero'da; burada destekleyici rakamlar. */}
              <div className="fa-kpi-row fa-kpi-row-slim">
                <div className="fa-kpi">
                  <div className="fa-kpi-label">Son 30g{productGroup ? ` · ${productGroup}` : ""}</div>
                  <div className="fa-kpi-val">{fmt(data.facts.buDonem)}</div>
                  <div className="fa-kpi-base">net ciro</div>
                </div>
                <div className="fa-kpi">
                  <div className="fa-kpi-label">Geçen yıl 30g</div>
                  <div className="fa-kpi-val muted">{fmt(data.facts.gecenYil)}</div>
                  <div className="fa-kpi-base">aynı pencere</div>
                </div>
                <div className="fa-kpi">
                  <div className="fa-kpi-label">Aktif müşteri</div>
                  <div className="fa-kpi-val">
                    {data.facts.customers.aktifBu}
                    <span className="fa-kpi-sub">
                      {" "}
                      / {data.facts.customers.aktifGecen}
                    </span>
                  </div>
                  <div className="fa-kpi-base">bu / geçen yıl</div>
                </div>
                <div className="fa-kpi">
                  <div className="fa-kpi-label">Kayıp müşteri</div>
                  <div className="fa-kpi-val neg">
                    {data.facts.customers.kaybedilen}
                  </div>
                  <div className="fa-kpi-base">geçen yıl alıp bu yıl almayan</div>
                </div>
              </div>

              {/* Decomposition — 3 grafik (bar chart bu vs geçen yıl) */}
              <div className="fa-charts">
                <FactorBars
                  title="Distribütör Kırılımı"
                  subtitle="Son 30g (yeşil büyüyen · kırmızı düşen) vs Geçen yıl aynı 30g (gri) · ciro ₺"
                  factors={data.facts.distFactors.slice(0, 6)}
                  fmt={fmt}
                  pct={pct}
                />
                <FactorBars
                  title="Müşteri Grubu Kırılımı"
                  subtitle="Son 30g (yeşil büyüyen · kırmızı düşen) vs Geçen yıl aynı 30g (gri) · ciro ₺"
                  factors={data.facts.channelFactors.slice(0, 6)}
                  fmt={fmt}
                  pct={pct}
                />
                <FactorBars
                  title={
                    productGroup
                      ? `SKU Kırılımı (${productGroup})`
                      : "Ürün Grubu Kırılımı"
                  }
                  subtitle="Son 30g (yeşil büyüyen · kırmızı düşen) vs Geçen yıl aynı 30g (gri) · ciro ₺"
                  factors={data.facts.productFactors.slice(0, 6)}
                  fmt={fmt}
                  pct={pct}
                />
              </div>

              {/* AI yorum — collapsible, default kapalı.
                  Grafik bilgisi yeterli; isteyen detaylı yorumu açar. */}
              <details className="fa-ai-details">
                <summary className="fa-ai-summary">
                  💼 Gemini detaylı analiz
                  <span className="fa-ai-summary-hint">
                    finans diliyle özet / kök neden / aksiyon
                  </span>
                </summary>
                <div className="fa-ai-content">
                  {renderMarkdown(data.markdown)}
                </div>
              </details>

              {/* Demo journey CTA'ları — analiz sonucundan haritaya ve
                  haftalık aksiyon listesine köprü. Stil için Tailwind kullan;
                  styled-jsx scope'u next/link içine geçmediği için class
                  kaybolmasın. */}
              <div className="flex flex-wrap gap-2.5 my-1 mb-3.5">
                <Link
                  href={mapHref}
                  className="flex-1 min-w-[240px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg text-[12.5px] font-semibold text-white no-underline shadow-md shadow-accent/25 bg-gradient-to-br from-accent to-accent-hover hover:from-[#818cf8] hover:to-[#4338ca] transition-colors"
                >
                  🗺️ Haritada riskli müşterileri göster
                </Link>
                <button
                  type="button"
                  onClick={handleAddToWeekly}
                  disabled={addedToWeekly}
                  aria-label={
                    addedToWeekly
                      ? "Bu analiz haftalık aksiyon listesine eklendi"
                      : "Bu analizi haftalık aksiyon listesine ekle"
                  }
                  className={
                    "flex-1 min-w-[240px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg text-[12.5px] font-semibold border transition-colors " +
                    (addedToWeekly
                      ? "bg-good-soft text-good border-good/40 cursor-default"
                      : "bg-surface text-accent border-accent/40 hover:bg-accent-soft")
                  }
                >
                  {addedToWeekly ? "✓ Eklendi" : "📋 Aksiyona ekle"}
                </button>
              </div>

              <div className="fa-footer">
                Üretildi: {new Date(data.generatedAt).toLocaleString("tr-TR")}
              </div>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .fa-overlay {
          position: fixed;
          inset: 0;
          background: rgba(28, 25, 23, 0.78);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          backdrop-filter: blur(2px);
        }
        .fa-modal {
          background: var(--color-surface);
          border: 1px solid var(--color-border-strong);
          border-radius: 12px;
          width: min(960px, 94vw);
          max-height: 92vh;
          display: flex;
          flex-direction: column;
          color: var(--color-fg);
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui,
            sans-serif;
          font-size: 13px;
        }
        .fa-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 16px 20px;
          border-bottom: 1px solid var(--color-border);
        }
        .fa-eyebrow {
          font-size: 10.5px;
          color: var(--color-accent);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          font-weight: 600;
        }
        .fa-title {
          margin: 4px 0 0 0;
          font-size: 20px;
          font-weight: 700;
          color: var(--color-fg);
          letter-spacing: -0.2px;
        }
        .fa-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .fa-btn-ghost {
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.3);
          color: var(--color-accent);
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 11px;
          cursor: pointer;
          font-weight: 600;
        }
        .fa-btn-ghost:hover:not(:disabled) {
          background: rgba(99, 102, 241, 0.2);
        }
        .fa-btn-ghost:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .fa-btn-close {
          background: transparent;
          border: 1px solid var(--color-border-strong);
          color: var(--color-muted);
          width: 30px;
          height: 30px;
          border-radius: 6px;
          font-size: 18px;
          cursor: pointer;
          line-height: 1;
        }
        .fa-btn-close:hover {
          color: var(--color-fg);
          border-color: var(--color-accent);
        }
        .fa-body {
          padding: 16px 20px 20px 20px;
          overflow-y: auto;
        }
        .fa-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          padding: 60px 20px;
          color: var(--color-muted);
          text-align: center;
        }
        .fa-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(99, 102, 241, 0.2);
          border-top-color: var(--color-accent);
          border-radius: 50%;
          animation: fa-spin 0.9s linear infinite;
        }
        @keyframes fa-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .fa-error {
          padding: 14px 16px;
          background: rgba(220, 38, 38, 0.1);
          border: 1px solid rgba(220, 38, 38, 0.3);
          border-radius: 6px;
          color: var(--color-bad);
          margin-bottom: 12px;
        }
        .fa-kpi-row {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 10px;
          margin-bottom: 18px;
        }
        .fa-kpi-row-slim {
          grid-template-columns: repeat(4, 1fr);
        }
        @media (max-width: 720px) {
          .fa-kpi-row-slim {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        .fa-kpi {
          background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-bg) 100%);
          border: 1px solid var(--color-border-strong);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .fa-kpi-label {
          font-size: 9.5px;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 700;
        }
        .fa-kpi-val {
          margin-top: 4px;
          font-size: 14px;
          font-weight: 700;
          color: var(--color-fg);
        }
        .fa-kpi-val.muted {
          color: var(--color-fg-2);
        }
        .fa-kpi-val.neg {
          color: var(--color-bad);
        }
        .fa-kpi-val.pos {
          color: var(--color-good);
        }
        .fa-kpi-sub {
          font-size: 11px;
          font-weight: 400;
          color: var(--color-muted);
        }
        /* "Neye göre" subtitle her KPI kartının altında */
        .fa-kpi-base {
          font-size: 10px;
          color: var(--color-fg-2);
          margin-top: 4px;
          line-height: 1.3;
          font-style: italic;
          opacity: 0.85;
        }
        /* "En büyük etkiler" — analizin başına görsel hook */
        .fa-headline {
          margin-bottom: 14px;
        }
        .fa-headline-label {
          font-size: 10px;
          color: var(--color-accent);
          text-transform: uppercase;
          letter-spacing: 0.6px;
          font-weight: 700;
          margin-bottom: 6px;
        }
        .fa-headline-base {
          color: var(--color-muted-2);
          text-transform: none;
          letter-spacing: normal;
          font-weight: 400;
          font-style: italic;
          font-size: 9.5px;
        }
        .fa-headline-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        @media (max-width: 720px) {
          .fa-headline-row { grid-template-columns: 1fr; }
        }
        .fa-headline-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border-strong);
          border-left: 3px solid;
          border-radius: 8px;
          padding: 8px 10px;
          min-width: 0;
        }
        .fa-headline-card.pos { border-left-color: var(--color-good); }
        .fa-headline-card.neg { border-left-color: var(--color-bad); }
        .fa-headline-meta {
          font-size: 9px;
          color: var(--color-muted-2);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .fa-headline-name {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--color-fg);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fa-headline-stats {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-top: 4px;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .fa-headline-card.pos .fa-headline-delta,
        .fa-headline-card.pos .fa-headline-pct { color: var(--color-good); }
        .fa-headline-card.neg .fa-headline-delta,
        .fa-headline-card.neg .fa-headline-pct { color: var(--color-bad); }
        /* bu vs gecen yıl mini comparison her headline card'ın altında */
        .fa-headline-compare {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px dashed var(--color-border);
          font-size: 10px;
        }
        .fa-headline-cmp-bu,
        .fa-headline-cmp-gecen {
          display: inline-flex;
          flex-direction: column;
          gap: 1px;
        }
        .fa-headline-cmp-bu strong,
        .fa-headline-cmp-gecen strong {
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          color: var(--color-fg);
          font-weight: 600;
        }
        .fa-headline-cmp-gecen strong {
          color: var(--color-muted);
        }
        .fa-headline-cmp-lab {
          font-size: 8.5px;
          color: var(--color-muted-2);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .fa-headline-cmp-vs {
          color: var(--color-muted-2);
          font-size: 9px;
          font-weight: 600;
        }

        /* Grafik bölümü — eski .fa-tables yerine bar chart grid */
        .fa-charts {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          margin-top: 14px;
          margin-bottom: 14px;
        }
        @media (min-width: 900px) {
          .fa-charts {
            grid-template-columns: 1fr 1fr;
          }
          .fa-charts > :nth-child(3) {
            grid-column: 1 / -1;
          }
        }

        /* AI yorum — collapsible */
        .fa-ai-details {
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 14px;
          overflow: hidden;
        }
        .fa-ai-summary {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          color: var(--color-fg);
          user-select: none;
        }
        .fa-ai-summary:hover {
          background: var(--color-surface);
        }
        .fa-ai-details[open] .fa-ai-summary {
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface);
        }
        .fa-ai-summary-hint {
          font-size: 10.5px;
          color: var(--color-fg-2);
          font-weight: 400;
          font-style: italic;
          opacity: 0.85;
        }
        .fa-ai-content {
          padding: 12px 16px;
        }

        /* Section kartları — Özet / Kök Nedenler / Aksiyon Önerisi */
        .fa-sections {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 14px;
        }
        .fa-section {
          background: var(--color-surface);
          border: 1px solid var(--color-border-strong);
          border-radius: 8px;
          padding: 12px 16px;
        }
        .fa-section-head {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-bottom: 8px;
          margin-bottom: 10px;
          border-bottom: 1px solid var(--color-border);
        }
        .fa-section-icon {
          font-size: 15px;
          line-height: 1;
        }
        .fa-section :global(h3) {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          color: var(--color-fg);
          letter-spacing: -0.1px;
        }
        .fa-section :global(ul.fa-section-list) {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .fa-section :global(.fa-section-list li) {
          position: relative;
          padding-left: 16px;
          line-height: 1.55;
          font-size: 12.5px;
          color: var(--color-fg-2);
        }
        .fa-section :global(.fa-section-list li::before) {
          content: "•";
          position: absolute;
          left: 4px;
          top: 0;
          color: var(--color-accent);
          font-weight: 700;
        }
        .fa-section :global(p) {
          margin: 0 0 6px 0;
          font-size: 12.5px;
          line-height: 1.6;
          color: var(--color-fg-2);
        }
        .fa-section :global(p:last-child) {
          margin-bottom: 0;
        }
        .fa-section :global(strong) {
          color: var(--color-fg);
        }
        .fa-tables {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }
        @media (min-width: 720px) {
          .fa-tables {
            grid-template-columns: 1fr 1fr 1fr;
          }
        }
        .fa-footer {
          font-size: 10.5px;
          color: var(--color-muted);
          text-align: right;
          margin-top: 6px;
        }
        .fa-subcontext {
          margin-top: 4px;
          font-size: 11.5px;
          color: var(--color-fg-2);
        }
        .fa-subcontext strong {
          color: var(--color-fg);
          font-weight: 600;
        }
      `}</style>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Bar chart versiyonu — son 30g ve geçen yıl 30g yan yana.
 *  Son 30g: pozitif delta yeşil, negatif kırmızı.
 *  Geçen yıl: gri referans bar.
 *  Faktörler |delta|'ya göre sıralı (en kötü/en iyi üstte). */
function FactorBars({
  title,
  subtitle,
  factors,
  fmt,
  pct,
}: {
  title: string;
  subtitle?: string;
  factors: FinanceFactor[];
  fmt: (n: number) => string;
  pct: (n: number | null) => string;
}) {
  if (factors.length === 0) {
    return (
      <div className="fb-card">
        <div className="fb-title">{title}</div>
        {subtitle && <div className="fb-subtitle">{subtitle}</div>}
        <div className="fb-empty">Veri yok</div>
        <style jsx>{factorBarsCss}</style>
      </div>
    );
  }
  // |delta|'ya göre sırala — en yüksek etki üstte
  const sorted = [...factors].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta),
  );
  // Recharts horizontal bar için data shape: { name, bu, gecen, delta, yoyPct, isNeg }
  const data = sorted.map((f) => ({
    name: f.ad.length > 24 ? f.ad.slice(0, 23) + "…" : f.ad,
    fullName: f.ad,
    bu: f.buDonem,
    gecen: f.gecenYil,
    delta: f.delta,
    yoyPct: f.yoyPct,
    isNeg: f.delta < 0,
  }));
  // Max scale — recharts otomatik buluyor ama explicit kontrol için
  const maxVal = Math.max(...data.flatMap((d) => [d.bu, d.gecen, 1]));
  // Chart yüksekliği row sayısına göre (her satır ~28px)
  const height = Math.max(140, sorted.length * 36);

  return (
    <div className="fb-card">
      <div className="fb-title">{title}</div>
      {subtitle && <div className="fb-subtitle">{subtitle}</div>}
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 60, bottom: 4, left: 12 }}
            barCategoryGap={4}
          >
            <CartesianGrid
              strokeDasharray="2 4"
              stroke="var(--color-border)"
              horizontal={false}
            />
            <XAxis
              type="number"
              domain={[0, maxVal]}
              tickFormatter={(v) => fmt(Number(v))}
              tick={{ fontSize: 10, fill: "var(--color-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--color-fg)", fontWeight: 500 }}
              width={170}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: 6,
                fontSize: 11,
                padding: "6px 9px",
              }}
              labelStyle={{
                fontWeight: 700,
                color: "var(--color-fg)",
                marginBottom: 3,
              }}
              formatter={(value, name) => {
                const v = Number(value);
                const label = name === "bu" ? "Son 30g" : "Geçen yıl 30g";
                return [fmt(v), label];
              }}
              labelFormatter={(label, payload) => {
                const item = payload?.[0]?.payload as
                  | { fullName: string; delta: number; yoyPct: number | null }
                  | undefined;
                if (!item) return String(label);
                const deltaStr = `${item.delta >= 0 ? "+" : ""}${fmt(item.delta)} (${pct(item.yoyPct)})`;
                return `${item.fullName}\nYoY: ${deltaStr}`;
              }}
            />
            {/* Geçen yıl çubuğu — gri, arka planda (kontrast için daha koyu) */}
            <Bar dataKey="gecen" fill="var(--color-muted)" opacity={0.85} radius={[2, 2, 2, 2]}>
              {data.map((entry, i) => (
                <Cell key={`g-${i}`} fill="var(--color-muted)" opacity={0.85} />
              ))}
            </Bar>
            {/* Bu yıl çubuğu — pozitif yeşil / negatif kırmızı (vs geçen yıl) */}
            <Bar dataKey="bu" radius={[2, 2, 2, 2]}>
              {data.map((entry, i) => (
                <Cell
                  key={`b-${i}`}
                  fill={
                    entry.isNeg
                      ? "var(--color-bad)"
                      : "var(--color-good)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Delta tablosu — chart'ın altında satır satır mutlak rakam */}
      <div className="fb-deltas">
        {sorted.slice(0, 6).map((f) => (
          <div key={f.ad} className="fb-delta-row" title={f.ad}>
            <span className="fb-delta-name">{f.ad}</span>
            <span className={`fb-delta-val ${f.delta < 0 ? "neg" : "pos"}`}>
              {f.delta >= 0 ? "+" : ""}
              {fmt(f.delta)}
            </span>
            <span className={`fb-delta-pct ${f.delta < 0 ? "neg" : "pos"}`}>
              {pct(f.yoyPct)}
            </span>
          </div>
        ))}
      </div>
      <style jsx>{factorBarsCss}</style>
    </div>
  );
}

const factorBarsCss = `
.fb-card {
  background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-bg) 100%);
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fb-title {
  font-size: 11px;
  color: var(--color-accent);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 700;
}
.fb-subtitle {
  font-size: 10.5px;
  color: var(--color-fg-2);
  margin-top: -4px;
  margin-bottom: 4px;
  opacity: 0.85;
}
.fb-empty {
  font-size: 11px;
  color: var(--color-muted);
  padding: 16px 0;
  text-align: center;
}
.fb-deltas {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border);
}
.fb-delta-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
  font-size: 10.5px;
  padding: 1px 0;
}
.fb-delta-name {
  color: var(--color-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.fb-delta-val, .fb-delta-pct {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.fb-delta-val.neg, .fb-delta-pct.neg { color: var(--color-bad); }
.fb-delta-val.pos, .fb-delta-pct.pos { color: var(--color-good); }
.fb-delta-pct {
  min-width: 50px;
  text-align: right;
}
`;

// Legacy table — artık çağrılmıyor ama referans için bırakıyorum
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FactorTable({
  title,
  factors,
  fmt,
  pct,
}: {
  title: string;
  factors: Array<{
    ad: string;
    delta: number;
    yoyPct: number | null;
    contributionPct: number;
  }>;
  fmt: (n: number) => string;
  pct: (n: number | null) => string;
}) {
  if (factors.length === 0) {
    return (
      <div className="ft-card">
        <div className="ft-title">{title}</div>
        <div className="ft-empty">Veri yok</div>
        <style jsx>{factorCss}</style>
      </div>
    );
  }
  return (
    <div className="ft-card">
      <div className="ft-title">{title}</div>
      <div className="ft-rows">
        {factors.map((f) => {
          const isNeg = f.delta < 0;
          return (
            <div key={f.ad} className="ft-row">
              <div className="ft-row-name" title={f.ad}>
                {f.ad}
              </div>
              <div className={`ft-row-delta ${isNeg ? "neg" : "pos"}`}>
                {f.delta >= 0 ? "+" : ""}
                {fmt(f.delta)}
              </div>
              <div className={`ft-row-pct ${isNeg ? "neg" : "pos"}`}>
                {pct(f.yoyPct)}
              </div>
            </div>
          );
        })}
      </div>
      <style jsx>{factorCss}</style>
    </div>
  );
}

const factorCss = `
.ft-card {
  background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-bg) 100%);
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  padding: 10px 12px;
}
.ft-title {
  font-size: 10px;
  color: var(--color-accent);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 700;
  margin-bottom: 8px;
}
.ft-empty {
  font-size: 11px;
  color: var(--color-muted-2);
  padding: 8px 0;
}
.ft-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ft-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  padding: 3px 0;
  border-bottom: 1px solid var(--color-border);
}
.ft-row:last-child {
  border-bottom: none;
}
.ft-row-name {
  color: var(--color-fg-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.ft-row-delta {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 10.5px;
}
.ft-row-pct {
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
  min-width: 50px;
  text-align: right;
}
.ft-row-delta.neg, .ft-row-pct.neg { color: var(--color-bad); }
.ft-row-delta.pos, .ft-row-pct.pos { color: var(--color-good); }
`;

// ---------------------------------------------------------------------------
// Section-aware markdown renderer
// ---------------------------------------------------------------------------
//
// Gemini bazen bullet'ları "* foo\n* bar" satır satır, bazen "* foo * bar"
// tek paragrafta gönderiyor. Her iki paterni de bullet'a çevirip section
// kartına yerleştiriyoruz. Eski parser sadece `-` prefix yakalıyordu;
// `*` ile başlayan bullet'lar tek bir uzun paragraf gibi düşüyordu (kullanıcı
// raporu: "burada çok fazla yazı var").

function renderMarkdown(md: string): React.ReactNode {
  // ## başlığa göre section'lara ayır
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = "";
  let currentBody: string[] = [];
  const flush = () => {
    if (currentHeading || currentBody.join("").trim().length > 0) {
      sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
    }
    currentHeading = "";
    currentBody = [];
  };
  for (const raw of md.split("\n")) {
    if (raw.trim().startsWith("## ")) {
      flush();
      currentHeading = raw.trim().slice(3).trim();
      continue;
    }
    currentBody.push(raw);
  }
  flush();

  return (
    <div className="fa-sections">
      {sections.map((sec, i) => (
        <FinanceSection key={i} heading={sec.heading} body={sec.body} />
      ))}
    </div>
  );
}

function FinanceSection({ heading, body }: { heading: string; body: string }) {
  const icon = sectionIcon(heading);
  const bullets = parseBullets(body);
  return (
    <section className="fa-section">
      {heading && (
        <header className="fa-section-head">
          <span className="fa-section-icon">{icon}</span>
          <h3>{heading}</h3>
        </header>
      )}
      {bullets.length > 0 ? (
        <ul className="fa-section-list">
          {bullets.map((b, i) => (
            <li key={i}>{inlineFormat(b)}</li>
          ))}
        </ul>
      ) : (
        body
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => <p key={i}>{inlineFormat(p)}</p>)
      )}
    </section>
  );
}

function sectionIcon(heading: string): string {
  const h = heading.toLocaleLowerCase("tr");
  if (h.includes("özet") || h.includes("ozet")) return "📊";
  if (h.includes("kök") || h.includes("kok") || h.includes("neden")) return "🔍";
  if (h.includes("aksiyon") || h.includes("öneri") || h.includes("oneri"))
    return "🎯";
  if (h.includes("uyarı") || h.includes("uyari") || h.includes("risk"))
    return "⚠️";
  return "·";
}

/**
 * Body'yi bullet listesine çevirir. İki desen:
 *   (a) multiline:  "* foo\n* bar"
 *   (b) inline:     "* foo * bar"   (Gemini bazen tek paragrafta gönderiyor)
 * Bullet bulunamazsa boş dizi döner; caller paragraph olarak render eder.
 */
function parseBullets(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  // (a) Çok-satırlı: her dolu satır `*` veya `-` ile başlıyor mu?
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((l) => l.startsWith("* ") || l.startsWith("- "))) {
    return lines.map((l) => l.slice(2).trim());
  }

  // (b) Inline: en az 2 tane " * " marker varsa split et
  // Önce satır içi tabs/newlines'ı tek boşluğa indir
  const flat = trimmed.replace(/\s+/g, " ");
  const inlineMatches = flat.match(/(?:^|\s)\* /g) ?? [];
  if (inlineMatches.length >= 2) {
    const cleaned = flat.replace(/^\* /, "");
    return cleaned
      .split(/\s*\*\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Headline drivers — analizin başında 3 büyük etki kartı (görsel hook)
// ---------------------------------------------------------------------------

/** Hero cümle — "ORTA ANADOLU'da VODKA cirosu -%10.3 düştü; ana etken
 *  ATLAS GIDA (-2.56 M / -%53.7)" gibi tek paragraf hikaye + büyük YoY rakamı.
 *  Inline style (HMR safe). */
function HeroSentence({
  facts,
  region,
  fmt,
  pct,
}: {
  facts: FinanceFacts;
  region: string;
  fmt: (n: number) => string;
  pct: (n: number | null) => string;
}) {
  const isNeg = facts.delta < 0;
  const isFlat = Math.abs(facts.delta) < 1000 || Math.abs(facts.yoyPct ?? 0) < 1;
  const color = isFlat
    ? "var(--color-muted)"
    : isNeg
      ? "var(--color-bad)"
      : "var(--color-good)";
  // En büyük etkiyi bul — distFactors / channelFactors / productFactors'ın
  // hepsinden mutlak delta'sı en büyük olan
  type Driver = { kind: string; ad: string; delta: number; yoyPct: number | null };
  const productKind = facts.productGroup ? "SKU" : "ürün grubu";
  const allDrivers: Driver[] = [
    ...facts.distFactors.map((f) => ({
      kind: "distribütör",
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
    })),
    ...facts.channelFactors.map((f) => ({
      kind: "müşteri grubu",
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
    })),
    ...facts.productFactors.map((f) => ({
      kind: productKind,
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
    })),
  ];
  // Hikayenin yönüyle aynı işaretli olan en büyük etki ana faktörü
  const sameDirection = allDrivers
    .filter((d) => Math.abs(d.delta) > 0 && (isNeg ? d.delta < 0 : d.delta > 0))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const trendWord = isFlat ? "yatay seyretti" : isNeg ? "düştü" : "büyüdü";
  const scopeText = facts.productGroup
    ? `bölgesinde ${facts.productGroup} ürün grubu cirosu`
    : `bölgesi cirosu`;

  return (
    <div
      style={{
        padding: "14px 18px",
        background:
          "linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-2) 100%)",
        border: "1px solid var(--color-border-strong)",
        borderLeft: `4px solid ${color}`,
        borderRadius: 10,
        marginBottom: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          fontWeight: 700,
        }}
      >
        Hikâye
      </div>
      <div
        style={{
          fontSize: 14.5,
          lineHeight: 1.55,
          color: "var(--color-fg)",
        }}
      >
        <strong>{region}</strong> {scopeText}, son 30 günde geçen yıl aynı 30
        güne göre{" "}
        <strong style={{ color, fontVariantNumeric: "tabular-nums" }}>
          {pct(facts.yoyPct)}
        </strong>{" "}
        {trendWord}{" "}
        <span
          style={{
            color: "var(--color-fg-2)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 500,
          }}
        >
          ({facts.delta >= 0 ? "+" : ""}
          {fmt(facts.delta)} mutlak — {fmt(facts.buDonem)} vs{" "}
          {fmt(facts.gecenYil)})
        </span>
        {sameDirection ? (
          <>
            {". "}
            Ana etken{" "}
            <strong>{sameDirection.ad}</strong> {sameDirection.kind}{" "}
            <span
              style={{
                color,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
              }}
            >
              ({sameDirection.delta >= 0 ? "+" : ""}
              {fmt(sameDirection.delta)} · {pct(sameDirection.yoyPct)})
            </span>
            <span
              style={{ color: "var(--color-muted)", fontWeight: 500 }}
            >
              {" "}
              · detaylar aşağıdaki grafiklerde.
            </span>
          </>
        ) : (
          <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>
            {" "}
            · detaylar aşağıdaki grafiklerde.
          </span>
        )}
      </div>
    </div>
  );
}

// Legacy — TopDriversSummary HeroSentence ile değiştirildi, referans için bırakıyorum.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TopDriversSummary({
  facts,
  fmt,
  pct,
}: {
  facts: FinanceFacts;
  fmt: (n: number) => string;
  pct: (n: number | null) => string;
}) {
  const productKind = facts.productGroup ? "SKU" : "Ürün";
  type Item = {
    kind: string;
    ad: string;
    delta: number;
    yoyPct: number | null;
    buDonem: number;
    gecenYil: number;
  };
  const all: Item[] = [
    ...facts.distFactors.map((f) => ({
      kind: "Dist",
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
      buDonem: f.buDonem,
      gecenYil: f.gecenYil,
    })),
    ...facts.channelFactors.map((f) => ({
      kind: "Müş.grp",
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
      buDonem: f.buDonem,
      gecenYil: f.gecenYil,
    })),
    ...facts.productFactors.map((f) => ({
      kind: productKind,
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
      buDonem: f.buDonem,
      gecenYil: f.gecenYil,
    })),
  ];
  const top = all
    .filter((f) => Math.abs(f.delta) > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        background: "var(--color-surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--color-accent)",
          textTransform: "uppercase",
          letterSpacing: "0.6px",
          fontWeight: 700,
        }}
      >
        En büyük 3 itki{" "}
        <span
          style={{
            color: "var(--color-muted-2)",
            textTransform: "none",
            letterSpacing: "normal",
            fontWeight: 400,
            fontStyle: "italic",
            fontSize: 9.5,
          }}
        >
          · son 30g vs geçen yıl aynı 30g · |delta| sıralı · detay alttaki
          grafiklerde
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {top.map((it, i) => {
          const isNeg = it.delta < 0;
          const color = isNeg ? "var(--color-bad)" : "var(--color-good)";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "8px 12px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border-strong)",
                borderLeft: `3px solid ${color}`,
                borderRadius: 6,
                minWidth: 180,
                flex: "1 1 200px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--color-muted-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    fontWeight: 600,
                  }}
                >
                  {it.kind}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {it.delta >= 0 ? "+" : ""}
                  {fmt(it.delta)} · {pct(it.yoyPct)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--color-fg)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={it.ad}
              >
                {it.ad}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  color: "var(--color-muted-2)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ color: "var(--color-fg-2)", fontWeight: 600 }}>
                  {fmt(it.buDonem)}
                </span>
                <span style={{ fontSize: 9 }}>bu 30g</span>
                <span style={{ opacity: 0.5 }}>•</span>
                <span style={{ color: "var(--color-muted)", fontWeight: 600 }}>
                  {fmt(it.gecenYil)}
                </span>
                <span style={{ fontSize: 9 }}>geçen yıl</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Legacy — artık çağrılmıyor (TopDriversSummary devraldı). Referans için.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function HeadlineDrivers({
  facts,
  fmt,
  pct,
}: {
  facts: FinanceFacts;
  fmt: (n: number) => string;
  pct: (n: number | null) => string;
}) {
  type Item = {
    kind: string;
    ad: string;
    delta: number;
    yoyPct: number | null;
    buDonem: number;
    gecenYil: number;
  };
  const productKind = facts.productGroup ? "SKU" : "Ürün";
  const all: Item[] = [
    ...facts.distFactors.map((f) => ({
      kind: "Distribütör",
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
      buDonem: f.buDonem,
      gecenYil: f.gecenYil,
    })),
    ...facts.channelFactors.map((f) => ({
      kind: "Müşteri Grubu",
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
      buDonem: f.buDonem,
      gecenYil: f.gecenYil,
    })),
    ...facts.productFactors.map((f) => ({
      kind: productKind,
      ad: f.ad,
      delta: f.delta,
      yoyPct: f.yoyPct,
      buDonem: f.buDonem,
      gecenYil: f.gecenYil,
    })),
  ];
  const top = all
    .filter((f) => Math.abs(f.delta) > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="fa-headline">
      <div className="fa-headline-label">
        En büyük etkiler{" "}
        <span className="fa-headline-base">
          · son 30g vs geçen yıl aynı 30g, |delta| sıralı
        </span>
      </div>
      <div className="fa-headline-row">
        {top.map((it, i) => (
          <div
            key={i}
            className={`fa-headline-card ${it.delta >= 0 ? "pos" : "neg"}`}
          >
            <div className="fa-headline-meta">{it.kind}</div>
            <div className="fa-headline-name" title={it.ad}>
              {it.ad}
            </div>
            <div className="fa-headline-stats">
              <span className="fa-headline-delta">
                {it.delta >= 0 ? "+" : ""}
                {fmt(it.delta)}
              </span>
              <span className="fa-headline-pct">{pct(it.yoyPct)}</span>
            </div>
            <div className="fa-headline-compare">
              <span className="fa-headline-cmp-bu">
                <strong>{fmt(it.buDonem)}</strong>
                <span className="fa-headline-cmp-lab">bu 30g</span>
              </span>
              <span className="fa-headline-cmp-vs">vs</span>
              <span className="fa-headline-cmp-gecen">
                <strong>{fmt(it.gecenYil)}</strong>
                <span className="fa-headline-cmp-lab">geçen yıl</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function inlineFormat(s: string): React.ReactNode {
  // **bold** → <strong>, geri kalan plain text
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(s)) !== null) {
    if (m.index > lastIdx) parts.push(s.slice(lastIdx, m.index));
    parts.push(<strong key={`s-${m.index}`}>{m[1]}</strong>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < s.length) parts.push(s.slice(lastIdx));
  return parts.length > 0 ? parts : s;
}
