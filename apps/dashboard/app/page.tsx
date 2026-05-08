import Link from "next/link";
import { listReports } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let reports: Awaited<ReturnType<typeof listReports>> = [];
  let apiError: string | null = null;
  try {
    reports = await listReports();
  } catch (err) {
    apiError = (err as Error).message;
  }

  return (
    <div className="space-y-8">
      <section className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Raporlar</h1>
          <p className="text-muted text-sm mt-1">
            Univera'dan üretilen, kaydedilen ve tekrar çalıştırılan raporlar.
          </p>
        </div>
        <Link
          href="/reports/new"
          className="inline-flex items-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md font-medium hover:opacity-90"
        >
          + Yeni rapor
        </Link>
      </section>

      {apiError && (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          API'ye ulaşılamadı: <code className="text-xs">{apiError}</code>
          <div className="mt-1 text-muted text-xs">
            Backend açık mı? <code>npm run api:start</code> ile başlatın.
          </div>
        </div>
      )}

      {!apiError && reports.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <div className="text-fg font-medium">Henüz rapor yok</div>
          <div className="text-muted text-sm mt-2">
            "Yeni rapor"a tıklayıp doğal Türkçe ile bir talep yazın.
          </div>
        </div>
      )}

      {reports.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reports.map((r) => (
            <li key={r.id}>
              <Link
                href={`/reports/${r.id}`}
                className="block rounded-lg border border-border bg-surface hover:bg-surface-2 p-5 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    {r.description && (
                      <div className="text-muted text-sm mt-1 line-clamp-2">{r.description}</div>
                    )}
                  </div>
                  <code className="text-[10px] text-muted shrink-0 mt-1">{r.id.slice(0, 8)}</code>
                </div>
                <div className="text-xs text-muted mt-3 flex items-center gap-3">
                  <span>{new Date(r.updatedAt).toLocaleString("tr-TR")}</span>
                  {r.retrievedTables && (
                    <span>· {r.retrievedTables.length} tablo</span>
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
