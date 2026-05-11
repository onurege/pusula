"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Calendar, Download, MapPin, Search } from "lucide-react";
import type { MapCustomer } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerModal } from "@/components/customer-modal";

type SortKey = "default" | "unvan" | "sehir" | "visit" | "sale" | "ciro" | "risk";
type SortDir = "asc" | "desc";

const RISK_RANK: Record<MapCustomer["riskTier"], number> = {
  high: 0,
  medium: 1,
  active: 2,
  low: 3,
};

const THRESHOLD_OPTIONS = [
  { value: 30, label: "30+ gün" },
  { value: 60, label: "60+ gün" },
  { value: 90, label: "90+ gün" },
  { value: 180, label: "180+ gün" },
];

export function VisitGapList({
  customers,
  threshold,
}: {
  customers: MapCustomer[];
  threshold: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [selected, setSelected] = useState<MapCustomer | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey, defaultDir: SortDir = "desc") {
    if (sortKey === key) {
      // Same column: flip direction
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  }

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) if (c.sehir) set.add(c.sehir);
    return [...set].sort((a, b) => a.localeCompare(b, "tr"));
  }, [customers]);

  const filtered = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("tr");
    const base = customers.filter((c) => {
      if (city && c.sehir !== city) return false;
      if (!t) return true;
      return (
        c.unvan.toLocaleLowerCase("tr").includes(t) ||
        (c.kisaAd ?? "").toLocaleLowerCase("tr").includes(t) ||
        (c.distributor ?? "").toLocaleLowerCase("tr").includes(t)
      );
    });
    if (sortKey === "default") return base;
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...base].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case "unvan":
          av = a.unvan.toLocaleLowerCase("tr");
          bv = b.unvan.toLocaleLowerCase("tr");
          break;
        case "sehir":
          av = (a.sehir ?? "").toLocaleLowerCase("tr");
          bv = (b.sehir ?? "").toLocaleLowerCase("tr");
          break;
        case "visit":
          av = a.daysSinceLastVisit ?? -1;
          bv = b.daysSinceLastVisit ?? -1;
          break;
        case "sale":
          av = a.daysSinceLastSale ?? -1;
          bv = b.daysSinceLastSale ?? -1;
          break;
        case "ciro":
          av = Math.max(a.ciroPrev30 ?? 0, a.ciro30 ?? 0);
          bv = Math.max(b.ciroPrev30 ?? 0, b.ciro30 ?? 0);
          break;
        case "risk":
          av = RISK_RANK[a.riskTier];
          bv = RISK_RANK[b.riskTier];
          break;
        default:
          return 0;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv, "tr") * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
    return sorted;
  }, [customers, q, city, sortKey, sortDir]);

  function changeThreshold(v: number) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    sp.set("gun", String(v));
    router.push(`/ziyaret?${sp.toString()}`);
  }

  function handleExport() {
    downloadCsv(
      `ziyaret-bosluk-${threshold}gun-${new Date().toISOString().slice(0, 10)}`,
      filtered,
      [
        { key: "unvan", label: "Müşteri" },
        { key: "kisaAd", label: "Kısa ad" },
        { key: "distributor", label: "Distribütör" },
        { key: "sehir", label: "Şehir" },
        { key: "ilce", label: "İlçe" },
        { key: "daysSinceLastVisit", label: "Son ziyaretten beri (gün)" },
        { key: "daysSinceLastSale", label: "Son satıştan beri (gün)" },
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
        { key: "riskTier", label: "Risk" },
      ],
    );
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
          value={threshold}
          onChange={(e) => changeThreshold(Number(e.target.value))}
          className="bg-surface border border-border rounded-md px-3 h-9 text-sm shadow-xs focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-colors min-w-[120px]"
        >
          {THRESHOLD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

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
                <SortHeader
                  label="Müşteri"
                  active={sortKey === "unvan"}
                  dir={sortDir}
                  onClick={() => toggleSort("unvan", "asc")}
                  align="left"
                />
                <SortHeader
                  label="Konum"
                  active={sortKey === "sehir"}
                  dir={sortDir}
                  onClick={() => toggleSort("sehir", "asc")}
                  align="left"
                />
                <SortHeader
                  label="Son ziyaret"
                  active={sortKey === "visit"}
                  dir={sortDir}
                  onClick={() => toggleSort("visit", "desc")}
                  align="right"
                />
                <SortHeader
                  label="Son satış"
                  active={sortKey === "sale"}
                  dir={sortDir}
                  onClick={() => toggleSort("sale", "desc")}
                  align="right"
                />
                <SortHeader
                  label="Geçmiş ciro"
                  active={sortKey === "ciro"}
                  dir={sortDir}
                  onClick={() => toggleSort("ciro", "desc")}
                  align="right"
                />
                <SortHeader
                  label="Risk"
                  active={sortKey === "risk"}
                  dir={sortDir}
                  onClick={() => toggleSort("risk", "asc")}
                  align="left"
                />
                <th className="text-right py-2.5 pl-2 pr-4 w-20">Aç</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const visitBucket = bucketDays(c.daysSinceLastVisit);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="border-b border-border/40 last:border-0 hover:bg-[var(--color-warn-soft)] cursor-pointer transition-colors"
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
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={10} className="opacity-60 shrink-0" />
                        {[c.ilce, c.sehir].filter(Boolean).join(" / ") || "—"}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      <span className={`text-sm font-medium ${visitBucket.color}`}>
                        {c.daysSinceLastVisit ?? "—"}
                      </span>
                      <span className="text-[10px] text-muted ml-1">gün</span>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-xs text-fg-2">
                      {c.daysSinceLastSale === null
                        ? "—"
                        : `${c.daysSinceLastSale} gün`}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-xs text-fg-2">
                      {Math.round(c.ciroPrev30 ?? 0).toLocaleString("tr-TR")} ₺
                    </td>
                    <td className="py-2.5 px-2">
                      <RiskBadge tier={c.riskTier} />
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right">
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                        <Calendar size={11} />
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

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align: "left" | "right";
}) {
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={`py-2.5 px-2 select-none ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={
          "inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold transition-colors " +
          (active ? "text-accent" : "text-muted hover:text-fg")
        }
      >
        {align === "right" ? (
          <>
            <Icon size={10} className={active ? "" : "opacity-40"} />
            {label}
          </>
        ) : (
          <>
            {label}
            <Icon size={10} className={active ? "" : "opacity-40"} />
          </>
        )}
      </button>
    </th>
  );
}

function bucketDays(days: number | null): { color: string } {
  if (days === null) return { color: "text-muted" };
  if (days >= 180) return { color: "text-bad" };
  if (days >= 90) return { color: "text-bad" };
  if (days >= 60) return { color: "text-warn" };
  if (days >= 30) return { color: "text-fg" };
  return { color: "text-fg-2" };
}

function RiskBadge({ tier }: { tier: MapCustomer["riskTier"] }) {
  if (tier === "high") return <Badge tone="bad" size="sm" dot>Yüksek</Badge>;
  if (tier === "medium") return <Badge tone="warn" size="sm" dot>Orta</Badge>;
  if (tier === "active") return <Badge tone="good" size="sm">Aktif</Badge>;
  return <Badge tone="muted" size="sm">Düşük</Badge>;
}
