import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { getReport, runReport } from "@/lib/api";
import { ResultTable } from "@/components/result-table";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let report;
  try {
    report = await getReport(id);
  } catch {
    notFound();
  }
  if (!report) notFound();

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/reports" className="text-sm text-muted hover:text-fg">← Kayıtlı raporlar</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">{report.name}</h1>
          {report.description && (
            <p className="text-muted text-sm mt-1 max-w-2xl">{report.description}</p>
          )}
          {report.userPrompt && (
            <p className="text-muted text-sm mt-3 italic max-w-2xl">"{report.userPrompt}"</p>
          )}
        </div>
        <RunButton id={id} />
      </div>

      {report.brief && (
        <section className="rounded-lg border border-accent/40 bg-accent/5 p-5">
          <div className="text-xs uppercase tracking-wide text-accent font-semibold mb-2">AI Brief</div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{report.brief}</div>
        </section>
      )}

      <section>
        <div className="text-xs uppercase tracking-wide text-muted font-semibold mb-2">SQL</div>
        <pre className="rounded-lg border border-border bg-surface p-4 overflow-auto text-xs font-mono leading-relaxed">
          {report.sql}
        </pre>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-xs uppercase tracking-wide text-muted font-semibold">
            Sonuç
            {report.latestRun && (
              <span className="ml-2 text-muted/80 normal-case font-normal">
                · {report.latestRun.rowCount.toLocaleString("tr-TR")} satır
                {report.latestRun.truncated ? " (kesildi)" : ""}
                · {report.latestRun.durationMs}ms
                · {new Date(report.latestRun.startedAt).toLocaleString("tr-TR")}
              </span>
            )}
          </div>
        </div>
        {report.latestRun ? (
          <ResultTable rows={report.latestRun.sampleRows} max={50} />
        ) : (
          <div className="text-muted text-sm">
            Henüz çalıştırılmadı. Sağdaki "Çalıştır" düğmesine basın.
          </div>
        )}
      </section>

      {report.retrievedTables && report.retrievedTables.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-wide text-muted font-semibold mb-2">Bağlam tabloları</div>
          <div className="flex flex-wrap gap-2">
            {report.retrievedTables.map((t) => (
              <code key={t} className="text-xs bg-surface border border-border px-2 py-1 rounded">{t}</code>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RunButton({ id }: { id: string }) {
  async function run() {
    "use server";
    await runReport(id, 1000);
    revalidatePath(`/reports/${id}`);
  }
  return (
    <form action={run}>
      <button
        type="submit"
        className="inline-flex items-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md font-medium hover:opacity-90"
      >
        Çalıştır
      </button>
    </form>
  );
}
