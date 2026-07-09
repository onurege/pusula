"use client";

import { useState } from "react";
import type { WietnauerTopCustomer } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";

type Limit = 10 | 20 | 50;

/**
 * Top müşteri analizi paneli — Wietnauer'ın Yönetim Kurulu dashboard'unda
 * istenen "Top 10, Top 20, Top 50 müşteri" görünümü.
 *
 * Backend her zaman 50 satır döner; toggle ile UI'da slice'lanır. Sıralama
 * son 30g net ciro DESC. Pay% toplama bağlı yüzde — sahip olunan tüm
 * portföye göre konsantrasyon ölçüsü.
 */
export function TopCustomersPanel({
  customers,
}: {
  customers: WietnauerTopCustomer[];
}) {
  const [limit, setLimit] = useState<Limit>(10);
  const visible = customers.slice(0, limit);
  const cumulative = visible.reduce((a, c) => a + c.payPct, 0);

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Top Müşteri Analizi</div>
          <div className="v3-panel-sub">
            Son 30 gün net ciro · İlk {limit} müşteri portföyün
            <strong> %{cumulative.toFixed(1)}</strong>'ini taşıyor
          </div>
        </div>
        <div className="v3-toggle">
          {([10, 20, 50] as Limit[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setLimit(n)}
              className={limit === n ? "active" : ""}
              aria-pressed={limit === n}
            >
              Top {n}
            </button>
          ))}
        </div>
      </div>

      <div className="v3-table-wrap">
        <table className="v3-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Müşteri</th>
              <th>Şehir</th>
              <th>Bölge</th>
              <th className="num">Ciro (30g)</th>
              <th className="num">Fatura</th>
              <th className="num">Pay</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id}>
                <td className="rank">{c.rank}</td>
                <td className="unvan" title={c.unvan}>
                  {c.unvan.length > 50 ? c.unvan.slice(0, 47) + "…" : c.unvan}
                </td>
                <td>{c.sehir || "—"}</td>
                <td>{c.bolge || "—"}</td>
                <td className="num">₺{formatCompact(c.ciro)}</td>
                <td className="num">{c.faturaSayisi.toLocaleString("tr-TR")}</td>
                <td className="num pay">
                  <span className="pay-bar" style={{ width: `${Math.min(c.payPct * 8, 100)}%` }} />
                  <span className="pay-val">%{c.payPct.toFixed(1)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .v3-panel {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 10px;
          padding: 18px 20px;
        }
        .v3-panel-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .v3-panel-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--color-fg);
          letter-spacing: -0.01em;
        }
        .v3-panel-sub {
          font-size: 12px;
          color: var(--color-muted);
          margin-top: 2px;
        }
        .v3-toggle {
          display: inline-flex;
          gap: 2px;
          padding: 2px;
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
          border-radius: 7px;
        }
        .v3-toggle button {
          padding: 5px 12px;
          border: 0;
          background: transparent;
          font-size: 11.5px;
          font-weight: 500;
          color: var(--color-muted);
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.12s;
        }
        .v3-toggle button:hover {
          color: var(--color-fg);
        }
        .v3-toggle button.active {
          background: var(--color-surface);
          color: var(--color-fg);
          font-weight: 600;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .v3-table-wrap {
          overflow-x: auto;
          margin: 0 -4px;
        }
        .v3-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
          min-width: 720px;
        }
        .v3-table thead th {
          text-align: left;
          padding: 8px 10px;
          font-size: 10.5px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border-bottom: 1px solid var(--color-border);
        }
        .v3-table thead th.num {
          text-align: right;
        }
        .v3-table tbody tr {
          border-bottom: 1px solid var(--color-border);
        }
        .v3-table tbody tr:hover {
          background: var(--color-surface-2);
        }
        .v3-table td {
          padding: 9px 10px;
          color: var(--color-fg);
        }
        .v3-table td.rank {
          font-weight: 600;
          color: var(--color-muted);
          font-variant-numeric: tabular-nums;
          width: 30px;
        }
        .v3-table td.unvan {
          font-weight: 500;
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .v3-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .v3-table td.pay {
          position: relative;
          min-width: 90px;
        }
        .pay-bar {
          position: absolute;
          left: 10px;
          right: auto;
          top: 50%;
          transform: translateY(-50%);
          height: 4px;
          background: var(--color-accent-soft);
          border-radius: 2px;
          z-index: 0;
          opacity: 0.7;
        }
        .pay-val {
          position: relative;
          z-index: 1;
          color: var(--color-fg-2);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
