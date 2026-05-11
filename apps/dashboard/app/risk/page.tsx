import { AlertCircle } from "lucide-react";
import { listMapCustomers, getMapSyncStatus } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { RiskCallList } from "@/components/risk-call-list";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  // Pull high-risk customers from the local SQLite mirror — no MSSQL hit on
  // page load. The sync job already computed risk_tier at write time.
  const [customersResult, syncResult] = await Promise.allSettled([
    listMapCustomers({ riskTier: "high", limit: 200 }),
    getMapSyncStatus(),
  ]);

  const customers =
    customersResult.status === "fulfilled" ? customersResult.value.customers : [];
  const sync =
    syncResult.status === "fulfilled" ? syncResult.value : null;
  const apiError =
    customersResult.status === "rejected"
      ? (customersResult.reason as Error).message
      : null;

  // Sort by lost revenue (prev - curr) so the biggest bleeders are at the top.
  // Falls back to ciroPrev30 for customers with no current-period sale.
  const ranked = [...customers].sort((a, b) => {
    const lostA = (a.ciroPrev30 ?? 0) - (a.ciro30 ?? 0);
    const lostB = (b.ciroPrev30 ?? 0) - (b.ciro30 ?? 0);
    return lostB - lostA;
  });

  const totalLost = ranked.reduce(
    (acc, c) => acc + Math.max(0, (c.ciroPrev30 ?? 0) - (c.ciro30 ?? 0)),
    0,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-bad font-semibold bg-[var(--color-bad-soft)] border border-bad/20 rounded-md px-2 py-1">
          <span className="size-1.5 rounded-full bg-bad animate-pulse" />
          Kayıp Riski
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Bu hafta arayın</h1>
        <p className="text-fg-2 text-[15px] max-w-2xl leading-relaxed">
          Cirosu düşmüş veya tamamen sessizleşmiş{" "}
          <span className="text-fg font-medium">{ranked.length}</span> müşteri.{" "}
          Geçen 30 günle kıyaslandığında toplam{" "}
          <span className="text-bad font-medium">
            {Math.round(totalLost).toLocaleString("tr-TR")} ₺
          </span>{" "}
          ciro kaybı söz konusu.
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
          <div className="text-fg font-medium">Yüksek riskli müşteri yok</div>
          <div className="text-muted text-sm mt-2 max-w-md mx-auto">
            Şu an risk eşiğini aşan müşteri bulunmuyor. Map'te{" "}
            <span className="text-fg-2">Verileri yenile</span>'ye basıp tekrar denemek isteyebilirsin.
          </div>
        </Card>
      )}

      {ranked.length > 0 && <RiskCallList customers={ranked} />}
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
