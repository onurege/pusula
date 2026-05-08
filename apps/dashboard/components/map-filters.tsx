"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { MapFacets } from "@/lib/api";

type Props = {
  facets: MapFacets;
};

export function MapFilters({ facets }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const sehir = params.get("sehir") ?? "";
  const distKod = params.get("distKod") ?? "";

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
    startTransition(() => {
      router.push("/map");
    });
  }

  const hasFilter = !!sehir || !!distKod;

  return (
    <aside className="w-[260px] shrink-0 rounded-xl border border-border bg-surface p-4 space-y-4 self-start">
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

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">Şehir</span>
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
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs text-muted">Distribütör</span>
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
      </label>

      {isPending && (
        <div className="text-[11px] text-muted flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-accent animate-pulse" />
          Yükleniyor…
        </div>
      )}
    </aside>
  );
}
