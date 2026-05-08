export type ColumnInfo = {
  name: string;
  dataType: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
  description?: string;
  label?: string;
  sampleValues?: unknown[];
};

export type ForeignKey = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  constraintName: string;
};

export type IndexInfo = {
  name: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  columns: string[];
};

export type TableInfo = {
  schema: string;
  name: string;
  fullName: string;
  description?: string;
  label?: string;
  keywords: string[];
  columns: ColumnInfo[];
  primaryKeys: string[];
  indexes: IndexInfo[];
  rowCountEstimate?: number;
  sampleRows?: Record<string, unknown>[];
};

export type SchemaSnapshot = {
  database: string;
  generatedAt: string;
  tables: TableInfo[];
  foreignKeys: ForeignKey[];
};

export type RetrievalResult = {
  table: TableInfo;
  score: number;
  reasons: string[];
  fkNeighbors: { table: string; via: string }[];
};
