"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Database, KeyRound, Loader2, Search } from "lucide-react";
import type { RetrievedTable } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API_URL = process.env.NEXT_PUBLIC_ENROUTE_API_URL ?? "http://localhost:8080";

export default function SchemaPage() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RetrievedTable[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/api/retrieve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), topK: 12 }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = (await res.json()) as { results: RetrievedTable[] };
        setResults(data.results);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">
          ← Radar
        </Link>
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-[var(--color-accent-soft)] text-accent flex items-center justify-center">
            <Database size={18} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Şema</h1>
        </div>
        <p className="text-fg-2 text-sm max-w-2xl leading-relaxed">
          Univera'daki 2400+ tablonun keşif arayüzü. Türkçe iş terimi yaz, ilgili
          tablolar + iş açıklaması + FK ilişkileri görüntülensin.
        </p>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="örn: fatura, satış, müşteri ziyareti, tahsilat…"
          className="w-full bg-surface border border-border rounded-lg pl-10 pr-12 h-12 text-sm shadow-xs focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-colors"
        />
        {busy && (
          <Loader2
            size={16}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-accent animate-spin"
          />
        )}
      </div>

      {error && (
        <Card tone="bad" padding="md">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-bad mt-0.5 shrink-0" />
            <span className="text-sm text-fg-2">{error}</span>
          </div>
        </Card>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((t) => (
            <Card key={t.fullName} padding="md" className="hover:border-accent/40 transition-colors">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <code className="font-mono text-sm font-medium text-accent">{t.fullName}</code>
                <Badge tone="muted" size="sm">score {t.score}</Badge>
              </div>
              {t.description && (
                <p className="text-sm text-fg-2 leading-relaxed">{t.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs">
                {t.primaryKeys.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <KeyRound size={11} className="text-accent" />
                    PK: <code className="text-fg-2 font-mono">{t.primaryKeys.join(", ")}</code>
                  </span>
                )}
                {t.fkNeighbors.length > 0 && (
                  <span className="text-muted">
                    FK:{" "}
                    {t.fkNeighbors.slice(0, 4).map((n, i) => (
                      <span key={i}>
                        <code className="text-fg-2 font-mono">{n.table}</code>
                        {i < Math.min(t.fkNeighbors.length, 4) - 1 && ", "}
                      </span>
                    ))}
                    {t.fkNeighbors.length > 4 && (
                      <span className="text-muted-2"> +{t.fkNeighbors.length - 4}</span>
                    )}
                  </span>
                )}
              </div>
              <details className="mt-3">
                <summary className="text-xs text-muted cursor-pointer hover:text-fg transition-colors">
                  {t.columns.length} kolon
                </summary>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                  {t.columns.slice(0, 30).map((c) => (
                    <div key={c.name} className="flex gap-2">
                      <code className={c.isPrimaryKey ? "text-accent font-medium" : "text-fg-2"}>
                        {c.name}
                      </code>
                      <span className="text-muted">({c.dataType})</span>
                      {c.label && <span className="text-muted-2">— {c.label}</span>}
                    </div>
                  ))}
                  {t.columns.length > 30 && (
                    <div className="text-muted-2 italic">
                      … ve {t.columns.length - 30} kolon daha
                    </div>
                  )}
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}

      {!busy && query && results.length === 0 && !error && (
        <Card padding="lg" className="text-center text-muted">
          Eşleşme yok.
        </Card>
      )}
    </div>
  );
}
