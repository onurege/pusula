"use client";

import { useState } from "react";
import type { AnomalyItem } from "@/lib/api";
import { explainOnRadar } from "@/lib/api";
import { formatCompact, formatPct } from "@/lib/format";

type Tone = AnomalyItem["tone"];

const TONE_BORDER: Record<Tone, string> = {
  good: "border-good/40 bg-good/5",
  warn: "border-accent/40 bg-accent/8",
  bad: "border-bad/50 bg-bad/8",
  neutral: "border-border bg-surface",
};

const TONE_TEXT: Record<Tone, string> = {
  good: "text-good",
  warn: "text-accent",
  bad: "text-bad",
  neutral: "text-muted",
};

const TONE_BAR: Record<Tone, string> = {
  good: "bg-good",
  warn: "bg-accent",
  bad: "bg-bad",
  neutral: "bg-muted",
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
      <div className="rounded-xl border border-good/30 bg-good/5 p-5 text-sm">
        <span className="font-medium text-good">Sapma yok.</span>{" "}
        <span className="text-muted">
          Son dönem önceki haftalık ortalamayla uyumlu — temiz tablo.
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
    <div className="space-y-3">
      {items.map((it) => {
        const isOpen = openId === it.id;
        const state = explainState[it.id];
        const arrow = it.deltaPct >= 0 ? "▲" : "▼";
        return (
          <div
            key={it.id}
            className={`relative rounded-xl border ${TONE_BORDER[it.tone]} overflow-hidden`}
          >
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${TONE_BAR[it.tone]}`} />
            <div className="pl-6 pr-5 py-5">
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <div className="font-semibold text-base truncate">{it.label}</div>
                <div className={`text-2xl md:text-3xl font-semibold tabular-nums leading-none ${TONE_TEXT[it.tone]}`}>
                  {arrow} {formatPct(it.deltaPct, { signed: false })}
                </div>
              </div>
              <div className="text-sm text-muted mt-2 tabular-nums">
                Son dönem{" "}
                <span className="text-fg font-medium">
                  {formatCompact(it.current, it.unit)}
                </span>
                <span className="mx-2 text-muted/50">·</span>
                beklenen{" "}
                <span className="text-fg font-medium">
                  {formatCompact(it.baseline, it.unit)}
                </span>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (isOpen ? setOpenId(null) : explain(it))}
                  className={`text-xs px-3 py-1.5 rounded-md border border-border bg-surface-2 hover:bg-border text-fg font-medium`}
                >
                  {isOpen ? "Kapat" : "Neden? →"}
                </button>
              </div>

              {isOpen && (
                <div className="mt-4 rounded-lg border border-border bg-bg/60 p-4">
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
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
