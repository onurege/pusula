import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, AlertCircle, ArrowRight, FilePlus2, FileText } from "lucide-react";
import { listRadars } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { Card } from "@/components/ui/card";

// `force-dynamic` kaldırıldı — Data Cache 5 dk RAM'de tutsun diye.
// Tag invalidate'i navbar refresh butonu yapıyor.

const RADAR_GRADIENTS: Record<string, string> = {
  sales: "from-accent/20 via-accent/5 to-transparent",
  tahsilat: "from-warn/20 via-warn/5 to-transparent",
  temsilci: "from-good/20 via-good/5 to-transparent",
  stock: "from-good/20 via-good/5 to-transparent",
  finance: "from-bad/20 via-bad/5 to-transparent",
  executive: "from-fg/10 via-fg/3 to-transparent",
};

export default async function HomePage() {
  // Tenant varsayılan iniş yolu ayarlıysa (ör. Wietnauer → /v3), kök `/`
  // oraya yönlendirilir. Tanımsız tenant'lar (Pernod) V1 ana ekranını görür.
  const { ui } = getTenantConfig();
  if (ui?.defaultLanding && ui.defaultLanding !== "/") {
    redirect(ui.defaultLanding);
  }

  let radars: Awaited<ReturnType<typeof listRadars>> = [];
  let apiError: string | null = null;
  try {
    radars = await listRadars();
  } catch (err) {
    apiError = (err as Error).message;
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-accent font-semibold bg-[var(--color-accent-soft)] border border-accent/20 rounded-md px-2 py-1">
          <Activity size={11} />
          Radar
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Bugün ne oluyor?</h1>
        <p className="text-fg-2 text-[15px] max-w-2xl leading-relaxed">
          Bölge yöneticisi ve satış operasyon ekipleri için tek bakışta KPI'lar,
          trend grafikleri ve Türkçe yönetici brifingi. Excel'i açıp süzmek
          yerine bir radar seç — gerisini sistem anlatsın.
        </p>
      </section>

      {apiError && (
        <Card tone="bad" padding="md">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-bad mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-fg">API'ye ulaşılamadı</div>
              <code className="block mt-1 text-xs text-fg-2">{apiError}</code>
              <div className="mt-2 text-muted text-xs">
                Backend açık mı? <code className="text-fg-2">npm run api:start</code> ile başlatın.
              </div>
            </div>
          </div>
        </Card>
      )}

      {!apiError && radars.length === 0 && (
        <Card padding="lg" className="text-center py-12">
          <div className="text-fg font-medium">Henüz radar tanımı yok</div>
          <div className="text-muted text-sm mt-2">
            <code className="text-fg-2">data/radars/</code> altına bir JSON ekleyin
            (örnek: <code className="text-fg-2">sales.json</code>).
          </div>
        </Card>
      )}

      {radars.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {radars.map((r) => {
            const gradient = RADAR_GRADIENTS[r.id] ?? RADAR_GRADIENTS.executive!;
            return (
              <Link
                key={r.id}
                href={`/radar/${r.id}`}
                className="group relative overflow-hidden rounded-xl border border-border bg-surface hover:border-accent/40 transition-all p-6 min-h-44 shadow-xs hover:shadow-md"
              >
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} opacity-60 group-hover:opacity-100 transition`}
                />
                <div className="relative">
                  <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                    Radar
                  </div>
                  <div className="text-xl font-semibold tracking-tight mt-2">{r.title}</div>
                  {r.tagline && (
                    <div className="text-fg-2 text-sm mt-2 max-w-md leading-relaxed">
                      {r.tagline}
                    </div>
                  )}
                  <div className="text-muted text-xs mt-5 flex items-center gap-1.5">
                    Tek tık → KPI · grafik · yönetici özeti
                    <ArrowRight
                      size={12}
                      className="text-accent transition-transform group-hover:translate-x-0.5"
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      )}

      <section className="border-t border-border pt-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-muted">
          Hazır radar dışında bir şey mi lazım?
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors"
          >
            <FileText size={14} />
            Kayıtlı raporlar
          </Link>
          <Link
            href="/reports/new"
            className="inline-flex items-center gap-2 bg-accent text-accent-fg px-4 h-9 rounded-md text-sm font-medium shadow-xs hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <FilePlus2 size={14} />
            Yeni rapor üret
          </Link>
        </div>
      </section>
    </div>
  );
}
