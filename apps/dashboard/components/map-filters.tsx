"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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

  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("tr");
    if (t.length < 2) return [];
    return customers
      .filter((c) => c.unvan.toLocaleLowerCase("tr").includes(t))
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

  const hasFilter = !!sehir || !!distKod || !!salesFilter || !!q;

  return (
    <aside className="w-72 shrink-0 rounded-xl border border-border bg-surface p-4 self-start space-y-4 max-h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
          Filtreler
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={reset}
            className="text-[11px] text-muted hover:text-fg"
          >
            Temizle
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted">Arama</label>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Müşteri ünvanı…"
          className="w-full bg-bg border border-border rounded-md px-3 h-9 text-sm focus:outline-none focus:border-accent"
        />
        {hits.length > 0 && (
          <ul className="rounded-md border border-border bg-bg overflow-hidden">
            {hits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 border-b border-border/60 last:border-b-0"
                >
                  <div className="truncate">{c.unvan}</div>
                  <div className="text-[11px] text-muted truncate">
                    {[c.ilce, c.sehir].filter(Boolean).join(" / ")}
                    {c.distributor ? ` · ${c.distributor}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && hits.length === 0 && (
          <div className="text-[11px] text-muted">Eşleşme yok.</div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted">Şehir</label>
        <select
          value={sehir}
          onChange={(e) => update({ sehir: e.target.value })}
          disabled={isPending}
          className="w-full bg-bg border border-border rounded-md px-3 h-9 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">Tüm şehirler</option>
          {facets.cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted">Distribütör</label>
        <select
          value={distKod}
          onChange={(e) => update({ distKod: e.target.value })}
          disabled={isPending}
          className="w-full bg-bg border border-border rounded-md px-3 h-9 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
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
        <label className="text-xs text-muted">Satış aktivitesi (son 30 gün)</label>
        <select
          value={salesFilter}
          onChange={(e) => update({ salesFilter: e.target.value })}
          disabled={isPending}
          className="w-full bg-bg border border-border rounded-md px-3 h-9 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">Tümü</option>
          <option value="with">Sadece satışı olanlar</option>
          <option value="without">Sadece sessiz müşteriler</option>
        </select>
      </div>

      <div className="pt-3 border-t border-border text-xs text-muted">
        {isPending ? (
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-accent animate-pulse" />
            Yükleniyor…
          </span>
        ) : (
          <span>
            Görüntülenen:{" "}
            <span className="text-fg font-medium tabular-nums">
              {count.toLocaleString("tr-TR")}
            </span>{" "}
            müşteri
          </span>
        )}
      </div>
    </aside>
  );
}
