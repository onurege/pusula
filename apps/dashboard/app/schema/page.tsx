"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RetrievedTable } from "@/lib/api";

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
      <div>
        <Link href="/" className="text-sm text-muted hover:text-fg">← Tüm raporlar</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">Şema</h1>
        <p className="text-muted text-sm mt-1 max-w-2xl">
          Univera'daki 2400+ tablonun keşif arayüzü. Türkçe iş terimi yaz, ilgili tablolar + iş açıklaması + FK ilişkileri görüntülensin.
        </p>
      </div>

      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="örn: fatura, satış, müşteri ziyareti, tahsilat…"
        className="w-full bg-surface border border-border rounded-md px-4 h-12 text-sm focus:outline-none focus:border-accent"
      />

      {error && <div className="text-bad text-sm">{error}</div>}

      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((t) => (
            <article key={t.fullName} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-baseline justify-between gap-3">
                <code className="font-mono text-sm text-accent">{t.fullName}</code>
                <span className="text-xs text-muted">score {t.score}</span>
              </div>
              {t.description && (
                <p className="text-sm text-fg mt-2 leading-relaxed">{t.description}</p>
              )}
              {t.primaryKeys.length > 0 && (
                <div className="text-xs text-muted mt-2">
                  PK: <code>{t.primaryKeys.join(", ")}</code>
                </div>
              )}
              {t.fkNeighbors.length > 0 && (
                <div className="text-xs text-muted mt-2">
                  FK komşuları:{" "}
                  {t.fkNeighbors.map((n, i) => (
                    <span key={i}>
                      <code className="text-fg/80">{n.table}</code>
                      {i < t.fkNeighbors.length - 1 && ", "}
                    </span>
                  ))}
                </div>
              )}
              <details className="mt-3">
                <summary className="text-xs text-muted cursor-pointer hover:text-fg">
                  {t.columns.length} kolon
                </summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
                  {t.columns.slice(0, 30).map((c) => (
                    <div key={c.name} className="flex gap-2">
                      <code className={c.isPrimaryKey ? "text-accent" : "text-fg/80"}>
                        {c.name}
                      </code>
                      <span className="text-muted">({c.dataType})</span>
                      {c.label && <span className="text-muted">— {c.label}</span>}
                    </div>
                  ))}
                  {t.columns.length > 30 && (
                    <div className="text-muted">… ve {t.columns.length - 30} kolon daha</div>
                  )}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}

      {!busy && query && results.length === 0 && !error && (
        <div className="text-muted text-sm">Eşleşme yok.</div>
      )}
    </div>
  );
}
