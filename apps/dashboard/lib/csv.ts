// Universal CSV download — used by radars, risk list, and any "çarşaf indir"
// affordance. Adds a UTF-8 BOM so Excel opens Turkish characters correctly
// without the user juggling encoding settings.

export type CsvColumn<T> = {
  key: keyof T | ((row: T) => unknown);
  label: string;
  /** Optional formatter. If omitted, the cell is stringified raw. */
  format?: (v: unknown, row: T) => string;
};

export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
): void {
  const head = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const raw = typeof c.key === "function" ? c.key(r) : r[c.key];
          const v = c.format ? c.format(raw, r) : raw;
          return csvEscape(v);
        })
        .join(","),
    )
    .join("\n");
  // ﻿ = UTF-8 BOM. Without it Excel mis-renders ş/ç/ğ as gibberish.
  const csv = "﻿" + head + "\n" + body + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
