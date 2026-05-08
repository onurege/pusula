import { runReadOnly } from "./db.js";
import { describeColumn, extractKeywords } from "./dictionary.js";
import type {
  ColumnInfo,
  ForeignKey,
  IndexInfo,
  SchemaSnapshot,
  TableInfo,
} from "./types.js";

type RawColumn = {
  schemaName: string;
  tableName: string;
  columnName: string;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isNullable: boolean;
  defaultValue: string | null;
  description: string | null;
};

type RawPK = {
  schemaName: string;
  tableName: string;
  columnName: string;
};

type RawFK = {
  fkName: string;
  parentSchema: string;
  parentTable: string;
  parentColumn: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
};

type RawTableDescription = {
  schemaName: string;
  tableName: string;
  description: string;
};

type RawIndex = {
  schemaName: string;
  tableName: string;
  indexName: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  columnName: string;
  keyOrdinal: number;
};

type RawRowCount = {
  schemaName: string;
  tableName: string;
  rowCount: number;
};

const COLUMN_QUERY = `
SELECT
  s.name              AS schemaName,
  t.name              AS tableName,
  c.name              AS columnName,
  ty.name             AS dataType,
  c.max_length        AS maxLength,
  c.precision         AS precision,
  c.scale             AS scale,
  c.is_nullable       AS isNullable,
  dc.definition       AS defaultValue,
  CAST(ep.value AS NVARCHAR(MAX)) AS description
FROM sys.columns c
JOIN sys.tables t        ON c.object_id = t.object_id
JOIN sys.schemas s       ON t.schema_id = s.schema_id
JOIN sys.types ty        ON c.user_type_id = ty.user_type_id
LEFT JOIN sys.default_constraints dc
       ON dc.parent_object_id = c.object_id
      AND dc.parent_column_id = c.column_id
LEFT JOIN sys.extended_properties ep
       ON ep.major_id = c.object_id
      AND ep.minor_id = c.column_id
      AND ep.name = 'MS_Description'
      AND ep.class = 1
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.column_id;
`;

const PK_QUERY = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  c.name AS columnName
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c        ON ic.object_id = c.object_id AND ic.column_id = c.column_id
JOIN sys.tables t         ON i.object_id = t.object_id
JOIN sys.schemas s        ON t.schema_id = s.schema_id
WHERE i.is_primary_key = 1 AND t.is_ms_shipped = 0;
`;

const FK_QUERY = `
SELECT
  fk.name              AS fkName,
  ps.name              AS parentSchema,
  pt.name              AS parentTable,
  pc.name              AS parentColumn,
  rs.name              AS refSchema,
  rt.name              AS refTable,
  rc.name              AS refColumn
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables pt   ON fk.parent_object_id = pt.object_id
JOIN sys.schemas ps  ON pt.schema_id = ps.schema_id
JOIN sys.columns pc  ON fkc.parent_object_id = pc.object_id
                   AND fkc.parent_column_id = pc.column_id
JOIN sys.tables rt   ON fk.referenced_object_id = rt.object_id
JOIN sys.schemas rs  ON rt.schema_id = rs.schema_id
JOIN sys.columns rc  ON fkc.referenced_object_id = rc.object_id
                   AND fkc.referenced_column_id = rc.column_id;
`;

const TABLE_DESC_QUERY = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  CAST(ep.value AS NVARCHAR(MAX)) AS description
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.extended_properties ep
       ON ep.major_id = t.object_id
      AND ep.minor_id = 0
      AND ep.name = 'MS_Description'
      AND ep.class = 1
WHERE t.is_ms_shipped = 0;
`;

const INDEX_QUERY = `
SELECT
  s.name      AS schemaName,
  t.name      AS tableName,
  i.name      AS indexName,
  i.is_unique AS isUnique,
  i.is_primary_key AS isPrimaryKey,
  c.name      AS columnName,
  ic.key_ordinal AS keyOrdinal
FROM sys.indexes i
JOIN sys.tables t         ON i.object_id = t.object_id
JOIN sys.schemas s        ON t.schema_id = s.schema_id
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c        ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE t.is_ms_shipped = 0
  AND i.name IS NOT NULL
  AND ic.is_included_column = 0
ORDER BY s.name, t.name, i.name, ic.key_ordinal;
`;

const ROW_COUNT_QUERY = `
SELECT
  s.name AS schemaName,
  t.name AS tableName,
  SUM(p.rows) AS rowCount
FROM sys.tables t
JOIN sys.schemas s    ON t.schema_id = s.schema_id
JOIN sys.partitions p ON t.object_id = p.object_id
WHERE t.is_ms_shipped = 0
  AND p.index_id IN (0, 1)
GROUP BY s.name, t.name;
`;

async function fetchAll<T>(query: string): Promise<T[]> {
  const r = await runReadOnly(query, { limit: 1_000_000, timeoutMs: 120_000 });
  return r.rows as T[];
}

