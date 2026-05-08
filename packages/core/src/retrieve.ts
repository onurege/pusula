import { dbKeysForQuery, normalizeQuery } from "./dictionary.js";
import type {
  ForeignKey,
  RetrievalResult,
  SchemaSnapshot,
  TableInfo,
} from "./types.js";

export type RetrieveOptions = {
  /** Max tables in the primary result set (before FK expansion). */
  topK?: number;
  /** If true, expand result set with 1-hop FK neighbors. */
  expandFkNeighbors?: boolean;
  /** Cap on neighbor tables added per primary table. */
  neighborsPerTable?: number;
};

type Scored = {
  table: TableInfo;
  score: number;
  reasons: string[];
};

function scoreTable(
  table: TableInfo,
  query: string,
  dbKeys: string[],
): Scored | null {
  const reasons: string[] = [];
  let score = 0;

  const tableUpper = table.fullName.toUpperCase();
  const tableNameUpper = table.name.toUpperCase();

  for (const key of dbKeys) {
    if (tableNameUpper.includes(key)) {
      score += 5;
      reasons.push(`table-name match: ${key}`);
    } else if (tableUpper.includes(key)) {
      score += 3;
      reasons.push(`fullname match: ${key}`);
    }
    if (table.keywords.some((kw) => normalizeQuery(kw).includes(normalizeQuery(key.toLowerCase())))) {
      score += 2;
    }
    const colHits = table.columns.filter((c) => c.name.toUpperCase().includes(key)).length;
    if (colHits > 0) {
      score += Math.min(colHits, 3);
      reasons.push(`${colHits} column(s) match: ${key}`);
    }
  }

  // Direct query-word matches in table name (fallback when no dictionary match)
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  for (const word of queryWords) {
    if (tableNameUpper.includes(word.toUpperCase())) {
      score += 1;
      reasons.push(`raw word match: ${word}`);
    }
  }

  // Penalty for non-canonical table variants (backups, archives, dated copies,
  // merge/dedupe scratch tables). These rank artificially high on raw keyword
  // matches but are almost never the right table to query.
  const NON_CANONICAL = [
    /_YEDEK$/,
    /_YEDEK\d*/,
    /_OLD$/,
    /_BAK$/,
    /_BACKUP$/,
    /_TEMP$/,
    /_TMP$/,
    /_TEST$/,
    /_ARCHIVE$/,
    /_ARSIV$/,
    /_UPCD$/,
    /_BIRLESTIRME(DETAY)?$/,
    /_\d{6,}$/,    // _20230704
    /[A-Z]\d{6,}$/, // TBLDIST250521 (no underscore between)
  ];
  for (const pat of NON_CANONICAL) {
    if (pat.test(tableNameUpper)) {
      score -= 6;
      reasons.push(`non-canonical penalty: ${pat.source}`);
      break;
    }
  }

  // Mild bonus for the "main" Univera table family — TBLMSD* / TBL<word>BASLIK
  // are typically the canonical headers, while the other variants are details
  // or auxiliary stores.
  if (/^TBL(MSD|DIST|MUSTERI|URUN|FATURA|SATIS|SIPARIS|STOK|BANKA|HESAP|CARI|DEPO)\b/.test(tableNameUpper)) {
    score += 1;
  }

  if (score <= 0) return null;
  return { table, score, reasons };
}

function buildFkIndex(
  fks: ForeignKey[],
): Map<string, Array<{ neighbor: string; via: string }>> {
  const map = new Map<string, Array<{ neighbor: string; via: string }>>();
  const push = (a: string, b: string, via: string) => {
    let arr = map.get(a);
    if (!arr) {
      arr = [];
      map.set(a, arr);
    }
    arr.push({ neighbor: b, via });
  };
  for (const fk of fks) {
    push(fk.fromTable, fk.toTable, `${fk.fromColumn} → ${fk.toTable}.${fk.toColumn}`);
    push(fk.toTable, fk.fromTable, `${fk.fromTable}.${fk.fromColumn} → ${fk.toColumn}`);
  }
  return map;
}

export function retrieve(
  query: string,
  snapshot: SchemaSnapshot,
  options: RetrieveOptions = {},
): RetrievalResult[] {
  const topK = options.topK ?? 10;
  const expand = options.expandFkNeighbors ?? true;
  const neighborsPerTable = options.neighborsPerTable ?? 5;

  const dbKeys = dbKeysForQuery(query);

  const scored: Scored[] = [];
  for (const table of snapshot.tables) {
    const s = scoreTable(table, query, dbKeys);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score);

  const primary = scored.slice(0, topK);
  const fkIndex = expand
    ? buildFkIndex(snapshot.foreignKeys)
    : new Map<string, Array<{ neighbor: string; via: string }>>();

  const results: RetrievalResult[] = primary.map((s) => {
    const neighbors = (fkIndex.get(s.table.fullName) ?? [])
      .slice(0, neighborsPerTable)
      .map((n) => ({ table: n.neighbor, via: n.via }));
    return {
      table: s.table,
      score: s.score,
      reasons: s.reasons,
      fkNeighbors: neighbors,
    };
  });

  return results;
}

export function formatRetrievalForPrompt(results: RetrievalResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const t = r.table;
    const head = `## ${t.fullName}${t.label ? ` — ${t.label}` : ""}${t.description ? ` (${t.description})` : ""}`;
    lines.push(head);
    if (t.primaryKeys.length > 0) lines.push(`PK: ${t.primaryKeys.join(", ")}`);
    if (r.fkNeighbors.length > 0) {
      lines.push(`FK ilişkileri: ${r.fkNeighbors.map((n) => n.via).join("; ")}`);
    }
    lines.push("Kolonlar:");
    for (const c of t.columns) {
      const pk = c.isPrimaryKey ? " [PK]" : "";
      const nullStr = c.isNullable ? "" : " NOT NULL";
      const desc = c.description ? ` — ${c.description}` : c.label ? ` — ${c.label}` : "";
      lines.push(`  ${c.name} (${c.dataType})${nullStr}${pk}${desc}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
