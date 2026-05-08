"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ResultTable } from "@/components/result-table";

type Generated = {
  sql: string;
  brief: string;
  result: {
    rowCount: number;
    truncated: boolean;
    durationMs: number;
    rows: Record<string, unknown>[];
  };
  retrieved: Array<{ fullName: string; score: number; description?: string }>;
  savedId?: string;
};

const SAMPLES = [
  "Son 30 günde en çok satış yapan top 10 distribütör",
  "Pernod Ricard markasının kanal kırılımındaki ciro payı",
  "Vade tarihi geçmiş ödenmemiş faturalar — distribütör bazında özet",
  "On-trade kanalında premium spirits aktivite sayısı",
];

const API_URL = process.env.NEXT_PUBLIC_ENROUTE_API_URL ?? "http://localhost:8080";

export default function NewReportPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [saving, setSaving] = useState(false);

  async function generate(save: boolean) {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    if (save) setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/reports/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), save }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }
      const data = (await res.json()) as Generated;
      setGenerated(data);
      if (save && data.savedId) {
        router.push(`/reports/${data.savedId}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/reports" className="text-sm text-muted hover:text-fg">← Kayıtlı raporlar</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">Yeni rapor</h1>
        <p className="text-muted text-sm mt-1 max-w-2xl">
          Türkçe doğal dilde ne istediğini yaz. Sistem ilgili tabloları çıkartır, SQL yazar, çalıştırır ve kısa bir brifing üretir. Beğendiğin sonucu kaydedebilirsin.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Örn: Son 30 günde en çok ciro yapan ilk 10 distribütör"
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent resize-y"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => generate(false)}
            disabled={busy || !prompt.trim()}
            className="inline-flex items-center gap-2 bg-surface-2 border border-border text-fg px-4 h-10 rounded-md text-sm hover:bg-border disabled:opacity-40"
          >
            {busy && !saving ? "Üretiliyor…" : "Önizle"}
          </button>
          <button
            onClick={() => generate(true)}
            disabled={busy || !prompt.trim()}
            className="inline-flex items-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Kaydediliyor…" : "Üret + Kaydet"}
          </button>
          <div className="flex-1" />
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                className="text-xs text-muted hover:text-fg border border-border rounded-full px-3 py-1"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          <code className="text-xs">{error}</code>
        </div>
      )}

      {generated && (
        <div className="space-y-6">
          <section className="rounded-lg border border-accent/40 bg-accent/5 p-5">
            <div className="text-xs uppercase tracking-wide text-accent font-semibold mb-2">AI Brief</div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{generated.brief}</div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wide text-muted font-semibold mb-2">SQL</div>
            <pre className="rounded-lg border border-border bg-surface p-4 overflow-auto text-xs font-mono leading-relaxed">
              {generated.sql}
            </pre>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wide text-muted font-semibold mb-2">
              Sonuç
              <span className="ml-2 text-muted/80 normal-case font-normal">
                · {generated.result.rowCount.toLocaleString("tr-TR")} satır
                {generated.result.truncated ? " (kesildi)" : ""}
                · {generated.result.durationMs}ms
              </span>
            </div>
            <ResultTable rows={generated.result.rows} max={50} />
          </section>

          <section>
            <div className="text-xs uppercase tracking-wide text-muted font-semibold mb-2">Bağlam — bulunan tablolar</div>
            <ul className="space-y-1 text-sm">
              {generated.retrieved.map((t) => (
                <li key={t.fullName} className="flex items-start gap-3">
                  <code className="text-xs bg-surface border border-border px-2 py-1 rounded shrink-0">{t.fullName}</code>
                  {t.description && <span className="text-muted text-sm">{t.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
