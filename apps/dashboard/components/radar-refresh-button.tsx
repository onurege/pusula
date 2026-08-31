"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { runRadarApi } from "@/lib/api-actions";

type Props = {
  radarId: string;
  params: Record<string, string | number>;
};

/**
 * Re-runs the radar against MSSQL (bypassing the SQLite cache) and then asks
 * Next to refetch the page so the server component picks up the new cache
 * entry. The two-step is intentional: we POST with refresh=1 first so the
 * cache is fresh by the time router.refresh() triggers re-render.
 */
export function RadarRefreshButton({ radarId, params }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      await runRadarApi(radarId, params, { refresh: true });
      startTransition(() => router.refresh());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs rounded-md border border-border bg-surface text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Cache'i atlat ve MSSQL'den taze çek"
      >
        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
        {busy ? "Yenileniyor…" : "Yenile"}
      </button>
      {err && (
        <div className="absolute right-0 top-full mt-2 w-[360px] rounded-lg border border-bad/40 bg-bad/5 p-3 text-[11px] z-50 shadow-lg">
          <div className="font-semibold text-bad mb-1">Yenileme hatası</div>
          <code className="block whitespace-pre-wrap break-words text-[10px] text-muted leading-relaxed">
            {err}
          </code>
        </div>
      )}
    </div>
  );
}
