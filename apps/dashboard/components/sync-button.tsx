"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { RefreshCw, X } from "lucide-react";
import type { MapSyncStatus } from "@/lib/api";
import { triggerMapSync } from "@/lib/api-actions";
import { Button } from "@/components/ui/button";

type Props = {
  initial: MapSyncStatus;
};

export function SyncButton({ initial }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [tick, setTick] = useState(0);

  // Re-render the relative time stamp every 30s so "az önce" stays honest
  // without burning CPU.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const next = await triggerMapSync();
      setStatus(next);
      // Refetch the server component so the customer list reflects new data.
      startTransition(() => router.refresh());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const relative = status.lastSyncAt ? formatRelative(status.lastSyncAt, tick) : null;

  return (
    <div className="relative flex items-center gap-3">
      {relative && (
        <span className="text-xs text-muted whitespace-nowrap" title={status.lastSyncAt ?? undefined}>
          Son güncelleme: <span className="text-fg font-medium">{relative}</span>
          {status.customerCount > 0 && (
            <> · <span className="tabular-nums">{status.customerCount.toLocaleString("tr-TR")}</span> kayıt</>
          )}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        loading={busy}
        iconLeft={!busy ? <RefreshCw size={13} /> : undefined}
      >
        {busy ? "Senkronlanıyor…" : "Verileri yenile"}
      </Button>

      {err && (
        <div className="absolute right-0 top-full mt-2 w-[420px] rounded-lg border border-bad/40 bg-bad/5 p-3 text-[11px] text-fg z-50 shadow-lg">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="font-semibold text-bad">Senkronizasyon hatası</span>
            <button
              type="button"
              onClick={() => setErr(null)}
              className="text-muted hover:text-fg leading-none"
              aria-label="Kapat"
            >
              <X size={14} />
            </button>
          </div>
          <code className="block whitespace-pre-wrap break-words text-[10px] text-muted leading-relaxed max-h-48 overflow-y-auto">
            {err}
          </code>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string, _tick: number): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 30) return "az önce";
  if (seconds < 60) return `${seconds} sn önce`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  return `${d} gün önce`;
}
