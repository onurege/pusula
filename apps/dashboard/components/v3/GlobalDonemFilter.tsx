"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * md2 — Global Dönem Filtresi (ortak, tüm V3 ekranlarında aynı).
 *
 * Preset'ler (Son 30g · Bu Ay · Bu Yıl · Ç1/Ç2/Ç3) URL'e `?donem=<key>` yazar;
 * "Serbest" iki tarih input'uyla `?from=&to=` yazar. Preset→tarih dönüşümü
 * SUNUCUDA (server.ts `resolveDonem`) DONUK-SAAT anchor'ına göre yapılır —
 * client "bugün"e göre hesaplamaz (Wietnauer DB saati donuk). Diğer query
 * param'ları (unit, distId, reel…) korunur.
 */

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

type Preset = { key: string; label: string };
const PRESETS: Preset[] = [
  { key: "son30g", label: "Son 30g" },
  { key: "mtd", label: "Bu Ay" },
  { key: "ytd", label: "Bu Yıl" },
  { key: "q1", label: "Ç1" },
  { key: "q2", label: "Ç2" },
  { key: "q3", label: "Ç3" },
];

export function GlobalDonemFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const spFrom = searchParams?.get("from") ?? "";
  const spTo = searchParams?.get("to") ?? "";
  const spDonem = (searchParams?.get("donem") ?? "").toLowerCase();
  const hasRange = DATE_RX.test(spFrom) && DATE_RX.test(spTo);

  // Aktif preset: serbest aralık varsa "serbest"; yoksa donem param'ı; yoksa son30g.
  const active = hasRange ? "serbest" : spDonem && spDonem !== "son30g" ? spDonem : "son30g";

  const [serbestOpen, setSerbestOpen] = useState(hasRange);
  const [from, setFrom] = useState(spFrom);
  const [to, setTo] = useState(spTo);

  const validFrom = DATE_RX.test(from);
  const validTo = DATE_RX.test(to);
  const invalidRange = validFrom && validTo && from > to;
  const canApply = validFrom && validTo && !invalidRange;

  function pushParams(mut: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    mut(params);
    const qs = params.toString();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  function selectPreset(key: string) {
    setSerbestOpen(false);
    pushParams((p) => {
      p.delete("from");
      p.delete("to");
      if (key === "son30g") p.delete("donem");
      else p.set("donem", key);
    });
  }

  function applySerbest() {
    if (!canApply) return;
    pushParams((p) => {
      p.delete("donem");
      p.set("from", from);
      p.set("to", to);
    });
  }

  return (
    <div className="donem-filter">
      <span className="lbl">Dönem</span>
      <div className="chips">
        {PRESETS.map((pr) => (
          <button
            key={pr.key}
            type="button"
            className={`chip ${active === pr.key ? "on" : ""}`}
            onClick={() => selectPreset(pr.key)}
            disabled={isPending}
          >
            {pr.label}
          </button>
        ))}
        <button
          type="button"
          className={`chip ${active === "serbest" || serbestOpen ? "on" : ""}`}
          onClick={() => setSerbestOpen((v) => !v)}
          disabled={isPending}
        >
          Serbest
        </button>
      </div>

      {(serbestOpen || active === "serbest") && (
        <div className="range">
          <input
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
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            disabled={isPending}
            className="inp"
            aria-label="Bitiş tarihi"
          />
          <button
            type="button"
            className="apply"
            onClick={applySerbest}
            disabled={isPending || !canApply}
          >
            Uygula
          </button>
          {invalidRange && <span className="err">Başlangıç, bitişten sonra olamaz.</span>}
        </div>
      )}
      {isPending && <span className="loading">yükleniyor…</span>}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .donem-filter {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding: 10px 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          margin-bottom: 16px;
        }
        .donem-filter .lbl {
          font-size: 11px; font-weight: 600; color: var(--color-muted);
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .donem-filter .chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
        .donem-filter .chip {
          padding: 6px 12px; font-size: 12.5px; font-weight: 500;
          background: var(--color-surface-2); color: var(--color-fg-2, var(--color-fg));
          border: 1px solid var(--color-border); border-radius: 999px;
          cursor: pointer; transition: background .12s, color .12s, border-color .12s;
          font-family: inherit;
        }
        .donem-filter .chip:hover:not(:disabled) { border-color: var(--color-accent); }
        .donem-filter .chip.on {
          background: var(--color-accent); color: var(--color-accent-fg, #fff);
          border-color: var(--color-accent);
        }
        .donem-filter .chip:disabled { opacity: 0.55; cursor: wait; }
        .donem-filter .range { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .donem-filter .inp {
          padding: 6px 9px; font-size: 12.5px;
          background: var(--color-surface); border: 1px solid var(--color-border);
          border-radius: 6px; color: var(--color-fg); font-family: inherit;
        }
        .donem-filter .inp:focus { outline: 2px solid var(--color-accent); outline-offset: 1px; }
        .donem-filter .sep { color: var(--color-muted-2); }
        .donem-filter .apply {
          padding: 6px 12px; font-size: 12px; font-weight: 600;
          background: var(--color-accent); color: var(--color-accent-fg, #fff);
          border: 1px solid var(--color-accent); border-radius: 6px; cursor: pointer;
        }
        .donem-filter .apply:disabled { opacity: 0.5; cursor: not-allowed; }
        .donem-filter .err { font-size: 11.5px; color: var(--color-bad, #dc2626); }
        .donem-filter .loading { font-size: 11px; color: var(--color-muted); font-style: italic; }
      `,
        }}
      />
    </div>
  );
}
