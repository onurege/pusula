import Link from "next/link";
import { notFound } from "next/navigation";
import { runRadarApi } from "@/lib/api";
import { KpiCard } from "@/components/kpi-card";
import { RadarChart } from "@/components/radar-chart-client";
import { ResultTable } from "@/components/result-table";

export const dynamic = "force-dynamic";

export default async function RadarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // Pull simple scalar params from the URL — days, topN, region etc.
  const userParams: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(sp ?? {})) {
    if (typeof v === "string" && v !== "") {
      const n = Number(v);
      userParams[k] = isNaN(n) ? v : n;
    }
  }

  let run;
  try {
    run = await runRadarApi(id, userParams);
  } catch {
    notFound();
  }

  if (!run) notFound();

  const kpiBlock = run.blocks.find((b) => b.display === "kpi-row");
  const chartBlocks = run.blocks.filter((b) => b.display === "chart");
  const tableBlocks = run.blocks.filter((b) => b.display === "table");

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-fg">← Tüm raporlar</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">{run.title}</h1>
          <p className="text-muted text-sm mt-1 max-w-2xl">{run.description}</p>
        </div>
        <div className="text-xs text-muted text-right">
          <div>{new Date(run.generatedAt).toLocaleString("tr-TR")}</div>
          <div>parametreler: {Object.entries(run.params).map(([k, v]) => `${k}=${v}`).join(", ")}</div>
        </div>
      </header>

      {kpiBlock?.kpis && kpiBlock.kpis.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {kpiBlock.kpis.map((k) => (
            <KpiCard
              key={k.id}
              label={k.label}
              value={k.value}
              unit={k.unit}
              delta={k.delta}
              tone={k.tone}
              hint={k.hint}
            />
          ))}
        </section>
      )}

      {run.brief && (
        <section className="rounded-lg border border-accent/40 bg-accent/5 p-5">
          <div className="text-xs uppercase tracking-wide text-accent font-semibold mb-2">
            Yönetici Brifingi
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{run.brief}</div>
        </section>
      )}

      {chartBlocks.map((b) => (
        <section key={b.id}>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h2 className="text-lg font-medium tracking-tight">{b.title}</h2>
              {b.description && <p className="text-muted text-sm mt-0.5">{b.description}</p>}
            </div>
            <span className="text-xs text-muted">
              {b.rowCount} satır · {b.durationMs}ms
            </span>
          </div>
          {b.error ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <code className="text-xs">{b.error}</code>
            </div>
          ) : b.chart ? (
            <div className="rounded-lg border border-border bg-surface p-4">
              <RadarChart spec={b.chart} rows={b.rows} />
            </div>
          ) : null}
          {b.rows.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-muted cursor-pointer hover:text-fg">
                Ham veri
              </summary>
              <div className="mt-2">
                <ResultTable rows={b.rows} max={20} />
              </div>
            </details>
          )}
        </section>
      ))}

      {tableBlocks.map((b) => (
        <section key={b.id}>
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h2 className="text-lg font-medium tracking-tight">{b.title}</h2>
              {b.description && <p className="text-muted text-sm mt-0.5">{b.description}</p>}
            </div>
            <span className="text-xs text-muted">{b.rowCount} satır · {b.durationMs}ms</span>
          </div>
          {b.error ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <code className="text-xs">{b.error}</code>
            </div>
          ) : (
            <ResultTable rows={b.rows} max={50} />
          )}
        </section>
      ))}
    </div>
  );
}
