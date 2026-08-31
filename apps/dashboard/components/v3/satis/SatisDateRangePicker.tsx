"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  /** Sunucudan doğrulanmış (server.ts `parseDateRange`) aktif aralık — yoksa null. */
  dateFrom: string | null;
  dateTo: string | null;
};

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * md21 — Satış Performansı tarih aralığı seçici.
 *
 * `StokDistSelect` (`components/v3/stok/StokDistSelect.tsx`) deseniyle aynı:
 * seçim URL'e (`?from=YYYY-MM-DD&to=YYYY-MM-DD`) yazılır, sayfa RSC olarak
 * yeniden render olur. Diğer query param'lar (`unit` vb.) korunur. "Son
 * 30g'e dön" ile `from`/`to` temizlenir → backend varsayılan (bugüne bağıl
 * son 30g) pencereye düşer.
 */
export function SatisDateRangePicker({ dateFrom, dateTo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(dateFrom ?? "");
  const [to, setTo] = useState(dateTo ?? "");

  const validFrom = DATE_RX.test(from);
  const validTo = DATE_RX.test(to);
  const invalidRange = validFrom && validTo && from > to;
  const canApply = validFrom && validTo && !invalidRange;
  const hasCustomRange = Boolean(dateFrom && dateTo);

  function navigate(next: { from: string | null; to: string | null }) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next.from) params.set("from", next.from);
    else params.delete("from");
    if (next.to) params.set("to", next.to);
    else params.delete("to");
    const qs = params.toString();
    startTransition(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    });
  }

  function apply() {
    if (!canApply) return;
    navigate({ from, to });
  }

  function reset() {
    setFrom("");
    setTo("");
    navigate({ from: null, to: null });
  }

  return (
    <div className="satis-date-range">
      <label className="lbl" htmlFor="satis-date-from">
        Tarih Aralığı
      </label>
      <input
        id="satis-date-from"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => setFrom(e.target.value)}
        disabled={isPending}
        className="inp"
        aria-label="Başlangıç tarihi"
      />
      <span className="sep">–</span>
      <input
        id="satis-date-to"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => setTo(e.target.value)}
        disabled={isPending}
        className="inp"
        aria-label="Bitiş tarihi"
      />
      <button type="button" className="btn" onClick={apply} disabled={isPending || !canApply}>
        Uygula
      </button>
      {hasCustomRange && (
        <button type="button" className="btn btn-ghost" onClick={reset} disabled={isPending}>
          Son 30g&apos;e dön
        </button>
      )}
      {invalidRange && <span className="err">Başlangıç, bitişten sonra olamaz.</span>}
      {isPending && <span className="loading">yükleniyor…</span>}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .satis-date-range {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .satis-date-range .lbl {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .satis-date-range .inp {
          padding: 7px 10px;
          font-size: 13px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-fg);
          font-family: inherit;
        }
        .satis-date-range .inp:disabled { opacity: 0.6; cursor: wait; }
        .satis-date-range .inp:focus {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }
        .satis-date-range .sep { color: var(--color-muted-2); }
        .satis-date-range .btn {
          padding: 7px 12px;
          font-size: 12.5px;
          font-weight: 600;
          background: var(--color-accent);
          color: var(--color-accent-fg, #fff);
          border: 1px solid var(--color-accent);
          border-radius: 6px;
          cursor: pointer;
        }
        .satis-date-range .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .satis-date-range .btn-ghost {
          background: transparent;
          color: var(--color-fg);
          border-color: var(--color-border);
        }
        .satis-date-range .err {
          font-size: 11.5px;
          color: var(--color-bad, #dc2626);
        }
        .satis-date-range .loading {
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
