"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { VISIT_ORDER_TIER_COLORS, VISIT_ORDER_TIER_LABELS, VISIT_ORDER_TIER_LABELS_EN, VISIT_ORDER_TIER_ORDER } from "./types";
import { t, type Locale } from "@/lib/i18n";

const RISK_WINDOW_OPTIONS = [30, 60, 90] as const;
type RiskWindowDays = (typeof RISK_WINDOW_OPTIONS)[number];
type VisitOrderRiskTier = (typeof VISIT_ORDER_TIER_ORDER)[number];

type Props = {
  priority: "visit" | "order";
  tiersInScope: VisitOrderRiskTier[];
  windowDays: RiskWindowDays;
  /** Her tier'ın müşteri adedi (seçili pencere) — chip'te ve toplam sayaçta gösterilir. */
  tierCounts?: Partial<Record<VisitOrderRiskTier, number>>;
  /** Seçili (risk sayılan) tier'lardaki toplam müşteri — kontrolün görünür çıktısı. */
  riskCount?: number;
  locale?: Locale;
};

/**
 * Madde 13(c)(d) — "visit-order" risk modeli (Wietnauer) ekran-bazlı config:
 * öncelik (Ziyaret/Sipariş) + risk sayılan tier'lar + pencere (30/60/90g).
 * AYNI URL param'ları haritayla paylaşılır (`riskPriority`, `riskTiersInScope`)
 * — iki ekran arasında deep-link geçişte config kaybolmaz, tutarlı davranış.
 * `riskWindowDays` yalnız bu ekranda var (haritada dönem zaten üstteki
 * `activityDays` seçicisinden geliyor).
 *
 * `page.tsx` bu 3 param'ı okuyup `/api/map/customers`'tan LİVE risk tier
 * dağılımı hesaplar (bkz. page.tsx yorumu) — burası yalnız URL-state yazar,
 * veri çekme server component'te.
 */
export function RiskConfigBar({ priority, tiersInScope, windowDays, tierCounts, riskCount, locale = "tr" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const tierLabels = locale === "en" ? VISIT_ORDER_TIER_LABELS_EN : VISIT_ORDER_TIER_LABELS;
  const nf = (n: number) => n.toLocaleString(locale === "en" ? "en-US" : "tr-TR");

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    startTransition(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    });
  }

  function toggleTier(tier: VisitOrderRiskTier) {
    const next = tiersInScope.includes(tier)
      ? tiersInScope.filter((x) => x !== tier)
      : [...tiersInScope, tier];
    if (next.length === 0) return; // en az 1 tier seçili kalmalı
    update({ riskTiersInScope: next.join(",") });
  }

  return (
    <div className="risk-config-bar">
      <div className="rcb-title">{t(locale, "risk.vo.config.title", "Risk Konfigürasyonu")}</div>

      <div className="rcb-field">
        <label htmlFor="risk-config-priority" className="rcb-label">
          {t(locale, "risk.vo.config.priority", "Öncelik")}
        </label>
        <select
          id="risk-config-priority"
          value={priority}
          onChange={(e) => update({ riskPriority: e.target.value })}
          disabled={isPending}
          className="rcb-select"
        >
          <option value="visit">{t(locale, "risk.vo.config.priority.visit", "Ziyaret")}</option>
          <option value="order">{t(locale, "risk.vo.config.priority.order", "Sipariş")}</option>
        </select>
      </div>

      <div className="rcb-field">
        <label htmlFor="risk-config-window" className="rcb-label">
          {t(locale, "risk.vo.config.window", "Pencere")}
        </label>
        <select
          id="risk-config-window"
          value={windowDays}
          onChange={(e) => update({ riskWindowDays: e.target.value })}
          disabled={isPending}
          className="rcb-select"
        >
          {RISK_WINDOW_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}{t(locale, "map.day_suffix", "g")}
            </option>
          ))}
        </select>
      </div>

      <div className="rcb-field rcb-field-tiers">
        <div className="rcb-label" id="risk-config-tiers-label">
          {t(locale, "risk.vo.config.tiers", "Risk sayılan tier'lar")}
        </div>
        <div className="rcb-tiers" role="group" aria-labelledby="risk-config-tiers-label">
          {VISIT_ORDER_TIER_ORDER.map((tier) => (
            <label key={tier} className="rcb-tier-chip">
              <input
                type="checkbox"
                checked={tiersInScope.includes(tier)}
                onChange={() => toggleTier(tier)}
                disabled={isPending}
              />
              <span className="rcb-tier-dot" style={{ background: VISIT_ORDER_TIER_COLORS[tier] }} />
              {tierLabels[tier]}
              {tierCounts?.[tier] != null && (
                <span className="rcb-tier-count">{nf(tierCounts[tier] as number)}</span>
              )}
            </label>
          ))}
        </div>
      </div>

      {riskCount != null && (
        <div className="rcb-field rcb-riskcount-field">
          <div className="rcb-label">{t(locale, "risk.vo.config.risk_count_label", "Risk müşterisi")}</div>
          <div className="rcb-riskcount">{nf(riskCount)}</div>
        </div>
      )}

      <div className="rcb-hint">{t(locale, "risk.vo.config.hint", "Seçili tier'lar \"risk\" sayılır — toplam yandaki sayaçta. Öncelik en riskli eksik sinyali (ziyaret ya da sipariş) belirler; pencere haritayla aynı dönemi kullanır.")}</div>
      {isPending && <span className="rcb-loading">{t(locale, "donem.loading", "yükleniyor…")}</span>}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .risk-config-bar {
          display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap;
          padding: 12px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 16px;
        }
        .rcb-title {
          font-size: 11px; font-weight: 600; color: var(--color-muted);
          text-transform: uppercase; letter-spacing: 0.04em;
          flex-basis: 100%;
        }
        .rcb-field { display: flex; flex-direction: column; gap: 4px; }
        .rcb-label {
          font-size: 10.5px; color: var(--color-muted); font-weight: 600;
        }
        .rcb-select {
          padding: 6px 10px;
          font-size: 12.5px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-fg);
          font-family: inherit;
          cursor: pointer;
          min-width: 110px;
        }
        .rcb-select:focus {
          outline: 2px solid var(--color-accent);
          outline-offset: 1px;
        }
        .rcb-tiers { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 2px; }
        .rcb-tier-chip {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 12px; color: var(--color-fg-2);
          cursor: pointer; white-space: nowrap;
        }
        .rcb-tier-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .rcb-tier-count {
          font-variant-numeric: tabular-nums; font-weight: 600;
          color: var(--color-fg); font-size: 11.5px; margin-left: 1px;
        }
        .rcb-riskcount-field { align-items: flex-start; }
        .rcb-riskcount {
          font-size: 20px; font-weight: 800; color: var(--color-bad, #dc2626);
          font-variant-numeric: tabular-nums; letter-spacing: -0.02em; line-height: 1.1;
        }
        .rcb-hint {
          font-size: 11px; color: var(--color-muted); font-style: italic;
          flex-basis: 100%;
        }
        .rcb-loading { font-size: 11px; color: var(--color-muted); font-style: italic; }
      `,
        }}
      />
    </div>
  );
}
