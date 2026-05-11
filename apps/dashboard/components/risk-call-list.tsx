"use client";

import { useMemo, useState } from "react";
import { Download, Phone, Search } from "lucide-react";
import type { MapCustomer } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { describeRiskReason } from "@/lib/risk";
import { Button } from "@/components/ui/button";
import { CustomerModal } from "@/components/customer-modal";

export function RiskCallList({ customers }: { customers: MapCustomer[] }) {
  const [q, setQ] = useState("");
  const [city, setCity] = useState<string>("");
  const [selected, setSelected] = useState<MapCustomer | null>(null);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) if (c.sehir) set.add(c.sehir);
    return [...set].sort((a, b) => a.localeCompare(b, "tr"));
  }, [customers]);

  const filtered = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("tr");
    return customers.filter((c) => {
      if (city && c.sehir !== city) return false;
      if (!t) return true;
      return (
        c.unvan.toLocaleLowerCase("tr").includes(t) ||
        (c.kisaAd ?? "").toLocaleLowerCase("tr").includes(t) ||
        (c.distributor ?? "").toLocaleLowerCase("tr").includes(t)
      );
    });
  }, [customers, q, city]);

  function handleExport() {
    downloadCsv(`kayip-riski-${new Date().toISOString().slice(0, 10)}`, filtered, [
      { key: "unvan", label: "Müşteri" },
      { key: "kisaAd", label: "Kısa ad" },
      { key: "distributor", label: "Distribütör" },
      { key: "sehir", label: "Şehir" },
      { key: "ilce", label: "İlçe" },
      {
        key: (c) => c.ciroPrev30,
        label: "Önceki 30g ciro (₺)",
        format: (v) => Math.round(Number(v ?? 0)).toLocaleString("tr-TR"),
      },
      {
        key: (c) => c.ciro30,
        label: "Son 30g ciro (₺)",
        format: (v) => Math.round(Number(v ?? 0)).toLocaleString("tr-TR"),
      },
      {
        key: (c) => (c.ciroPrev30 ?? 0) - (c.ciro30 ?? 0),
        label: "Kayıp ciro (₺)",
        format: (v) => Math.round(Number(v ?? 0)).toLocaleString("tr-TR"),
      },
      { key: "daysSinceLastSale", label: "Son satıştan beri (gün)" },
      { key: "daysSinceLastVisit", label: "Son ziyaretten beri (gün)" },
      { key: (c) => describeRiskReason(c), label: "Risk nedeni" },
    ]);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Müşteri / distribütör ara…"
            className="w-full bg-surface border border-border rounded-md pl-9 pr-3 h-9 text-sm shadow-xs focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-colors"
          />
        </div>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="bg-surface border border-border rounded-md px-3 h-9 text-sm shadow-xs focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-colors min-w-[140px]"
        >
          <option value="">Tüm şehirler</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="text-xs text-muted ml-auto tabular-nums">
          <span className="text-fg font-medium">{filtered.length}</span> /{" "}
          {customers.length} müşteri
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          iconLeft={<Download size={13} />}
          disabled={filtered.length === 0}
        >
          Çarşaf indir (CSV)
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-surface shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-[10px] uppercase tracking-wider text-muted font-semibold border-b border-border">
                <th className="text-left py-2.5 pl-4 pr-2 w-8">#</th>
                <th className="text-left py-2.5 px-2">Müşteri</th>
                <th className="text-left py-2.5 px-2">Şehir</th>
                <th className="text-right py-2.5 px-2">Önceki 30g</th>
                <th className="text-right py-2.5 px-2">Son 30g</th>
                <th className="text-right py-2.5 px-2">Kayıp</th>
                <th className="text-left py-2.5 px-2">Neden</th>
                <th className="text-right py-2.5 pl-2 pr-4 w-20">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const lost = Math.max(0, (c.ciroPrev30 ?? 0) - (c.ciro30 ?? 0));
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="border-b border-border/40 last:border-0 hover:bg-[var(--color-bad-soft)] cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 pl-4 pr-2 text-xs text-muted tabular-nums">
                      {i + 1}
                    </td>
                    <td className="py-2.5 px-2 min-w-[220px] max-w-[320px]">
                      <div className="font-medium truncate">{c.unvan}</div>
                      {c.distributor && (
                        <div className="text-[11px] text-accent truncate">
                          {c.distributor}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-muted">
                      {[c.ilce, c.sehir].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-xs text-fg-2">
                      {Math.round(c.ciroPrev30 ?? 0).toLocaleString("tr-TR")} ₺
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-xs text-fg-2">
                      {Math.round(c.ciro30 ?? 0).toLocaleString("tr-TR")} ₺
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-sm font-medium text-bad">
                      {Math.round(lost).toLocaleString("tr-TR")} ₺
                    </td>
                    <td className="py-2.5 px-2 text-xs text-fg-2 max-w-[360px]">
                      <div className="line-clamp-2 leading-snug">
                        {describeRiskReason(c)}
                      </div>
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right">
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                        <Phone size={11} />
                        Aç
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <CustomerModal customer={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
