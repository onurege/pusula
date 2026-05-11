import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { RadarBlockResult } from "@/lib/api";
import { runRadarApi } from "@/lib/api";
import { AnomalyCallouts } from "@/components/anomaly-callouts";
import { KpiCard } from "@/components/kpi-card";
import { ManagerBrief } from "@/components/manager-brief";
import { RadarChart } from "@/components/radar-chart-client";
import { RadarRefreshButton } from "@/components/radar-refresh-button";
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

  // Chart pairing — first two side-by-side, rest stacked.
  const [chartA, chartB, ...chartRest] = chartBlocks;

  return (
    <div className="space-y-4">
      {/* Header — single row, kompakt, scanable */}
      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <Link href="/" className="text-xs text-muted hover:text-fg">← Tüm radarlar</Link>
          <h1 className="text-xl font-semibold tracking-tight">{run.title}</h1>
          {run.description && (
            <span className="text-muted text-xs hidden lg:inline">· {run.description}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted tabular-nums">
            Üretildi: {new Date(run.generatedAt).toLocaleString("tr-TR")}
          </span>
          <RadarRefreshButton radarId={run.id} params={run.params} />
        </div>
      </header>

      {/* Above-the-fold — Brief 8/12 sol (büyük, okunaklı), KPI 4/12 sağ (3 satır yatay) */}
      <div className="grid grid-cols-12 gap-4 items-stretch">
        {/* Brief — dominant, 8 of 12 */}
        {run.brief && (
          <div className="col-span-12 lg:col-span-8">
            <ManagerBrief
              brief={run.brief}
              date={new Date(run.generatedAt).toLocaleDateString("tr-TR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            />
          </div>
        )}

        {/* KPI sidebar — 4 of 12, yatay kartlar dikey alt alta 3 satır */}
        {kpiBlock?.kpis && kpiBlock.kpis.length > 0 && (
          <section className="col-span-12 lg:col-span-4 flex flex-col gap-3">
            {kpiBlock.kpis.map((k) => (
              <KpiCard
                key={k.id}
                label={k.label}
                value={k.value}
                unit={k.unit}
                delta={k.delta}
                tone={k.tone}
                hint={k.hint}
                orientation="horizontal"
              />
            ))}
          </section>
        )}

        {/* Anomalies — full width altta, kompakt liste */}
        {anomalyBlock && (
          <section className="col-span-12">
            <div className="flex items-baseline gap-3 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-bad font-semibold">
                Bugün dikkat çekenler
              </div>
              <span className="text-xs text-muted">
                {anomalyBlock.anomalies?.length ?? 0} sapma
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
      </div>

      {/* Charts + AI narrative side-by-side. Narrative balances out the
          chart's empty space and gives the page rhythmic widths. */}
      {(chartA || chartB) && (
        <div className="grid grid-cols-12 gap-4">
          {chartA && (
            <ChartSection
              block={chartA}
              colSpan={
                chartB
                  ? "lg:col-span-7"
                  : chartA.narrative
                  ? "lg:col-span-8"
                  : "lg:col-span-12"
              }
            />
          )}
          {!chartB && chartA?.narrative && (
            <NarrativeColumn text={chartA.narrative} colSpan="lg:col-span-4" />
          )}
          {chartB && <ChartSection block={chartB} colSpan="lg:col-span-5" />}
        </div>
      )}

      {/* Geri kalan chart'lar — full-width stack, narrative beside each */}
      {chartRest.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {chartRest.map((b) => (
            <Fragment key={b.id}>
              <ChartSection
                block={b}
                colSpan={b.narrative ? "lg:col-span-8" : "lg:col-span-12"}
              />
              {b.narrative && (
                <NarrativeColumn text={b.narrative} colSpan="lg:col-span-4" />
              )}
            </Fragment>
          ))}
        </div>
      )}

      {/* Table'lar — alt bölüm, full-width */}
      {tableBlocks.map((b) => (
        <section key={b.id} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{b.title}</h2>
              {b.description && (
                <p className="text-muted text-xs mt-0.5 max-w-2xl">{b.description}</p>
              )}
            </div>
          </div>
          {b.error ? (
            <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <code className="text-xs">{b.error}</code>
            </div>
          ) : (
            <ResultTable rows={b.rows} max={50} />
          )}
          {b.narrative && <NarrativeCard text={b.narrative} />}
        </section>
      ))}
    </div>
  );
}

function ChartSection({
  block,
  colSpan,
}: {
  block: RadarBlockResult;
  colSpan: string;
}) {
  // ChartSection no longer renders narrative — that's a sibling component
  // in the same grid (NarrativeColumn) so chart and narrative sit side-by-side
  // with proper height alignment.
  return (
    <section className={`col-span-12 ${colSpan} space-y-3`}>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{block.title}</h2>
        {block.description && (
          <p className="text-muted text-xs mt-0.5 line-clamp-2">{block.description}</p>
        )}
      </div>
      {block.error ? (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          <code className="text-xs">{block.error}</code>
        </div>
      ) : block.chart ? (
        <div className="rounded-xl border border-border bg-surface shadow-xs p-3">
          <RadarChart spec={block.chart} rows={block.rows} />
        </div>
      ) : null}
    </section>
  );
}

function NarrativeColumn({ text, colSpan }: { text: string; colSpan: string }) {
  return (
    <section className={`col-span-12 ${colSpan} flex`}>
      {/* mt-7 + height stretch keeps the card aligned with the chart card's
          top edge (chart section has h2 + description above the visual). */}
      <div className="rounded-xl border border-accent/40 bg-[var(--color-accent-soft)] px-5 py-4 mt-7 flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-accent font-semibold">
          <span className="size-1.5 rounded-full bg-accent" />
          AI Analizi
        </div>
        <p className="text-[14px] leading-relaxed text-fg flex-1">{text}</p>
      </div>
    </section>
  );
}

function NarrativeCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-accent/40 bg-[var(--color-accent-soft)] px-5 py-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-accent font-semibold mb-2">
        <span className="size-1.5 rounded-full bg-accent" />
        AI Analizi
      </div>
      <p className="text-[14px] leading-relaxed text-fg">{text}</p>
    </div>
  );
}
