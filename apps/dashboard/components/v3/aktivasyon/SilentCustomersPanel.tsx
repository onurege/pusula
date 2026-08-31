import { formatCompact } from "@/components/komuta/format";
import type { SilentCustomer } from "./types";

/**
 * Panel B — Sessizleşen Müşteri Listesi.
 *
 * Önceki 90g (180..90 arası) fatura olmuş ama son 90g sıfır. Top 50 önceki
 * dönem cirosuna göre. Saha aksiyonu için her satırda son alındığı marka
 * + sessizleştiği gün sayısı + bölge bilgisi.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function SilentCustomersPanel({ items }: { items: SilentCustomer[] }) {
  if (panelHidden("panel.risk.silent")) return null;
  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.risk.silent", "Sessizleşen Müşteriler")}</div>
          <div className="v3-panel-sub">
            Önceki 90g aktif ama son 90g sıfır · {items.length} müşteri
          </div>
        </div>
      </div>

      <div className="v3-table-wrap">
        <table className="v3-table">
          <thead>
            <tr>
              <th>Müşteri</th>
              <th>Şehir</th>
              <th>Son Satış</th>
              <th className="num">Sessiz Gün</th>
              <th className="num">Önceki 90g Ciro</th>
              <th>Son Marka</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Bu dönem için sessizleşen müşteri yok.
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id}>
                <td className="unvan" title={c.unvan}>
                  {c.unvan.length > 48 ? c.unvan.slice(0, 45) + "…" : c.unvan}
                </td>
                <td>{c.sehir || "—"}</td>
                <td className="num">{formatDate(c.sonSatisTarihi)}</td>
                <td className="num">
                  <span
                    className="silent-days"
                    style={{
                      color: c.sessizGun > 150 ? "#dc2626" : c.sessizGun > 120 ? "#d97706" : "var(--color-fg)",
                    }}
                  >
                    {c.sessizGun}g
                  </span>
                </td>
                <td className="num">₺{formatCompact(c.oncekiCiro)}</td>
                <td className="marka">{c.sonMarka || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .silent-days {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .marka {
          font-size: 12px;
          color: var(--color-muted);
        }
        .empty {
          text-align: center;
          color: var(--color-muted);
          padding: 20px 0;
          font-size: 12.5px;
        }
      `,
        }}
      />
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return "—";
  }
}
