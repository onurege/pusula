"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Filter, Loader2, Search, X } from "lucide-react";
import type { MapCustomer, MapFacets } from "@/lib/api";

type Props = {
  facets: MapFacets;
  customers: MapCustomer[];
  count: number;
};

export const FLY_TO_EVENT = "enroute:fly-to";

export type FlyToDetail = {
  customer: MapCustomer;
};

export function MapFilters({ facets, customers, count }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const sehir = params.get("sehir") ?? "";
  const distKod = params.get("distKod") ?? "";
  const salesFilter = params.get("salesFilter") ?? "";
  const riskTier = params.get("riskTier") ?? "";
  const minDaysSinceVisit = params.get("minDaysSinceVisit") ?? "";

  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("tr");
    if (t.length < 2) return [];
    return customers
      .filter((c) => {
        const unvan = c.unvan.toLocaleLowerCase("tr");
        const kisa = (c.kisaAd ?? "").toLocaleLowerCase("tr");
        return unvan.includes(t) || kisa.includes(t);
      })
      .slice(0, 10);
  }, [q, customers]);

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    startTransition(() => {
      router.push(`/map?${sp.toString()}`);
    });
  }

  function reset() {
    setQ("");
    startTransition(() => {
      router.push("/map");
    });
  }

  function pick(c: MapCustomer) {
    setQ("");
    window.dispatchEvent(
      new CustomEvent<FlyToDetail>(FLY_TO_EVENT, { detail: { customer: c } }),
    );
  }

  const hasFilter = !!sehir || !!distKod || !!salesFilter || !!q || !!riskTier || !!minDaysSinceVisit;

  const inputCls =
    "w-full bg-surface border border-border rounded-md px-3 h-9 text-sm shadow-xs " +
    "transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";
  const labelCls = "text-[10px] uppercase tracking-wider text-muted font-semibold";

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-surface/60 backdrop-blur p-4 space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">
          <Filter size={11} />
          Filtreler
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg transition-colors"
          >
            <X size={11} /> Temizle
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Arama</label>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Müşteri ünvanı…"
            className={inputCls + " pl-8"}
          />
        </div>
        {hits.length > 0 && (
          <ul className="rounded-md border border-border bg-surface overflow-hidden shadow-sm">
            {hits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent-soft)] border-b border-border/60 last:border-b-0 transition-colors"
                >
                  <div className="truncate font-medium">{c.unvan}</div>
                  {c.kisaAd && c.kisaAd !== c.unvan && (
                    <div className="text-[11px] text-muted truncate italic mt-0.5">{c.kisaAd}</div>
                  )}
                  <div className="text-[11px] text-muted truncate mt-0.5">
                    {[c.ilce, c.sehir].filter(Boolean).join(" / ")}
                    {c.distributor ? ` · ${c.distributor}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && hits.length === 0 && (
          <div className="text-[11px] text-muted italic">Eşleşme yok.</div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Şehir</label>
        <select
          value={sehir}
          onChange={(e) => update({ sehir: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">Tüm şehirler</option>
          {facets.cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Distribütör</label>
        <select
          value={distKod}
          onChange={(e) => update({ distKod: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">Tüm distribütörler</option>
          {facets.distributors.map((d) => (
            <option key={d.lngKod} value={String(d.lngKod)}>
              {d.ad}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Satış aktivitesi (30 gün)</label>
        <select
          value={salesFilter}
          onChange={(e) => update({ salesFilter: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">Tümü</option>
          <option value="with">Sadece satışı olanlar</option>
          <option value="without">Sadece sessiz müşteriler</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Risk seviyesi</label>
        <select
          value={riskTier}
          onChange={(e) => update({ riskTier: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">Tümü</option>
          <option value="high">Yüksek risk (kırmızı)</option>
          <option value="medium">Orta risk (amber)</option>
          <option value="active">Aktif (yeşil)</option>
          <option value="low">Sessiz (gri)</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Ziyaretsiz süre</label>
        <select
          value={minDaysSinceVisit}
          onChange={(e) => update({ minDaysSinceVisit: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">Süre fark etmez</option>
          <option value="30">30+ gündür ziyaretsiz</option>
          <option value="60">60+ gündür ziyaretsiz</option>
          <option value="90">90+ gündür ziyaretsiz</option>
          <option value="180">180+ gündür ziyaretsiz</option>
        </select>
      </div>

      <div className="pt-3 border-t border-border text-xs">
        {isPending ? (
          <span className="flex items-center gap-2 text-muted">
            <Loader2 size={12} className="animate-spin text-accent" />
            Yükleniyor…
          </span>
        ) : (
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Görüntülenen</span>
            <span className="text-fg font-semibold tabular-nums">
              {count.toLocaleString("tr-TR")}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
