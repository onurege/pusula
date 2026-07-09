import { formatCompact } from "@/components/komuta/format";

/**
 * Panel A — İskonto KPI Hero.
 *
 * 4 büyük rakam: Brüt, İskonto, Net, Oran %. Tier renkleri (PROJE STANDARDI):
 *   <15%  → #16a34a sağlıklı
 *   15-25% → #d97706 nötr
 *   >25%  → #dc2626 uyarı
 */
export function IskontoHeroPanel({
  brut,
  iskonto,
  net,
  iskontoOraniPct,
  faturaCount,
  aktifMusteriCount,
}: {
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  faturaCount: number;
  aktifMusteriCount: number;
}) {
  const tier =
    iskontoOraniPct < 15
      ? { color: "#16a34a", label: "sağlıklı" }
      : iskontoOraniPct < 25
      ? { color: "#d97706", label: "nötr" }
      : { color: "#dc2626", label: "yatırım uyarısı" };

  return (
    <div className="hero-panel">
      <div className="hero-row">
        <HeroTile
          label="Brüt Ciro"
          value={`₺${formatCompact(brut)}`}
          sub={`${faturaCount.toLocaleString("tr-TR")} fatura`}
        />
        <HeroTile
          label="İskonto Toplamı"
          value={`₺${formatCompact(iskonto)}`}
          sub={`${aktifMusteriCount.toLocaleString("tr-TR")} aktif müşteri`}
          accent="muted"
        />
        <HeroTile
          label="Net Ciro"
          value={`₺${formatCompact(net)}`}
          sub="brüt − iskonto"
          accent="solid"
        />
        <HeroTile
          label="İskonto / Ciro"
          value={`%${iskontoOraniPct.toFixed(1)}`}
          sub={tier.label}
          color={tier.color}
        />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .hero-panel {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 22px 24px;
        }
        .hero-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 24px;
        }
        .hero-tile { display: flex; flex-direction: column; gap: 6px; }
        .hero-tile .label {
          font-size: 11px;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 600;
        }
        .hero-tile .value {
          font-size: 36px;
          font-weight: 700;
          letter-spacing: -0.03em;
          font-variant-numeric: tabular-nums;
          line-height: 1.05;
          color: var(--color-fg);
        }
        .hero-tile .value.muted { color: var(--color-muted); }
        .hero-tile .value.solid { color: var(--color-fg); }
        .hero-tile .sub {
          font-size: 11.5px;
          color: var(--color-muted-2);
        }
      `,
        }}
      />
    </div>
  );
}

function HeroTile({
  label,
  value,
  sub,
  color,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
  accent?: "muted" | "solid";
}) {
  return (
    <div className="hero-tile">
      <div className="label">{label}</div>
      <div
        className={`value${accent === "muted" ? " muted" : ""}${accent === "solid" ? " solid" : ""}`}
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="sub">{sub}</div>
    </div>
  );
}
