"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { AllowedDistributor } from "@/lib/api";

type Props = {
  distributors: AllowedDistributor[];
  selectedDistId: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Tarih aralığı alanını göster. Dönem seçimi artık ortak GlobalDonemFilter'a
   *  devredildiğinde `false` verilir; yalnız distribütör seçici kalır. */
  showDateRange?: boolean;
};

/**
 * Ticari Yatırım & İskonto filtre çubuğu — tarih aralığı + distribütör.
 * Seçimler URL'e (`?from&to&distId`) yazılır, sayfa RSC olarak yeniden
 * render olur; `getWietnauerIskontoSnapshot` opts'una akar (stok-tukenme
 * `StokDistSelect` deseniyle aynı: URL = tek doğruluk kaynağı, sayfa
 * yenilemesi RSC drill-down).
 *
 * Tarih inputları controlled local state'te tutulur (`fromDraft`/`toDraft`);
 * her tuş vuruşunda navigasyon tetiklenmez — yalnız "Uygula" ile. İkisi de
 * doluysa aralık uygulanır; biri eksikse görmezden gelinir (backend'in
 * `normalizeDateRange` davranışıyla tutarlı).
 */
export function IskontoFilterBar({ distributors, selectedDistId, dateFrom, dateTo, showDateRange = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [fromDraft, setFromDraft] = useState(dateFrom ?? "");
  const [toDraft, setToDraft] = useState(dateTo ?? "");

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    mutate(params);
    const qs = params.toString();
    startTransition(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    });
  }

  function onDistChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    navigate((params) => {
      if (val === "" || val === "all") params.delete("distId");
      else params.set("distId", val);
    });
  }

  function onApplyRange(e: React.FormEvent) {
    e.preventDefault();
    const f = fromDraft.trim();
    const t = toDraft.trim();
    navigate((params) => {
      if (f && t) {
        params.set("from", f);
        params.set("to", t);
      } else {
        params.delete("from");
        params.delete("to");
      }
    });
  }

  function onClearRange() {
    setFromDraft("");
    setToDraft("");
    navigate((params) => {
      params.delete("from");
      params.delete("to");
    });
  }

  const hasRange = Boolean(dateFrom && dateTo);
  const rangeValid = Boolean(fromDraft && toDraft && fromDraft <= toDraft);

  return (
    <div className="iskonto-filterbar">
      <div className="iskonto-filter-field">
        <label htmlFor="iskonto-dist-select" className="lbl">
          Distribütör
        </label>
        <select
          id="iskonto-dist-select"
          value={selectedDistId ?? "all"}
          onChange={onDistChange}
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
      </div>

      {showDateRange && (
      <form className="iskonto-filter-field iskonto-date-field" onSubmit={onApplyRange}>
        <label htmlFor="iskonto-from" className="lbl">
          Tarih Aralığı
        </label>
        <div className="iskonto-date-row">
          <input
            id="iskonto-from"
            type="date"
            value={fromDraft}
            max={toDraft || undefined}
            onChange={(e) => setFromDraft(e.target.value)}
            className="date-input"
            aria-label="Başlangıç tarihi"
          />
          <span className="sep">–</span>
          <input
            id="iskonto-to"
            type="date"
            value={toDraft}
            min={fromDraft || undefined}
            onChange={(e) => setToDraft(e.target.value)}
            className="date-input"
            aria-label="Bitiş tarihi"
          />
          <button type="submit" className="btn-apply" disabled={isPending || !rangeValid}>
            Uygula
          </button>
          {hasRange && (
            <button type="button" className="btn-clear" onClick={onClearRange} disabled={isPending}>
              Varsayılana dön
            </button>
          )}
        </div>
      </form>
      )}

      {isPending && <span className="loading">yükleniyor…</span>}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .iskonto-filterbar {
          display: flex;
          align-items: flex-end;
          gap: 20px;
          flex-wrap: wrap;
          padding: 12px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 16px;
        }
        .iskonto-filter-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .iskonto-filterbar .lbl {
          font-size: 10.5px;
          font-weight: 650;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .iskonto-filterbar .sel {
          min-width: 240px;
          padding: 7px 10px;
          font-size: 13px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-fg);
          font-family: inherit;
          cursor: pointer;
        }
        .iskonto-date-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .iskonto-filterbar .date-input {
          padding: 6px 8px;
          font-size: 12.5px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-fg);
          font-family: inherit;
        }
        .iskonto-filterbar .sep { color: var(--color-muted); font-size: 12px; }
        .iskonto-filterbar .btn-apply,
        .iskonto-filterbar .btn-clear {
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
        .iskonto-filterbar .btn-apply {
          background: var(--color-accent);
          color: var(--color-on-accent, #fff);
          border: 1px solid var(--color-accent);
        }
        .iskonto-filterbar .btn-apply:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .iskonto-filterbar .btn-clear {
          background: var(--color-surface);
          color: var(--color-muted);
          border: 1px solid var(--color-border);
        }
        .iskonto-filterbar .sel:disabled,
        .iskonto-filterbar .date-input:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .iskonto-filterbar .sel:focus,
        .iskonto-filterbar .date-input:focus {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }
        .iskonto-filterbar .loading {
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
