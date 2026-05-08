"use client";

import { useState } from "react";
import type { AnomalyItem } from "@/lib/api";
import { explainOnRadar } from "@/lib/api";

type Tone = AnomalyItem["tone"];

const TONE_BORDER: Record<Tone, string> = {
  good: "border-good/40 bg-good/5",
  warn: "border-accent/40 bg-accent/5",
  bad: "border-bad/40 bg-bad/5",
  neutral: "border-border bg-surface",
};

const TONE_DOT: Record<Tone, string> = {
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

function fmtNumber(v: number, unit?: string): string {
  const abs = Math.abs(v);
  let formatted: string;
  if (abs >= 1_000_000) formatted = (v / 1_000_000).toFixed(1) + "M";
  else if (abs >= 10_000) formatted = (v / 1_000).toFixed(0) + "k";
  else formatted = v.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

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
      <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
        Bugün dikkat çeken bir sapma yok — son dönem önceki haftalık ortalamayla uyumlu.
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
        const direction = it.deltaPct >= 0 ? "▲" : "▼";
        return (
          <div
            key={it.id}
            className={`rounded-lg border ${TONE_BORDER[it.tone]} p-5`}
          >
            <div className="flex items-start gap-4">
              <span className={`mt-1.5 size-2 rounded-full ${TONE_DOT[it.tone]} shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="font-medium truncate">{it.label}</div>
                  <div className={`text-sm font-semibold tabular-nums ${TONE_TEXT[it.tone]}`}>
                    {direction} {fmtPct(it.deltaPct)}
                  </div>
                </div>
                <div className="text-sm text-muted mt-1">
                  Son dönem <span className="text-fg tabular-nums">{fmtNumber(it.current, it.unit)}</span>
                  {" "}· beklenen <span className="text-fg tabular-nums">{fmtNumber(it.baseline, it.unit)}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (isOpen ? setOpenId(null) : explain(it))}
                    className="text-xs px-3 py-1.5 rounded-md border border-border bg-surface-2 hover:bg-border text-fg"
                  >
                    {isOpen ? "Kapat" : "Neden?"}
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-4 rounded-md border border-border bg-bg/40 p-4">
                    {state?.kind === "loading" && (
                      <div className="text-sm text-muted">Ajan inceliyor…</div>
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
          </div>
        );
      })}
    </div>
  );
}
