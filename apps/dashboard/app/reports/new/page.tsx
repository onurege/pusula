"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Eye, Save, Sparkles, Wand2 } from "lucide-react";
import { ResultTable } from "@/components/result-table";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

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
      <div className="space-y-2">
        <Link href="/reports" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">
          ← Kayıtlı raporlar
        </Link>
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-[var(--color-accent-soft)] text-accent flex items-center justify-center">
            <Wand2 size={18} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Yeni rapor</h1>
        </div>
        <p className="text-fg-2 text-sm max-w-2xl leading-relaxed">
          Türkçe doğal dilde ne istediğini yaz. Sistem ilgili tabloları çıkarır, SQL yazar,
          çalıştırır ve kısa bir brifing üretir. Beğendiğin sonucu kaydedebilirsin.
        </p>
      </div>

      <Card padding="lg" className="space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Örn: Son 30 günde en çok ciro yapan ilk 10 distribütör"
          className="w-full bg-bg border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 resize-y transition-colors"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => generate(false)}
            disabled={busy || !prompt.trim()}
            loading={busy && !saving}
            iconLeft={busy && !saving ? undefined : <Eye size={14} />}
          >
            {busy && !saving ? "Üretiliyor…" : "Önizle"}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => generate(true)}
            disabled={busy || !prompt.trim()}
            loading={saving}
            iconLeft={saving ? undefined : <Save size={14} />}
          >
            {saving ? "Kaydediliyor…" : "Üret + Kaydet"}
          </Button>
          <div className="flex-1" />
          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((s) => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                className="text-xs text-fg-2 hover:text-accent hover:bg-[var(--color-accent-soft)] bg-surface-2 border border-border rounded-full px-3 py-1 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error && (
        <Card tone="bad" padding="md">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-bad mt-0.5 shrink-0" />
            <code className="text-xs text-fg-2 leading-relaxed">{error}</code>
          </div>
        </Card>
      )}

      {generated && (
        <div className="space-y-5">
          <Card tone="accent" padding="lg">
            <CardHeader className="flex items-center gap-1.5 text-accent">
              <Sparkles size={11} /> AI Brief
            </CardHeader>
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{generated.brief}</div>
          </Card>

          <section>
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">SQL</div>
            <pre className="rounded-lg border border-border bg-surface p-4 overflow-auto text-[11px] font-mono leading-relaxed shadow-xs">
              {generated.sql}
            </pre>
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2 flex items-baseline gap-2">
              Sonuç
              <span className="text-muted/80 normal-case font-normal tracking-normal text-[11px]">
                · {generated.result.rowCount.toLocaleString("tr-TR")} satır
                {generated.result.truncated ? " (kesildi)" : ""}
                · <span className="tabular-nums">{generated.result.durationMs}ms</span>
              </span>
            </div>
            <ResultTable rows={generated.result.rows} max={50} />
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
              Bağlam — bulunan tablolar
            </div>
            <ul className="space-y-1.5 text-sm">
              {generated.retrieved.map((t) => (
                <li key={t.fullName} className="flex items-start gap-3">
                  <code className="text-[10px] bg-surface-2 border border-border text-fg-2 px-2 py-1 rounded shrink-0 font-mono">
                    {t.fullName}
                  </code>
                  {t.description && <span className="text-muted text-xs">{t.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
