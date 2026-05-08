import Link from "next/link";
import { notFound } from "next/navigation";
import { runRadarApi } from "@/lib/api";
import { AnomalyCallouts } from "@/components/anomaly-callouts";
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

  const anomalyBlock = run.blocks.find((b) => b.display === "anomalies");
  const kpiBlock = run.blocks.find((b) => b.display === "kpi-row");
  const chartBlocks = run.blocks.filter((b) => b.display === "chart");
  const tableBlocks = run.blocks.filter((b) => b.display === "table");

  return (
    <div className="space-y-10">
      {/* Header — kompakt, scanable */}
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Link href="/" className="text-xs text-muted hover:text-fg">← Tüm radarlar</Link>
          <h1 className="text-3xl font-semibold tracking-tight mt-1">{run.title}</h1>
          {run.description && (
            <p className="text-muted text-sm mt-1 max-w-2xl">{run.description}</p>
          )}
        </div>
        <div className="text-[11px] text-muted text-right tabular-nums">
          <div>{new Date(run.generatedAt).toLocaleString("tr-TR")}</div>
          <div className="opacity-70">
            {Object.entries(run.params).map(([k, v]) => `${k}=${v}`).join(" · ")}
          </div>
        </div>
      </header>

      {/* Yönetici Brifingi — sayfanın en üstü, en görünür yer.
          Her şeyden önce yönetici bunu okusun. */}
      {run.brief && (
        <section className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent p-7">
          <div className="text-[11px] uppercase tracking-wider text-accent font-semibold mb-3">
            Yönetici Brifingi · {new Date(run.generatedAt).toLocaleDateString("tr-TR", { weekday: "long", day: "2-digit", month: "long" })}
          </div>
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-fg/95 max-w-4xl">
            {run.brief}
          </div>
        </section>
      )}

      {/* KPI grid — büyük, dominant, kompakt formatlı */}
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

      {/* Anomaly section — tone-driven, drama edinen tipografi */}
      {anomalyBlock && (
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-bad font-semibold">
                Bugün dikkat çekenler
              </div>
              <h2 className="text-xl font-semibold tracking-tight mt-1">{anomalyBlock.title}</h2>
              {anomalyBlock.description && (
                <p className="text-muted text-sm mt-0.5 max-w-2xl">{anomalyBlock.description}</p>
              )}
            </div>
            <span className="text-xs text-muted tabular-nums">
              {anomalyBlock.anomalies?.length ?? 0} sapma · {anomalyBlock.durationMs}ms
            </span>
          </div>
          {anomalyBlock.error ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <code className="text-xs">{anomalyBlock.error}</code>
            </div>
          ) : (
            <AnomalyCallouts radarId={run.id} items={anomalyBlock.anomalies ?? []} />
          )}
        </section>
      )}

      {/* Charts — narrative açıkça çağrı yapan sub-paragraf */}
      {chartBlocks.map((b) => (
        <section key={b.id} className="space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-medium tracking-tight">{b.title}</h2>
              {b.description && <p className="text-muted text-sm mt-0.5">{b.description}</p>}
            </div>
            <span className="text-[11px] text-muted tabular-nums">
              {b.rowCount} satır · {b.durationMs}ms
            </span>
          </div>
          {b.error ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <code className="text-xs">{b.error}</code>
            </div>
          ) : b.chart ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <RadarChart spec={b.chart} rows={b.rows} />
            </div>
          ) : null}
          {b.narrative && (
            <p className="text-sm leading-relaxed text-fg/85 max-w-3xl border-l-2 border-accent/40 pl-4">
              {b.narrative}
            </p>
          )}
          {b.rows.length > 0 && (
            <details>
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
        <section key={b.id} className="space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-medium tracking-tight">{b.title}</h2>
              {b.description && <p className="text-muted text-sm mt-0.5">{b.description}</p>}
            </div>
            <span className="text-[11px] text-muted tabular-nums">{b.rowCount} satır · {b.durationMs}ms</span>
          </div>
          {b.error ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <code className="text-xs">{b.error}</code>
            </div>
          ) : (
            <ResultTable rows={b.rows} max={50} />
          )}
          {b.narrative && (
            <p className="text-sm leading-relaxed text-fg/85 max-w-3xl border-l-2 border-accent/40 pl-4">
              {b.narrative}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
