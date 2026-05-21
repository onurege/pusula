"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  getFinanceAnalysis,
  type FinanceAnalysis,
  type FinanceFacts,
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
    getFinanceAnalysis(region, { refresh: refreshNonce > 0 })
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
  }, [region, refreshNonce]);

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
  // URLSearchParams ile encode et; "İç Anadolu" gibi TR karakterleri elle
  // birleştirmek yerine tek noktadan geçsin.
  const mapHrefParams = new URLSearchParams();
  if (region) mapHrefParams.set("bolge", region);
  mapHrefParams.set("riskTier", "high");
  const mapHref = `/map?${mapHrefParams.toString()}`;

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
              {/* Üst KPI strip */}
              <div className="fa-kpi-row">
                <div className="fa-kpi">
                  <div className="fa-kpi-label">Son 30g</div>
                  <div className="fa-kpi-val">{fmt(data.facts.buDonem)}</div>
                </div>
                <div className="fa-kpi">
                  <div className="fa-kpi-label">Geçen yıl 30g</div>
                  <div className="fa-kpi-val muted">{fmt(data.facts.gecenYil)}</div>
                </div>
                <div className="fa-kpi">
                  <div className="fa-kpi-label">YoY delta</div>
                  <div
                    className={`fa-kpi-val ${data.facts.delta < 0 ? "neg" : "pos"}`}
                  >
                    {data.facts.delta >= 0 ? "+" : ""}
                    {fmt(data.facts.delta)}
                  </div>
                </div>
                <div className="fa-kpi">
                  <div className="fa-kpi-label">YoY %</div>
                  <div
                    className={`fa-kpi-val ${
                      (data.facts.yoyPct ?? 0) < 0 ? "neg" : "pos"
                    }`}
                  >
                    {pct(data.facts.yoyPct)}
                  </div>
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
                </div>
                <div className="fa-kpi">
                  <div className="fa-kpi-label">Kayıp müşteri</div>
                  <div className="fa-kpi-val neg">
                    {data.facts.customers.kaybedilen}
                  </div>
                </div>
              </div>

              {/* En büyük etkiler — Gemini analizinin önüne görsel hook.
                  Distribütör/müşteri/ürün faktörlerinin tümünden mutlak
                  delta'ya göre top 3'ü çıkarır; pozitif yeşil, negatif kırmızı
                  border ile vurgular. */}
              <HeadlineDrivers facts={data.facts} fmt={fmt} pct={pct} />

              {/* Section-aware markdown render — her ## başlık ayrı kart */}
              {renderMarkdown(data.markdown)}

              {/* Decomposition tabloları */}
              <div className="fa-tables">
                <FactorTable
                  title="Distribütör Kırılımı"
                  factors={data.facts.distFactors.slice(0, 6)}
                  fmt={fmt}
                  pct={pct}
                />
                <FactorTable
                  title="Müşteri Grubu Kırılımı"
                  factors={data.facts.channelFactors.slice(0, 6)}
                  fmt={fmt}
                  pct={pct}
                />
                <FactorTable
                  title="Ürün Grubu Kırılımı"
                  factors={data.facts.productFactors.slice(0, 6)}
                  fmt={fmt}
                  pct={pct}
                />
              </div>

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
        .fa-kpi {
          background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-bg) 100%);
          border: 1px solid var(--color-border-strong);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .fa-kpi-label {
          font-size: 9.5px;
          color: var(--color-muted-2);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .fa-kpi-val {
          margin-top: 4px;
          font-size: 14px;
          font-weight: 700;
          color: var(--color-fg);
        }
        .fa-kpi-val.muted {
          color: var(--color-muted);
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
          font-size: 10px;
          color: var(--color-muted-2);
          text-align: right;
          margin-top: 6px;
        }
        .fa-subcontext {
          margin-top: 4px;
          font-size: 11.5px;
          color: var(--color-muted);
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
  };
  const all: Item[] = [
    ...facts.distFactors.map((f) => ({ kind: "Distribütör", ad: f.ad, delta: f.delta, yoyPct: f.yoyPct })),
    ...facts.channelFactors.map((f) => ({ kind: "Müşteri Grubu", ad: f.ad, delta: f.delta, yoyPct: f.yoyPct })),
    ...facts.productFactors.map((f) => ({ kind: "Ürün", ad: f.ad, delta: f.delta, yoyPct: f.yoyPct })),
  ];
  const top = all
    .filter((f) => Math.abs(f.delta) > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="fa-headline">
      <div className="fa-headline-label">En büyük etkiler</div>
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
