"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshAllData } from "@/app/actions/refresh";

/**
 * Tek merkezi "Verileri yenile" butonu — navbar'da.
 *
 * Tek bir server action (`refreshAllData`) çağırır; iki cache katmanını
 * birden invalidate eder:
 *   1. Hono SQLite withCache (mirror sync + komuta snapshot ?refresh=1)
 *   2. Next.js Data Cache (revalidateTag ile RAM cache temizliği)
 *
 * 5 dk içinde 2. tıklamayı ignore eder — yanlışlıkla 10x tıklama saha
 * MSSQL'i yormasın (saha aktif çalışırken senkronizasyon DB lock'larını
 * uzatabilir).
 *
 * Tüm sayfaların kendi refresh butonlarının yerine geçer; tek yerden
 * tüm dashboard verisini tazeler.
 */
export function GlobalRefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // localStorage'tan son refresh zamanını oku (sayfa yenileme sonrası korunur)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("enroute:last-refresh");
      if (stored) {
        const ts = parseInt(stored, 10);
        if (!isNaN(ts)) setLastRefreshAt(ts);
      }
    } catch {
      /* localStorage erişim hatası → sessizce geç */
    }
  }, []);

  const THROTTLE_MS = 5 * 60 * 1000; // 5 dk
  const sinceLast = lastRefreshAt ? Date.now() - lastRefreshAt : Infinity;
  const throttled = sinceLast < THROTTLE_MS;
  const throttleMinsLeft = throttled
    ? Math.ceil((THROTTLE_MS - sinceLast) / 60_000)
    : 0;

  async function run() {
    if (throttled) {
      setErr(
        `Son yenilemenin üzerinden 5 dk geçmedi — saha DB'yi yormamak için ${throttleMinsLeft} dk daha bekleyin.`,
      );
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Tek server action — SQLite mirror + Komuta snapshot + revalidateTag
      // hepsini sırayla yapar. Result objesi { ok: true } veya { ok: false, error }
      const result = await refreshAllData();
      if (!result.ok) {
        setErr(result.error);
        return;
      }
      // Throttle timestamp'i kaydet (5 dk pencere)
      const now = Date.now();
      setLastRefreshAt(now);
      try {
        localStorage.setItem("enroute:last-refresh", String(now));
      } catch {
        /* sessizce geç */
      }
      // Server component'leri yeniden render et — revalidateTag zaten cache'i
      // boşalttı, router.refresh() yeni fetch'leri tetikler.
      startTransition(() => router.refresh());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Son yenileme metni — "az önce" / "X dk önce"
  const relative = lastRefreshAt
    ? formatRelative(lastRefreshAt)
    : null;

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title={
          throttled
            ? `5 dk içinde tek yenileme — ${throttleMinsLeft} dk sonra tekrar dene`
            : "Tüm dashboard verisini tazele (MSSQL mirror + Komuta snapshot)"
        }
        className={
          "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-colors " +
          (busy
            ? "bg-accent-soft text-accent border-accent/40 cursor-wait"
            : throttled
              ? "bg-surface-2 text-muted-2 border-border cursor-not-allowed"
              : "bg-surface-2 text-fg-2 border-border hover:border-accent/40 hover:text-accent")
        }
      >
        <RefreshCw
          size={12}
          className={busy ? "animate-spin" : ""}
        />
        {busy ? "Senkronlanıyor…" : "Veriyi Yenile"}
      </button>

      {relative && !busy && (
        <span
          className="text-[10px] text-muted-2 hidden lg:inline"
          title={new Date(lastRefreshAt!).toLocaleString("tr-TR")}
        >
          {relative}
        </span>
      )}

      {err && (
        <div className="absolute right-0 top-full mt-2 w-[300px] rounded-lg border border-bad/40 bg-bad/5 p-3 text-[11px] text-fg z-50 shadow-lg">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="font-semibold text-bad">Yenileme</span>
            <button
              type="button"
              onClick={() => setErr(null)}
              className="text-muted hover:text-fg leading-none"
              aria-label="Kapat"
            >
              ×
            </button>
          </div>
          <p className="text-[11px] text-fg-2 leading-relaxed">{err}</p>
        </div>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 30) return "az önce";
  if (seconds < 60) return `${seconds} sn önce`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}
