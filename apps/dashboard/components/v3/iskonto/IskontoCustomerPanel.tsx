import { formatCompact } from "@/components/komuta/format";

type CustomerRow = {
  id: number;
  unvan: string;
  sehir: string | null;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  faturaSayisi: number;
  rank: number;
  etiket: "premium" | "saglikli" | "bagimli";
};

const ETIKET_META: Record<
  CustomerRow["etiket"],
  { label: string; color: string }
> = {
  premium: { label: "premium", color: "#16a34a" },
  saglikli: { label: "sağlıklı", color: "#d97706" },
  bagimli: { label: "iskonto bağımlı", color: "#dc2626" },
};

/**
 * Panel D — Müşteri ROI Top 20.
 *
 * En çok iskonto verilen 20 müşteri (iskonto DESC). Düşük iskonto oranı +
 * yüksek ciro = premium. Yüksek oran = iskonto bağımlı.
 *
 * Eşikler (backend'de fix):
 *   <10%   → premium
 *   10-25% → sağlıklı
 *   >25%   → bağımlı
 */
export function IskontoCustomerPanel({
  customers,
}: {
  customers: CustomerRow[];
}) {
  const premiumCount = customers.filter((c) => c.etiket === "premium").length;
  const bagimliCount = customers.filter((c) => c.etiket === "bagimli").length;
  const toplamIskonto = customers.reduce((a, c) => a + c.iskonto, 0);

  return (
    <div className="cust-panel">
      <div className="cust-head">
        <div>
          <div className="cust-title">Müşteri ROI · Top 20</div>
          <div className="cust-sub">
            Son 30g · İskonto tutarı DESC · Toplam ₺
            {formatCompact(toplamIskonto)} iskonto yatırımı
            {premiumCount > 0 && (
              <>
                {" · "}
                <span style={{ color: "#16a34a", fontWeight: 600 }}>
                  {premiumCount} premium
                </span>
              </>
            )}
            {bagimliCount > 0 && (
              <>
                {" · "}
                <span style={{ color: "#dc2626", fontWeight: 600 }}>
                  {bagimliCount} bağımlı
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="cust-table-wrap">
        <table className="cust-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Müşteri</th>
              <th>Şehir</th>
              <th className="num">Brüt</th>
              <th className="num">İskonto</th>
              <th className="num">Net</th>
              <th className="num">Oran</th>
              <th>Etiket</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const meta = ETIKET_META[c.etiket];
              return (
                <tr key={c.id}>
                  <td className="rank">{c.rank}</td>
                  <td className="unvan" title={c.unvan}>
                    {c.unvan.length > 46 ? c.unvan.slice(0, 43) + "…" : c.unvan}
                  </td>
                  <td className="sehir">{c.sehir || "—"}</td>
                  <td className="num">₺{formatCompact(c.brut)}</td>
                  <td className="num iskonto">₺{formatCompact(c.iskonto)}</td>
                  <td className="num">₺{formatCompact(c.net)}</td>
                  <td className="num oran" style={{ color: meta.color }}>
                    %{c.iskontoOraniPct.toFixed(1)}
                  </td>
                  <td className="etiket">
                    <span className="pill" style={{ color: meta.color, borderColor: meta.color }}>
                      {meta.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .cust-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .cust-head { margin-bottom: 12px; }
        .cust-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .cust-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .cust-table-wrap { overflow-x: auto; margin: 0 -4px; }
        .cust-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 820px; }
        .cust-table thead th {
          text-align: left;
          padding: 8px 10px;
          font-size: 10.5px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border-bottom: 1px solid var(--color-border);
        }
        .cust-table thead th.num { text-align: right; }
        .cust-table tbody tr { border-bottom: 1px solid var(--color-border); }
        .cust-table tbody tr:hover { background: var(--color-surface-2); }
        .cust-table td { padding: 9px 10px; color: var(--color-fg); }
        .cust-table td.rank { font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; }
        .cust-table td.unvan { font-weight: 500; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cust-table td.sehir { color: var(--color-muted); }
        .cust-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .cust-table td.iskonto { color: var(--color-fg-2); font-weight: 500; }
        .cust-table td.oran { font-weight: 600; }
        .pill { display: inline-block; padding: 2px 8px; font-size: 10.5px; font-weight: 600; border: 1px solid; border-radius: 999px; text-transform: lowercase; letter-spacing: 0.02em; }
      `,
        }}
      />
    </div>
  );
}
