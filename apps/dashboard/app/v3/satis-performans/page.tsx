import { cs, panelHidden } from "@/lib/content";
import type { WietnauerSatisSnapshot } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { RepLeaderboardPanel } from "@/components/v3/satis/RepLeaderboardPanel";
import {
  SalesVelocityPanel,
  type SatisDistRowWithVelocity,
} from "@/components/v3/satis/SalesVelocityPanel";
import { DropSizePanel } from "@/components/v3/satis/DropSizePanel";
import { NewCustomersPanel } from "@/components/v3/satis/NewCustomersPanel";
import { AvgOrderTrendPanel } from "@/components/v3/satis/AvgOrderTrendPanel";
import { SatisDateRangePicker } from "@/components/v3/satis/SatisDateRangePicker";
import { SatisUnitToggle } from "@/components/v3/satis/SatisUnitToggle";
import { formatCompact } from "@/components/komuta/format";

export const metadata = { title: "Satış Performansı · V3 · Insider" };

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
// `lib/api.ts`'teki `request()` ile aynı sözleşme (Bearer cookie forward,
// aynı base URL) — o dosya bu görevin dosya kapsamı DIŞINDA olduğu için
// (paralel agent'lar aynı paylaşılan dosyayı değiştiriyor olabilir; çakışma
// riskini önlemek adına dokunulmadı) burada page-local olarak yeniden
// uygulanıyor. `getWietnauerSatis()` yalnızca `refresh` query'sini forward
// ediyor — `from`/`to` iletmek için gerekli.
const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";
const AUTH_COOKIE = "enroute_auth";

function normDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return DATE_RX.test(s) ? s : null;
}

function formatDateTr(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
  });
}

/**
 * md21 — `/api/wietnauer/satis` çağrısı, `?from=&to=` ile. Sayfa kapsamına
 * özgü (bkz. yukarıdaki not) — auth/cache davranışı `lib/api.ts#request()`
 * ile birebir aynı: token varsa Bearer + no-store (kullanıcıya özel yanıt
 * cache'lenmez), token yoksa da no-store (tarih aralığı dinamik, Next Data
 * Cache tag karmaşasına gerek yok).
 */
async function fetchSatisSnapshot(params: {
  dateFrom: string | null;
  dateTo: string | null;
}): Promise<WietnauerSatisSnapshot> {
  const qs = new URLSearchParams();
  if (params.dateFrom) qs.set("from", params.dateFrom);
  if (params.dateTo) qs.set("to", params.dateTo);
  const query = qs.toString();
  const path = `/api/wietnauer/satis${query ? `?${query}` : ""}`;

  let token: string | null = null;
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    token = store.get(AUTH_COOKIE)?.value ?? null;
  } catch {
    token = null;
  }

  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text) as { error?: string; stack?: string };
      detail = [j.error, j.stack].filter(Boolean).join("\n");
    } catch {
      /* leave as-is */
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json() as Promise<WietnauerSatisSnapshot>;
}

type Props = {
  searchParams: Promise<{ from?: string; to?: string; unit?: string }>;
};

/**
 * V3 Dashboard #2 — Satış Performansı.
 *
 * Wietnauer talebi (HEDEF GERÇEKLEŞMESİ HARİÇ — kullanıcı kararı):
 *   A) Distribütör leaderboard (ciro + delta)
 *   B) Satış temsilcisi leaderboard (ciro + delta)
 *   C) Drop Size — nokta başına ortalama ciro
 *   D) Yeni müşteri kazanımı (son 90g ilk fatura)
 *   E) Ortalama sipariş büyüklüğü trendi (son 12 ay)
 *
 * md21 — `?from=YYYY-MM-DD&to=YYYY-MM-DD` özel tarih aralığı + `?unit=`
 * TL↔hacim görünüm anahtarı eklendi. Şehir/dist scope backend'de (JWT'den
 * sunucu-otoriter) uygulanıyor — burada dokunulmadı.
 *
 * Server component: snapshot SSR'da çekiliyor, panel'ler salt-okunur —
 * yalnızca tarih seçici ve birim toggle'ı client-side (URL-state, RSC
 * yeniden render).
 */
