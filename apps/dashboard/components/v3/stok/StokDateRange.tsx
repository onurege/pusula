"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  /** URL'den okunan geçerli seçim (`?from&to`) — yoksa null. */
  from: string | null;
  to: string | null;
  /** Uygulanan penceresinin gün sayısı — yalnız bilgi amaçlı gösterilir. */
  appliedDays: number;
};

/**
 * Stok Tükenme — talep/satış hızı penceresi seçici (`?from&to`). Stok
 * BAKİYESİ (on-hand) bu seçimden etkilenmez; yalnızca satış hızı/trend
 * hesapları seçilen aralığa göre yeniden çekilir (bkz. `wietnauer-stok.ts`
 * `resolveDemandWindow`). Seçim URL'e yazılır, sayfa RSC olarak yeniden
 * render olur — `StokDistSelect` ile aynı desen.
 */
export function StokDateRange({ from, to, appliedDays }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [draftFrom, setDraftFrom] = useState(from ?? "");
  const [draftTo, setDraftTo] = useState(to ?? "");

  function apply() {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (draftFrom && draftTo) {
      params.set("from", draftFrom);
      params.set("to", draftTo);
    } else {
      params.delete("from");
      params.delete("to");
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    });
  }

  function reset() {
    setDraftFrom("");
    setDraftTo("");
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("from");
    params.delete("to");
    const qs = params.toString();
    startTransition(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    });
  }

  const invalidRange = Boolean(draftFrom && draftTo && draftFrom > draftTo);
  const isCustom = Boolean(from && to);

  return (
    <div className="stok-date-range">
      <label htmlFor="stok-date-from" className="lbl">
        Talep Penceresi
      </label>
      <input
        id="stok-date-from"
        type="date"
        value={draftFrom}
        max={draftTo || undefined}
        onChange={(e) => setDraftFrom(e.target.value)}
        disabled={isPending}
        className="inp"
      />
      <span className="sep">–</span>
      <input
        id="stok-date-to"
        type="date"
        value={draftTo}
        min={draftFrom || undefined}
        onChange={(e) => setDraftTo(e.target.value)}
        disabled={isPending}
        className="inp"
      />
      <button
        type="button"
        onClick={apply}
        disabled={isPending || invalidRange || !draftFrom || !draftTo}
        className="btn"
      >
        Uygula
      </button>
      {isCustom && (
        <button type="button" onClick={reset} disabled={isPending} className="btn btn-ghost">
          Varsayılana dön
        </button>
      )}
      <span className="hint">
        {invalidRange
          ? "Başlangıç, bitişten sonra olamaz"
          : isCustom
            ? `${appliedDays} günlük özel pencere uygulanıyor · stok bakiyesi anlıktır, etkilenmez`
            : "Boş bırakılırsa varsayılan pencere (son 90–180g) kullanılır"}
      </span>
      {isPending && <span className="loading">yükleniyor…</span>}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .stok-date-range {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .stok-date-range .lbl {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .stok-date-range .inp {
          padding: 7px 9px;
          font-size: 13px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          color: var(--color-fg);
          font-family: inherit;
        }
        .stok-date-range .inp:disabled { opacity: 0.6; cursor: wait; }
        .stok-date-range .sep { color: var(--color-muted); font-size: 12px; }
        .stok-date-range .btn {
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 6px;
          border: 1px solid var(--color-accent);
          background: var(--color-accent);
          color: var(--color-on-accent, #fff);
          cursor: pointer;
        }
        .stok-date-range .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .stok-date-range .btn-ghost {
          background: transparent;
          border-color: var(--color-border);
          color: var(--color-fg);
        }
        .stok-date-range .hint {
          font-size: 11px;
          color: var(--color-muted);
          flex-basis: 100%;
        }
        .stok-date-range .loading {
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