export async function fetchSampleRows(
  schema: string,
  table: string,
  n: number,
): Promise<Record<string, unknown>[]> {
  if (n <= 0) return [];
  const safeSchema = schema.replace(/[^A-Za-z0-9_]/g, "");
  const safeTable = table.replace(/[^A-Za-z0-9_]/g, "");
  const q = `SELECT TOP ${n} * FROM [${safeSchema}].[${safeTable}]`;
  try {
    const r = await runReadOnly(q, { limit: n, timeoutMs: 10_000 });
    return r.rows;
  } catch {
    return [];
  }
}

export type IntrospectOptions = {
  database: string;
  sampleRows?: number;
  includeRowCounts?: boolean;
  /** Filter table names; if omitted, includes all user tables. */
  tableFilter?: (schema: string, table: string) => boolean;
};

export async function introspect(
  options: IntrospectOptions,
): Promise<SchemaSnapshot> {
  const sampleRows = options.sampleRows ?? 0;

  const [columns, pks, fks, descs, indexes, rowCounts] = await Promise.all([
    fetchAll<RawColumn>(COLUMN_QUERY),
    fetchAll<RawPK>(PK_QUERY),
    fetchAll<RawFK>(FK_QUERY),
    fetchAll<RawTableDescription>(TABLE_DESC_QUERY),
    fetchAll<RawIndex>(INDEX_QUERY),
    options.includeRowCounts
      ? fetchAll<RawRowCount>(ROW_COUNT_QUERY)
      : Promise.resolve<RawRowCount[]>([]),
  ]);

  // Group columns by table
  const tableMap = new Map<string, TableInfo>();
  const keyOf = (s: string, t: string) => `${s}.${t}`;

  const pkSet = new Set(pks.map((p) => `${p.schemaName}.${p.tableName}.${p.columnName}`));
  const descMap = new Map(descs.map((d) => [keyOf(d.schemaName, d.tableName), d.description]));
  const rowCountMap = new Map(
    rowCounts.map((r) => [keyOf(r.schemaName, r.tableName), r.rowCount]),
  );

  for (const c of columns) {
    if (options.tableFilter && !options.tableFilter(c.schemaName, c.tableName)) continue;

    const k = keyOf(c.schemaName, c.tableName);
    let table = tableMap.get(k);
    if (!table) {
      const fullName = `${c.schemaName}.${c.tableName}`;
      table = {
        schema: c.schemaName,
        name: c.tableName,
        fullName,
        description: descMap.get(k),
        keywords: extractKeywords(c.tableName),
        columns: [],
        primaryKeys: [],
        indexes: [],
        rowCountEstimate: rowCountMap.get(k),
      };
      tableMap.set(k, table);
    }

    const col: ColumnInfo = {
      name: c.columnName,
      dataType: c.dataType,
      maxLength: c.maxLength ?? undefined,
      precision: c.precision ?? undefined,
      scale: c.scale ?? undefined,
      isNullable: c.isNullable,
      isPrimaryKey: pkSet.has(`${c.schemaName}.${c.tableName}.${c.columnName}`),
      defaultValue: c.defaultValue ?? undefined,
      description: c.description ?? undefined,
      label: describeColumn(c.columnName),
    };
    table.columns.push(col);
    if (col.isPrimaryKey) table.primaryKeys.push(col.name);
  }

  // Group indexes
  const indexBuckets = new Map<string, Map<string, IndexInfo>>();
  for (const i of indexes) {
    const tk = keyOf(i.schemaName, i.tableName);
    if (!tableMap.has(tk)) continue;
    let buckets = indexBuckets.get(tk);
    if (!buckets) {
      buckets = new Map();
      indexBuckets.set(tk, buckets);
    }
    let idx = buckets.get(i.indexName);
    if (!idx) {
      idx = {
        name: i.indexName,
        isUnique: i.isUnique,
        isPrimaryKey: i.isPrimaryKey,
        columns: [],
      };
      buckets.set(i.indexName, idx);
    }
    idx.columns.push(i.columnName);
  }
  for (const [tk, buckets] of indexBuckets) {
    const t = tableMap.get(tk);
    if (t) t.indexes = [...buckets.values()];
  }

  // Sample rows (sequential to avoid hammering the DB)
  if (sampleRows > 0) {
    const sortedTables = [...tableMap.values()];
    for (const t of sortedTables) {
      t.sampleRows = await fetchSampleRows(t.schema, t.name, sampleRows);
    }
  }

  const foreignKeys: ForeignKey[] = fks
    .filter((fk) => {
      if (!options.tableFilter) return true;
      return (
        options.tableFilter(fk.parentSchema, fk.parentTable) ||
        options.tableFilter(fk.refSchema, fk.refTable)
      );
    })
    .map((fk) => ({
      constraintName: fk.fkName,
      fromTable: `${fk.parentSchema}.${fk.parentTable}`,
      fromColumn: fk.parentColumn,
      toTable: `${fk.refSchema}.${fk.refTable}`,
      toColumn: fk.refColumn,
    }));

  return {
    database: options.database,
    generatedAt: new Date().toISOString(),
    tables: [...tableMap.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    foreignKeys,
  };
}
