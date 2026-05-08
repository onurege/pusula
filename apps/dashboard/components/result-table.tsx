type Row = Record<string, unknown>;

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return new Date(v).toLocaleString("tr-TR");
  if (typeof v === "number") return v.toLocaleString("tr-TR");
  return String(v);
}

function isNumeric(v: unknown): boolean {
  return typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)));
}

export function ResultTable({ rows, max = 100 }: { rows: Row[]; max?: number }) {
  if (!rows || rows.length === 0) {
    return <div className="text-muted text-sm">Sonuç boş.</div>;
  }
  const cols = Object.keys(rows[0]!);
  const display = rows.slice(0, max);
  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} className="text-left font-medium px-3 py-2 border-b border-border whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {display.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-b-0 hover:bg-surface-2/40">
              {cols.map((c) => {
                const v = r[c];
                const numeric = isNumeric(v);
                return (
                  <td
                    key={c}
                    className={`px-3 py-2 align-top whitespace-nowrap font-mono text-[12.5px] ${
                      numeric ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {formatValue(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && (
        <div className="px-3 py-2 text-xs text-muted bg-surface-2/30">
          {max} / {rows.length} satır gösteriliyor
        </div>
      )}
    </div>
  );
}
