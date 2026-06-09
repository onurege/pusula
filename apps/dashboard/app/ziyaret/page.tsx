import { AlertCircle, CalendarClock } from "lucide-react";
import { listMapCustomers, getMapSyncStatus } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { VisitGapList } from "@/components/visit-gap-list";

// `force-dynamic` kaldırıldı — searchParams Promise zaten dynamic tetikliyor.

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ZiyaretPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const thresholdRaw = typeof sp.gun === "string" ? sp.gun : undefined;
  const threshold =
    thresholdRaw && !isNaN(Number(thresholdRaw)) ? Number(thresholdRaw) : 30;

  // Pull customers from local SQLite mirror — no MSSQL hit on page load.
  // `minDaysSinceVisit` filters at the source query.
  const [customersResult, syncResult] = await Promise.allSettled([
    listMapCustomers({ minDaysSinceVisit: threshold, limit: 500 }),
    getMapSyncStatus(),
  ]);

  const customers =
    customersResult.status === "fulfilled" ? customersResult.value.customers : [];
  const sync = syncResult.status === "fulfilled" ? syncResult.value : null;
  const apiError =
    customersResult.status === "rejected"
      ? (customersResult.reason as Error).message
      : null;

  // Filter to customers with at least some history — pure dormant accounts
  // (never bought, never visited) aren't actionable for a rep's "ziyaret"
  // list. We want accounts that ARE customers but went silent.
  const candidates = customers.filter(
    (c) =>
      c.daysSinceLastVisit !== null &&
      ((c.ciroPrev30 ?? 0) > 0 || (c.ciro30 ?? 0) > 0 || c.daysSinceLastSale !== null),
  );

  // Sort by exposure: days × historical ciro. Big account ignored long → top.
  const ranked = [...candidates].sort((a, b) => {
    const scoreA = (a.daysSinceLastVisit ?? 0) * Math.max(a.ciroPrev30 ?? 0, a.ciro30 ?? 0, 1);
    const scoreB = (b.daysSinceLastVisit ?? 0) * Math.max(b.ciroPrev30 ?? 0, b.ciro30 ?? 0, 1);
    return scoreB - scoreA;
  });

  const longestGap = ranked.reduce(
    (m, c) => Math.max(m, c.daysSinceLastVisit ?? 0),
    0,
  );
  const exposedCiro = ranked.reduce(
    (sum, c) => sum + Math.max(c.ciroPrev30 ?? 0, c.ciro30 ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-warn font-semibold bg-[var(--color-warn-soft)] border border-warn/20 rounded-md px-2 py-1">
          <CalendarClock size={11} />
          Ziyaret boşluğu
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Bu hafta ziyaret et</h1>
        <p className="text-fg-2 text-[15px] max-w-2xl leading-relaxed">
          En az <span className="text-fg font-medium">{threshold}</span> gündür
          hiç ziyaret edilmemiş{" "}
          <span className="text-fg font-medium">{ranked.length}</span> müşteri.
          {longestGap > 0 && (
            <>
              {" "}En uzun ara{" "}
              <span className="text-warn font-medium">{longestGap} gün</span>.
            </>
          )}
          {" "}Toplam{" "}
          <span className="text-fg font-medium">
            {Math.round(exposedCiro).toLocaleString("tr-TR")} ₺
          </span>{" "}
          tarihçeli ciro sahaya çıkmadan duruyor.
        </p>
        {sync?.lastSyncAt && (
          <p className="text-xs text-muted">
            Veri yaşı: {formatRelative(sync.lastSyncAt)} · Map sayfasındaki{" "}
            <span className="text-fg-2">Verileri yenile</span> butonu ile güncellenir.
          </p>
        )}
      </header>

      {apiError && (
        <Card tone="bad" padding="md">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-bad mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium">Liste alınamadı</div>
              <code className="text-xs text-fg-2 block mt-1">{apiError}</code>
            </div>
          </div>
        </Card>
      )}

      {!apiError && ranked.length === 0 && (
        <Card padding="lg" className="text-center py-12">
          <CalendarClock size={32} className="text-muted-2 mx-auto mb-3" />
          <div className="text-fg font-medium">
            {threshold}+ gündür ziyaretsiz aktif müşteri yok
          </div>
          <div className="text-muted text-sm mt-2 max-w-md mx-auto">
            Sahanız iyi durumda. Eşiği düşürerek tekrar deneyebilir veya map
            sayfasında <span className="text-fg-2">Verileri yenile</span>'ye
            basıp güncel veriyi çekebilirsin.
          </div>
        </Card>
      )}

      {ranked.length > 0 && (
        <VisitGapList customers={ranked} threshold={threshold} />
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "az önce";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  return `${d} gün önce`;
}
