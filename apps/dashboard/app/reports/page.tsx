import Link from "next/link";
import { AlertCircle, ArrowRight, Database, FilePlus2, Plus } from "lucide-react";
import { listReports } from "@/lib/api";
import { Card } from "@/components/ui/card";

// `force-dynamic` kaldırıldı — Data Cache 5 dk RAM'de tutsun diye.

export default async function ReportsListPage() {
  let reports: Awaited<ReturnType<typeof listReports>> = [];
  let apiError: string | null = null;
  try {
    reports = await listReports();
  } catch (err) {
    apiError = (err as Error).message;
  }

  return (
    <div className="space-y-8">
      <section className="flex items-end justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <Link href="/" className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">
            ← Radar
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Kayıtlı raporlar</h1>
          <p className="text-fg-2 text-sm max-w-xl leading-relaxed">
            Doğal dil ile üretilen ve kaydedilen serbest raporlar. Radar dışında, talebe özel sorgular.
          </p>
        </div>
        <Link
          href="/reports/new"
          className="inline-flex items-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md text-sm font-medium shadow-xs hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Plus size={15} />
          Yeni rapor
        </Link>
      </section>

      {apiError && (
        <Card tone="bad" padding="md">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-bad mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium">API'ye ulaşılamadı</div>
              <code className="text-xs text-fg-2 block mt-1">{apiError}</code>
            </div>
          </div>
        </Card>
      )}

      {!apiError && reports.length === 0 && (
        <Card padding="lg" className="text-center py-12">
          <FilePlus2 size={32} className="text-muted-2 mx-auto mb-3" />
          <div className="text-fg font-medium">Henüz kayıtlı rapor yok</div>
          <div className="text-muted text-sm mt-2 max-w-md mx-auto">
            "Yeni rapor"a tıklayıp Türkçe ile bir talep yazın. Beğendiğiniz çıktıyı kaydedebilirsiniz.
          </div>
        </Card>
      )}

      {reports.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reports.map((r) => (
            <li key={r.id}>
              <Link
                href={`/reports/${r.id}`}
                className="group block rounded-lg border border-border bg-surface hover:border-accent/40 p-5 transition-all shadow-xs hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{r.name}</div>
                    {r.description && (
                      <div className="text-fg-2 text-sm mt-1 line-clamp-2 leading-relaxed">
                        {r.description}
                      </div>
                    )}
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-muted-2 shrink-0 mt-1 transition-all group-hover:text-accent group-hover:translate-x-0.5"
                  />
                </div>
                <div className="text-xs text-muted mt-4 flex items-center gap-3 pt-3 border-t border-border/60">
                  <span className="tabular-nums">
                    {new Date(r.updatedAt).toLocaleString("tr-TR")}
                  </span>
                  {r.retrievedTables && (
                    <span className="inline-flex items-center gap-1">
                      <Database size={11} />
                      {r.retrievedTables.length} tablo
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
