"use client";

import { useState } from "react";
import type { AnomalyItem } from "@/lib/api";
import { explainOnRadar } from "@/lib/api-actions";
import { formatCompact, formatPct } from "@/lib/format";

type Tone = AnomalyItem["tone"];

const TONE_BAR: Record<Tone, string> = {
  good: "bg-good",
  warn: "bg-accent",
  bad: "bg-bad",
  neutral: "bg-muted",
};

const TONE_TEXT: Record<Tone, string> = {
  good: "text-good",
  warn: "text-accent",
  bad: "text-bad",
  neutral: "text-muted",
};

const TONE_BG_HOVER: Record<Tone, string> = {
  good: "hover:bg-good/8",
  warn: "hover:bg-accent/8",
  bad: "hover:bg-bad/8",
  neutral: "hover:bg-surface-2",
};

type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; brief?: string; sql?: string; rowCount: number }
  | { kind: "err"; message: string };

export function AnomalyCallouts({
  radarId,
  items,
}: {
  radarId: string;
  items: AnomalyItem[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [explainState, setExplainState] = useState<Record<string, ExplainState>>({});

  if (!items || items.length === 0) {
    return (
      <div className="rounded-lg border border-good/30 bg-good/5 px-4 py-3 text-sm">
        <span className="font-medium text-good">Sapma yok.</span>{" "}
        <span className="text-muted">
          Son dönem önceki haftalık ortalamayla uyumlu.
        </span>
      </div>
    );
  }

  async function explain(item: AnomalyItem) {
    setOpenId(item.id);
    setExplainState((s) => ({ ...s, [item.id]: { kind: "loading" } }));
    try {
      const res = await explainOnRadar(radarId, item.explainPrompt);
      setExplainState((s) => ({
        ...s,
        [item.id]: { kind: "ok", brief: res.brief, sql: res.sql, rowCount: res.rowCount },
      }));
    } catch (err) {
      setExplainState((s) => ({
        ...s,
        [item.id]: { kind: "err", message: (err as Error).message },
      }));
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const isOpen = openId === it.id;
          const state = explainState[it.id];
          const arrow = it.deltaPct >= 0 ? "▲" : "▼";
          return (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => (isOpen ? setOpenId(null) : explain(it))}
                className={`w-full grid grid-cols-[4px_1fr_auto_auto] items-center gap-4 text-left transition ${TONE_BG_HOVER[it.tone]}`}
              >
                <div className={`${TONE_BAR[it.tone]} h-full min-h-[52px]`} />
                <div className="py-3 min-w-0">
                  <div className="font-medium truncate">{it.label}</div>
                  <div className="text-xs text-muted mt-0.5 tabular-nums">
                    Son dönem{" "}
                    <span className="text-fg">{formatCompact(it.current, it.unit)}</span>
                    <span className="mx-1.5 text-muted/50">·</span>
                    beklenen{" "}
                    <span className="text-fg">{formatCompact(it.baseline, it.unit)}</span>
                  </div>
                </div>
                <div className={`text-xl font-semibold tabular-nums ${TONE_TEXT[it.tone]} pr-1`}>
                  {arrow} {formatPct(it.deltaPct, { signed: false })}
                </div>
                <span className="text-[11px] text-muted pr-4 whitespace-nowrap">
                  {isOpen ? "Kapat ▴" : "Neden? ▾"}
                </span>
              </button>

              {isOpen && (
                <div className="px-5 pb-4 -mt-1">
                  <div className="rounded-lg border border-border bg-bg/60 p-4">
                    {state?.kind === "loading" && (
                      <div className="text-sm text-muted flex items-center gap-2">
                        <span className="size-2 rounded-full bg-accent animate-pulse" />
                        Ajan müşteri / marka / ürün kırılımına bakıyor…
                      </div>
                    )}
                    {state?.kind === "err" && (
                      <div className="text-sm text-bad">
                        Açıklama üretilemedi: <code className="text-xs">{state.message}</code>
                      </div>
                    )}
                    {state?.kind === "ok" && (
                      <>
                        {state.brief && (
                          <div className="text-sm leading-relaxed whitespace-pre-wrap">
                            {state.brief}
                          </div>
                        )}
                        {state.sql && (
                          <details className="mt-3">
                            <summary className="text-xs text-muted cursor-pointer hover:text-fg">
                              Kullanılan SQL ({state.rowCount} satır)
                            </summary>
                            <pre className="mt-2 text-[11px] font-mono leading-relaxed overflow-auto bg-surface p-3 rounded">
                              {state.sql}
                            </pre>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
