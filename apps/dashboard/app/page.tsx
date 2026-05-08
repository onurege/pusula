import Link from "next/link";
import { listRadars } from "@/lib/api";

export const dynamic = "force-dynamic";

const RADAR_GRADIENTS: Record<string, string> = {
  sales:
    "from-accent/30 via-accent/10 to-transparent",
  stock:
    "from-good/25 via-good/10 to-transparent",
  finance:
    "from-bad/25 via-bad/10 to-transparent",
  executive:
    "from-fg/15 via-fg/5 to-transparent",
};

export default async function HomePage() {
  let radars: Awaited<ReturnType<typeof listRadars>> = [];
  let apiError: string | null = null;
  try {
    radars = await listRadars();
  } catch (err) {
    apiError = (err as Error).message;
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="text-xs uppercase tracking-wide text-muted">Radar</div>
        <h1 className="text-3xl font-semibold tracking-tight mt-2">Bugün ne oluyor?</h1>
        <p className="text-muted text-sm mt-2 max-w-2xl">
          Bölge yöneticisi ve satış operasyon ekipleri için tek-bakışta KPI'lar,
          trend grafikleri ve Türkçe yönetici brifingi. Excel'i açıp süzmek yerine bir radar seç, gerisini sistem anlatsın.
        </p>
      </section>

      {apiError && (
        <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          API'ye ulaşılamadı: <code className="text-xs">{apiError}</code>
          <div className="mt-1 text-muted text-xs">
            Backend açık mı? <code>npm run api:start</code> ile başlatın.
          </div>
        </div>
      )}

      {!apiError && radars.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <div className="text-fg font-medium">Henüz radar tanımı yok</div>
          <div className="text-muted text-sm mt-2">
            <code>data/radars/</code> altına bir JSON ekleyin (örnek: <code>sales.json</code>).
          </div>
        </div>
      )}

      {radars.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {radars.map((r) => {
            const gradient = RADAR_GRADIENTS[r.id] ?? RADAR_GRADIENTS.executive!;
            return (
              <Link
                key={r.id}
                href={`/radar/${r.id}`}
                className={`group relative overflow-hidden rounded-xl border border-border bg-surface hover:bg-surface-2 transition p-6 min-h-44`}
              >
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} opacity-70 group-hover:opacity-100 transition`}
                />
                <div className="relative">
                  <div className="text-xs uppercase tracking-wide text-muted">Radar</div>
                  <div className="text-xl font-semibold tracking-tight mt-2">{r.title}</div>
                  {r.tagline && (
                    <div className="text-fg/80 text-sm mt-2 max-w-md">{r.tagline}</div>
                  )}
                  <div className="text-muted text-xs mt-4 flex items-center gap-2">
                    Tek tık → KPI · grafik · yönetici özeti
                    <span className="text-accent">→</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      )}

      <section className="border-t border-border pt-6 flex items-center justify-between text-sm text-muted">
        <div>
          Hazır radar dışında bir şey mi lazım?
        </div>
        <div className="flex items-center gap-4">
          <Link href="/reports" className="hover:text-fg">Kayıtlı raporlar →</Link>
          <Link href="/reports/new" className="bg-accent text-accent-fg px-4 h-9 rounded-md font-medium flex items-center hover:opacity-90">
            Yeni rapor üret
          </Link>
        </div>
      </section>
    </div>
  );
}
