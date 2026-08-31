"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { AllowedDistributor } from "@/lib/api";

type Props = {
  distributors: AllowedDistributor[];
  selectedDistId: number | null;
};

/**
 * md43 — Aktivasyon & Risk dropdown'u — distribütör filtresi. Seçim URL'e
 * (`?distId=X`) yazılır, sayfa RSC olarak yeniden render olur, seçili dist'in
 * aktif/sessiz/risk-tier/recovery kırılımı gelir. "Tümü" portföy toplamını
 * gösterir. Pattern `StokDistSelect` (md38) / `IskontoFilterBar`'ın (md?)
 * dist-select kısmıyla birebir aynı; liste kaynağı `getAllowedDistributors()`
 * (`/api/auth/distributors` — Panorama tabanlı izinli dist kümesi), o da
 * ticari-yatırım (iskonto) sayfasının kullandığı aynı, önceden var olan
 * kaynak. Yeni endpoint eklenmedi.
 */
export function AktivasyonDistSelect({ distributors, selectedDistId }: Props) {
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

  if (distributors.length === 0) return null;

  return (
    <div className="aktivasyon-dist-select">
      <label htmlFor="aktivasyon-dist-select" className="lbl">
        Distribütör
      </label>
      <select
        id="aktivasyon-dist-select"
        value={selectedDistId ?? "all"}
        onChange={onChange}
        disabled={isPending}
        className="sel"
      >
        <option value="all">Tümü — portföy toplamı</option>
        {distributors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.ad}
          </option>
        ))}
      </select>
      {isPending && <span className="loading">yükleniyor…</span>}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .aktivasyon-dist-select {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .aktivasyon-dist-select .lbl {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .aktivasyon-dist-select .sel {
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
        .aktivasyon-dist-select .sel:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .aktivasyon-dist-select .sel:focus {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }
        .aktivasyon-dist-select .loading {
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
