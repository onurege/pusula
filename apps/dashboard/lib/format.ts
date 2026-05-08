// Turkish-locale compact number formatting for dashboard tiles. Switches
// to Mr (milyar) / Mn (milyon) at the right thresholds so a 1.3 billion lira
// ciro renders as "1,31 Mr ₺" instead of "1.310.766.193,651 ₺". Numbers
// below 1M stay as plain thousand-separated integers (e.g. "22.350") —
// "22,4 B" is more confusing than helpful at a glance.
export function formatCompact(n: number, currency?: string): string {
  if (typeof n !== "number" || isNaN(n)) return "—";
  const abs = Math.abs(n);
  let value: string;
  if (abs >= 1_000_000_000) {
    value = (n / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mr";
  } else if (abs >= 1_000_000) {
    value = (n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mn";
  } else {
    value = n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  }
  return currency ? `${value} ${currency}` : value;
}

export function formatInt(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "—";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

export function formatPct(n: number, opts: { signed?: boolean } = {}): string {
  if (typeof n !== "number" || isNaN(n)) return "—";
  const signed = opts.signed ?? false;
  const sign = signed && n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/** Pick formatCompact for currency-like fields, formatInt otherwise. */
export function smartFormat(value: unknown, unit?: string): string {
  if (typeof value === "string") {
    const n = Number(value);
    if (!isNaN(n)) return smartFormat(n, unit);
    return value;
  }
  if (typeof value !== "number") return String(value ?? "—");
  // Currency-typed values always use compact (Mn/Mr suffixes) so a billion-lira
  // figure stays readable. Plain count metrics (fatura sayısı, distribütör adedi)
  // get plain thousand-separated integers below 1M, then collapse to Mn/Mr above.
  if (unit && (unit.includes("₺") || unit.includes("$") || unit.includes("€"))) {
    return formatCompact(value, unit);
  }
  return formatCompact(value, unit);
}
