/**
 * Top-N + "Diğer" + dip toplam deseni (Wietnauer v3 talepleri md16/17/18/29/30/36/37).
 *
 * Sıralı bir liste alır; ilk `keep` satırı korur, kalanları tek bir "Diğer"
 * satırında toplar (`other` builder ile), isteğe bağlı dip toplam satırı üretir
 * (`total` builder). SQL tarafında `slice` yerine bunu kullanıyoruz ki
 * gösterilmeyen kalem sayısı/değeri "Diğer"de görünsün.
 *
 * Kullanım:
 *   const { rows, total } = foldOther(sorted, {
 *     keep: 10,
 *     other: (rest) => ({ ad: "Diğer", ciro: sum(rest, r => r.ciro), ... }),
 *     total: (all)  => ({ ad: "Toplam", ciro: sum(all, r => r.ciro), ... }),
 *   });
 */
export type FoldOtherOptions<T> = {
  /** Korunacak ilk satır sayısı (Top-N). */
  keep: number;
  /** Kalan satırlardan "Diğer" satırını üretir. Kalan boşsa çağrılmaz. */
  other: (rest: T[]) => T;
  /** İsteğe bağlı dip toplam satırı — TÜM satırlar üzerinden. */
  total?: (all: T[]) => T;
};

export type FoldOtherResult<T> = {
  /** Top-N + (varsa) "Diğer" satırı. */
  rows: T[];
  /** Dip toplam satırı (total verildiyse). */
  total?: T;
  /** "Diğer"e katlanan kalem sayısı (0 ise Diğer eklenmedi). */
  otherCount: number;
};

export function foldOther<T>(sorted: T[], opts: FoldOtherOptions<T>): FoldOtherResult<T> {
  const keep = Math.max(0, opts.keep);
  const kept = sorted.slice(0, keep);
  const rest = sorted.slice(keep);
  const rows = rest.length > 0 ? [...kept, opts.other(rest)] : kept;
  return {
    rows,
    total: opts.total ? opts.total(sorted) : undefined,
    otherCount: rest.length,
  };
}

/** Küçük yardımcı: bir alanın toplamı. */
export function sumBy<T>(rows: T[], pick: (r: T) => number): number {
  let s = 0;
  for (const r of rows) s += pick(r) || 0;
  return s;
}