export default async function V3SatisPerformansPage({ searchParams }: Props) {
  const tenant = getTenantConfig();
  const sp = await searchParams;
  const dateFrom = normDate(sp.from);
  const dateTo = normDate(sp.to);
  const hasCustomRange = Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  const volumeKey = tenant.volume.key;
  const unit = sp.unit === volumeKey ? volumeKey : "tl";
  const rangeLabel = hasCustomRange && dateFrom && dateTo
    ? `${formatDateTr(dateFrom)} – ${formatDateTr(dateTo)}`
    : "Son 30g";

  let snap: WietnauerSatisSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await fetchSatisSnapshot({
      dateFrom: hasCustomRange ? dateFrom : null,
      dateTo: hasCustomRange ? dateTo : null,
    });
  } catch (e) {
    err = (e as Error).message;
  }

  // Üst şerit KPI türevleri — leaderboard'tan kestirme toplamlar.
  const topDistCiro =
    snap?.distLeaderboard.reduce((a, d) => a + d.ciro, 0) ?? 0;
  // md26: birim = hacim (wietnauer birincil birimi 70cl).
  // md21: `unit` seçimine göre KPI kartında hangisi öne çıkar belirlenir.
  const topDistHacim =
    snap?.distLeaderboard.reduce((a, d) => a + d.hacim, 0) ?? 0;
  const volShort = tenant.volume?.short ?? "";
  const showVolumePrimary = unit === volumeKey && volShort;
  const topDistCount = snap?.distLeaderboard.length ?? 0;
  const topRepCount = snap?.repLeaderboard.length ?? 0;
  const avgOrderLatest =
    snap && snap.avgOrderTrend.length > 0
      ? snap.avgOrderTrend[snap.avgOrderTrend.length - 1]?.ortSepet ?? 0
      : 0;

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 02"
        title="Satış Performansı"
        contentKey="page.satis.title"
        descKey="page.satis.desc"
        description={`${tenant.displayName} distribütör ve saha satış temsilcisi performansı tek ekranda — leaderboard, drop size, yeni müşteri kazanımı ve ortalama sepet trendi.`}
        dataNote="TBLMSDFATURA + TBLDISTPERSONEL + TBLDIST + TBLDISTEKGRUP · BYTTUR=0 · BYTDURUM=0"
        generatedAt={snap?.generatedAt}
      />

      {err && (
        <div className="v3-error">
          <strong>Veri alınamadı:</strong> {err}
          <div className="v3-error-hint">
            VPN kontrol et veya MSSQL bağlantı durumunu doğrula.
          </div>
        </div>
      )}

      {/* md21: tarih aralığı seçici + TL↔Hacim görünüm anahtarı. Hata
          durumunda da göster ki kullanıcı aralığı düzeltip tekrar
          deneyebilsin (ör. geçersiz aralık sonrası boş cevap). */}
      <div className="v3-controls-row">
        <SatisDateRangePicker dateFrom={dateFrom} dateTo={dateTo} />
        <SatisUnitToggle />
      </div>

      {snap && (
        <>
          {/* Üst şerit: 4 KPI özet kartı */}
          <div className="v3-kpi-grid">
            {showVolumePrimary ? (
              <KpiTile
                label={`Top Distribütör Hacmi (${volShort})`}
                value={formatCompact(topDistHacim)}
                sub={`${rangeLabel} · ₺${formatCompact(topDistCiro)} ciro · ${topDistCount} dist`}
              />
            ) : (
              <KpiTile
                label="Top Distribütör Cirosu"
                value={`₺${formatCompact(topDistCiro)}`}
                sub={`${rangeLabel}${volShort ? ` · ${formatCompact(topDistHacim)} ${volShort}` : ""} · ${topDistCount} dist`}
              />
            )}
            {!panelHidden("kpi.satis.temsilci") && (
            <KpiTile
              label={cs("kpi.satis.temsilci", "Top Temsilci Sayısı")}
              value={topRepCount.toLocaleString("tr-TR")}
              sub={`${rangeLabel} performans listesinde`}
            />
          )}
            {!panelHidden("kpi.satis.yeni") && (
            <KpiTile
              label={cs("kpi.satis.yeni", "Yeni Müşteri (90g)")}
              value={snap.newCustomers.totalYeniMusteri.toLocaleString("tr-TR")}
              sub={`₺${formatCompact(snap.newCustomers.totalYeniCiro)} ciro`}
              tone="accent"
            />
          )}
            {!panelHidden("kpi.satis.sepet") && (
            <KpiTile
              label={cs("kpi.satis.sepet", "Güncel Ort. Sepet")}
              value={`₺${formatCompact(avgOrderLatest)}`}
              sub="son ay · AVG net/fatura"
            />
          )}
          </div>

          {/* Asıl içerik: leaderboard'lar üstte (full width), altta drop+yeni,
              en altta trend grafiği. */}
          <div className="v3-content-stack">
            {/* md25: Distribütör leaderboard kaldırıldı (veri KPI için korunuyor). */}
            <RepLeaderboardPanel rows={snap.repLeaderboard} rangeLabel={rangeLabel} />

            {/* md27: distLeaderboard'tan türetilen satisHizi (ciro / aktif
                nokta) — lib/api.ts tip aynası bu görevin dosya kapsamı
                dışında kaldığı için runtime cast ile genişletiliyor (bkz.
                SalesVelocityPanel doc). md21: `unit`/`volShort`/`rangeLabel`
                — TL↔hacim görünüm anahtarı ve seçili tarih aralığı etiketi. */}
            <SalesVelocityPanel
              rows={snap.distLeaderboard as SatisDistRowWithVelocity[]}
              unit={unit}
              volumeShort={volShort}
              rangeLabel={rangeLabel}
            />

            <div className="v3-row-2col">
              <DropSizePanel rows={snap.dropSize} rangeLabel={rangeLabel} />
              <NewCustomersPanel
                items={snap.newCustomers.items}
                totalYeniMusteri={snap.newCustomers.totalYeniMusteri}
                totalYeniCiro={snap.newCustomers.totalYeniCiro}
              />
            </div>

            <AvgOrderTrendPanel points={snap.avgOrderTrend} />
          </div>
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .v3-controls-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .v3-controls-row .satis-date-range { margin-bottom: 0; flex: 1; min-width: 320px; }
        .v3-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .v3-content-stack {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .v3-row-2col {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1080px) {
          .v3-row-2col {
            grid-template-columns: 1fr 1fr;
            align-items: start;
          }
        }
        .v3-error {
          background: var(--color-bad-bg, rgba(220, 38, 38, 0.05));
          border: 1px solid var(--color-bad, #dc2626);
          border-radius: 8px;
          padding: 14px 16px;
          margin-bottom: 20px;
          font-size: 13px;
          color: var(--color-fg);
        }
        .v3-error-hint {
          margin-top: 4px;
          font-size: 12px;
          color: var(--color-muted);
        }
      `,
        }}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warn" | "accent";
}) {
  const color =
    tone === "warn"
      ? "var(--color-bad)"
      : tone === "accent"
        ? "var(--color-accent)"
        : "var(--color-fg)";
  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--color-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-muted-2)" }}>{sub}</div>
    </div>
  );
}
