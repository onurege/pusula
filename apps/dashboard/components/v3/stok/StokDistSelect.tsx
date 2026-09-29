"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { WietnauerStockDistributorSummary } from "@/lib/api";
import { t, type Locale } from "@/lib/i18n";

type Props = {
  distributors: WietnauerStockDistributorSummary[];
  selectedDistId: number | null;
  locale?: Locale;
};

/**
 * Stok Tükenme dropdown'u — distribütör seçimi. Seçim URL'e (`?distId=X`)
 * yazılır, sayfa RSC olarak yeniden render olur, seçili dist'in kırılımı
 * gelir. "Tümü" seçeneği portföy toplamını gösterir.
 *
 * Distribütörler kritik+risk sayısına göre azalan sırada gelir; kullanıcı
 * ilk açtığında en yüksek risk taşıyan dist'i görür.
 */
export function StokDistSelect({ distributors, selectedDistId, locale = "tr" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (val === "" || val === "all") {
      params.delete("distId");
    } else {
      params.set("distId", val);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    });
  }

  const totalCritical = distributors.reduce((sum, d) => sum + d.criticalCount + d.riskCount, 0);

  return (
    <div className="stok-dist-select">
      <label htmlFor="dist-select" className="lbl">
        {t(locale, "col.distributor", "Distribütör")}
      </label>
      <select
        id="dist-select"
        value={selectedDistId ?? "all"}
        onChange={onChange}
        disabled={isPending}
        className="sel"
      >
        <option value="all">
          {locale === "en"
            ? `All — portfolio total (${totalCritical} critical+risk)`
            : `Tümü — portföy toplamı (${totalCritical} kritik+risk)`}
        </option>
        {distributors.map((d) => {
          const alarm = d.criticalCount + d.riskCount;
          const regionTxt = d.region ? ` · ${d.region}` : "";
          return (
            <option key={d.distId} value={d.distId}>
              {d.distName}
              {regionTxt}
              {" — "}
              {alarm > 0
                ? `${alarm} ${locale === "en" ? "critical+risk" : "kritik+risk"}`
                : locale === "en" ? "healthy" : "sağlıklı"}
              {" · "}
              {d.skuCount} SKU
            </option>
          );
        })}
      </select>
      {isPending && <span className="loading">{t(locale, "donem.loading", "yükleniyor…")}</span>}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .stok-dist-select {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .stok-dist-select .lbl {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .stok-dist-select .sel {
          flex: 1;
          min-width: 260px;
          padding: 8px 12px;
          font-size: 13px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-fg);
          font-family: inherit;
          cursor: pointer;
        }
        .stok-dist-select .sel:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .stok-dist-select .sel:focus {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }
        .stok-dist-select .loading {
          font-size: 11px;
          color: var(--color-muted);
          font-style: italic;
        }
      `,
        }}
      />
    </div>
  );
}
