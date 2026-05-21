"use client";

import { useEffect, useState } from "react";
import { FinanceAgentModal } from "./FinanceAgentModal";

type Region = { bolge: string; deltaPct: number | null };

type Props = {
  regions: Region[];
};

/**
 * Dış trigger sözleşmesi — Komuta SVG blob'u veya heatmap cell'inden
 * fire edilir; launcher dinler ve modal'ı doğrudan açar.
 */
export type OpenFinanceAgentDetail = {
  region: string;
  productGroup?: string;
};

const OPEN_EVENT = "enroute:open-finance-agent";
const REGION_ATTR = "data-finance-region";
const PRODUCT_ATTR = "data-finance-product-group";

/**
 * Map panelinin yanına yerleştirilen client island. Bir buton render eder;
 * tıklayınca anomaly listesi üzerinden bölge seçilir → FinanceAgentModal
 * açılır.
 *
 * Direkt SVG'deki bölgeleri tıklatamadığımız için (Map server component
 * içinde) bu launcher en pratik trigger.
 */
export function FinanceAgentLauncher({ regions }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [productGroup, setProductGroup] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 1) Window event listener — başka bir component (heatmap cell client wrapper,
  //    test harness, vb.) doğrudan event dispatch ederek modal açabilsin.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenFinanceAgentDetail>).detail;
      if (!detail || typeof detail.region !== "string" || !detail.region) return;
      setSelected(detail.region);
      setProductGroup(
        typeof detail.productGroup === "string" && detail.productGroup
          ? detail.productGroup
          : undefined,
      );
      setPickerOpen(false);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  // 2) Document delegation — server-rendered SVG blob ve heatmap cell'leri
  //    React onClick veremediği için (RSC), data-finance-region attribute'unu
  //    arıyoruz. closest() iç içe SVG <g> / div'lerden doğru elementi bulur.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      const el = target.closest(`[${REGION_ATTR}]`);
      if (!el) return;
      const r = el.getAttribute(REGION_ATTR);
      if (!r) return;
      const pg = el.getAttribute(PRODUCT_ATTR);
      window.dispatchEvent(
        new CustomEvent<OpenFinanceAgentDetail>(OPEN_EVENT, {
          detail: { region: r, productGroup: pg ?? undefined },
        }),
      );
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Önce anomaliler (deltaPct < -5 veya null), sonra geri kalanı delta'ya göre
  const sorted = [...regions].sort((a, b) => {
    const da = a.deltaPct ?? -999;
    const db = b.deltaPct ?? -999;
    return da - db; // en negatif en üstte
  });

  return (
    <>
      <button
        type="button"
        className="fa-launcher-btn"
        onClick={() => setPickerOpen((v) => !v)}
        title="Finans agentı ile bölge analizi"
      >
        💼 Finans Agentı
      </button>

      {pickerOpen && (
        <div
          className="fa-picker-backdrop"
          onClick={() => setPickerOpen(false)}
        >
          <div className="fa-picker" onClick={(e) => e.stopPropagation()}>
            <div className="fa-picker-header">
              <strong>Analiz edilecek bölgeyi seç</strong>
              <button
                type="button"
                className="fa-picker-close"
                onClick={() => setPickerOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="fa-picker-hint">
              Anomaliler (kırmızı) en üstte. Tıklayınca finans agentı YoY
              decompose eder.
            </div>
            <div className="fa-picker-list">
              {sorted.map((r) => {
                const d = r.deltaPct;
                const tone =
                  d == null ? "muted"
                    : d <= -5 ? "neg"
                    : d >= 15 ? "pos"
                    : "muted";
                return (
                  <button
                    key={r.bolge}
                    type="button"
                    className={`fa-picker-row tone-${tone}`}
                    onClick={() => {
                      setSelected(r.bolge);
                      // Picker'dan açılışta ürün grubu bağlamı yok — temizle
                      setProductGroup(undefined);
                      setPickerOpen(false);
                    }}
                  >
                    <span className="fa-picker-name">{r.bolge}</span>
                    <span className="fa-picker-delta">
                      {d == null
                        ? "—"
                        : `${d >= 0 ? "+" : ""}${d.toFixed(0)}% YoY`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <FinanceAgentModal
        region={selected}
        productGroup={productGroup}
        onClose={() => {
          setSelected(null);
          setProductGroup(undefined);
        }}
      />

      <style jsx>{`
        .fa-launcher-btn {
          background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-hover) 100%);
          color: var(--color-accent-fg);
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.2px;
          box-shadow: 0 2px 6px rgba(99, 102, 241, 0.25);
        }
        .fa-launcher-btn:hover {
          background: linear-gradient(135deg, #818cf8 0%, #4338ca 100%);
        }
        .fa-picker-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(28, 25, 23, 0.6);
          z-index: 150;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .fa-picker {
          background: var(--color-surface);
          border: 1px solid var(--color-border-strong);
          border-radius: 10px;
          width: min(420px, 90vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          color: var(--color-fg);
          font-family:
            -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
        }
        .fa-picker-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
          font-size: 13px;
        }
        .fa-picker-close {
          background: transparent;
          border: none;
          color: var(--color-muted);
          font-size: 20px;
          cursor: pointer;
          line-height: 1;
        }
        .fa-picker-hint {
          padding: 10px 16px 6px 16px;
          font-size: 11px;
          color: var(--color-muted);
        }
        .fa-picker-list {
          padding: 6px 12px 12px 12px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .fa-picker-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 10px;
          background: var(--color-surface);
          border: 1px solid var(--color-border-strong);
          border-radius: 6px;
          cursor: pointer;
          color: var(--color-fg-2);
          font-size: 12px;
          text-align: left;
        }
        .fa-picker-row:hover {
          background: var(--color-surface-2);
          border-color: var(--color-accent);
        }
        .fa-picker-row.tone-neg .fa-picker-delta { color: var(--color-bad); font-weight: 700; }
        .fa-picker-row.tone-pos .fa-picker-delta { color: var(--color-good); font-weight: 700; }
        .fa-picker-row.tone-muted .fa-picker-delta { color: var(--color-muted); }
        .fa-picker-name {
          font-weight: 500;
        }
      `}</style>
    </>
  );
}
