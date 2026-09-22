/**
 * Canlı şema doğrulama + önizleme primitifleri — Insider konfigüratörünün
 * Database D2 veto şartı: kaydetme ANINDA (yalnız statik allowlist değil)
 * hedef (tablo,kolon) çiftinin GERÇEKTEN o MSSQL'de var olduğunu doğrular.
 *
 * `introspect.ts`'in tam şema taramasını (tüm tablolar/kolonlar/FK'ler,
 * ağır) TEKRARLAMAZ — burada yalnız TEK bir aday için hedefli
 * `sys.tables`/`sys.columns` sorguları var (introspect.ts'teki COLUMN_QUERY
 * ile aynı sistem view ailesi, aynı `t.is_ms_shipped = 0` filtresi).
 *
 * Test edilebilirlik (Metz/Collina): DB'ye doğrudan bağlanmaz — `RunReadOnlyFn`
 * enjekte edilir (üretimde `runReadOnly` — `db.ts`; testte mock). Bu sayede
 * bu modülün tüm dallanma mantığı (var/yok, tip uyumu, match-rate hesabı)
 * GERÇEK MSSQL'e bağlanmadan unit-testlenir.
 *
 * GÜVENLİK: `table`/`joinColumn`/`labelColumn` parametreleri BURAYA
 * ulaşmadan ÖNCE `resolveIdentifier`'dan (regex + allowlist) geçmiş olmalı —
 * bu modül kendi başına bir enjeksiyon savunması DEĞİL, savunulmuş
 * identifier'lar üzerinde çalışan bir sorgu katmanıdır. Yine de her string,
 * identifier DEĞİL VALUE olarak kullanıldığı `sys.*` WHERE yan tümcelerinde
 * `literalEscape` ile ayrıca kaçışlanır (savunma-derinliği — tek hataya karşı
 * çift kilit).
 */
import { customerBreakdownJoin } from "./customer-breakdown-sql";
import type { CustomerBreakdownMeta } from "./identifier";

/**
 * Yükseltilmiş şema doğrulaması bilgisiyle "kaydedilemez" hatası — endpoint
 * bunu 422 (ya da 400) olarak client'a çevirir, `check` alanı UI'da HANGİ
 * parçanın eksik olduğunu (tablo mu, kolon mu) göstermek için taşınır.
 *
 * Üç konfigüratör servisinin (`customer-breakdown-config-service.ts`,
 * `product-breakdown-config-service.ts`, `region-breakdown-config-service.ts`)
 * ORTAK hata tipi — burada (schema-check.ts) tanımlanır çünkü üçü de zaten bu
 * dosyanın `CandidateLiveCheck` tipine bağımlı; ayrı ayrı 3 kopya tutmak
 * `instanceof` kontrolünü kırılgan yapardı (üç ayrı class = üç ayrı kimlik).
 */
export class LiveSchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly check: CandidateLiveCheck,
  ) {
    super(message);
    this.name = "LiveSchemaValidationError";
  }
}

/** `db.ts` `runReadOnly` ile aynı imza — üretimde doğrudan o fonksiyon
 *  geçirilir, testte mock. Yalnız `rows` kullanıldığı için minimal tip. */
export type RunReadOnlyFn = (
  query: string,
  options?: { limit?: number; timeoutMs?: number },
) => Promise<{ rows: Record<string, unknown>[] }>;

/** Zaten `^[A-Za-z0-9_]+$` regex'inden geçmiş bir değeri, VALUE (identifier
 *  DEĞİL) olarak kullanılacağı `N'...'` string literalinde ek güvenlik payı
 *  için kaçışlar — regex zaten tek tırnağı reddeder, bu yalnız ikinci kilit. */
function literalEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// (tablo, kolon) canlı doğrulaması
// ---------------------------------------------------------------------------

export type LiveColumnCheck = {
  exists: boolean;
  /** sys.types.name — ör. "varchar", "int". Kolon yoksa `null`. */
  dataType: string | null;
};

async function tableExistsLive(run: RunReadOnlyFn, table: string): Promise<boolean> {
  const q = `SELECT 1 AS x FROM sys.tables t
             JOIN sys.schemas s ON t.schema_id = s.schema_id
             WHERE s.name = 'dbo' AND t.name = N'${literalEscape(table)}' AND t.is_ms_shipped = 0`;
  const r = await run(q, { limit: 1, timeoutMs: 10_000 });
  return r.rows.length > 0;
}

async function columnLive(run: RunReadOnlyFn, table: string, column: string): Promise<LiveColumnCheck> {
  const q = `SELECT ty.name AS dataType
             FROM sys.columns c
             JOIN sys.tables t  ON c.object_id = t.object_id
             JOIN sys.schemas s ON t.schema_id = s.schema_id
             JOIN sys.types ty  ON c.user_type_id = ty.user_type_id
             WHERE s.name = 'dbo' AND t.name = N'${literalEscape(table)}'
               AND c.name = N'${literalEscape(column)}' AND t.is_ms_shipped = 0`;
  const r = await run(q, { limit: 1, timeoutMs: 10_000 });
  const row = r.rows[0];
  return { exists: !!row, dataType: row ? String(row.dataType) : null };
}

export type CandidateLiveCheck = {
  tableExists: boolean;
  joinColumnExists: boolean;
  labelColumnExists: boolean;
  /** `TBLMUSTERI.<joinColumn>` — child FK kolonu. */
  joinColumnDataType: string | null;
  /** `<table>.TXTKOD` — lookup PK kolonu (Univera kuralı — sabit ad). */
  lookupKeyDataType: string | null;
  /** İkisi de bulunduğu halde `dataType` farklıysa `true` — JOIN'in sessizce
   *  0 satır eşleştirebileceği bir uyarı sinyali (ör. varchar vs int). */
  typeMismatch: boolean;
};

/**
 * Adayın tablo/kolonlarının canlı DB'de VAR olup olmadığını + tip uyumunu
 * doğrular. Tüm sorgular tek `Promise.all` turunda paralel gider.
 *
 * `parentTable`: `joinColumn`'un yaşadığı ebeveyn tablo — müşteri kırılımı
 * için `TBLMUSTERI` (varsayılan, geriye-uyum), ürün/marka kırılımı için
 * `TBLURUN`, bölge kırılımı için `TBLDIST` (bkz. `product-breakdown-config-
 * service.ts` / `region-breakdown-config-service.ts` çağrıları).
 */
export async function verifyCandidateLive(
  run: RunReadOnlyFn,
  candidate: CustomerBreakdownMeta,
  parentTable: string = "TBLMUSTERI",
): Promise<CandidateLiveCheck> {
  const [tableExists, joinCol, lookupKeyCol, labelCol] = await Promise.all([
    tableExistsLive(run, candidate.table),
    columnLive(run, parentTable, candidate.joinColumn),
    columnLive(run, candidate.table, "TXTKOD"),
    columnLive(run, candidate.table, candidate.labelColumn),
  ]);
  return {
    tableExists,
    joinColumnExists: joinCol.exists,
    labelColumnExists: labelCol.exists,
    joinColumnDataType: joinCol.dataType,
    lookupKeyDataType: lookupKeyCol.dataType,
    typeMismatch:
      joinCol.dataType != null && lookupKeyCol.dataType != null && joinCol.dataType !== lookupKeyCol.dataType,
  };
}

/** `verifyCandidateLive` sonucunun kaydetmeye uygun olup olmadığı — tablo VE
 *  her iki kolon da canlı DB'de bulunmalı (tip uyumsuzluğu REDDETMEZ, yalnız
 *  bir uyarı bayrağıdır — bazı meşru eşlemeler int/varchar karışık olabilir,
 *  match-rate asıl karar vericidir). */
export function isLiveCheckSavable(check: CandidateLiveCheck): boolean {
  return check.tableExists && check.joinColumnExists && check.labelColumnExists;
}

// ---------------------------------------------------------------------------
// Örnek değer önizlemesi
// ---------------------------------------------------------------------------

const MAX_PREVIEW_SAMPLES = 50;

/** `SELECT TOP N DISTINCT <labelColumn>` — adayın gerçek görünür değerleri
 *  ("Prestige", "Premium", …). Kaydetmeden önce admin'e "bu doğru mu?" gösterir. */
export async function previewSampleValues(
  run: RunReadOnlyFn,
  candidate: CustomerBreakdownMeta,
  limit = 10,
): Promise<string[]> {
  const n = Math.max(1, Math.min(limit, MAX_PREVIEW_SAMPLES));
  const q = `SELECT TOP ${n} LTRIM(RTRIM(${candidate.labelColumn})) AS val
             FROM dbo.${candidate.table}
             WHERE ${candidate.labelColumn} IS NOT NULL
               AND LTRIM(RTRIM(${candidate.labelColumn})) <> ''
             GROUP BY LTRIM(RTRIM(${candidate.labelColumn}))
             ORDER BY val`;
  const r = await run(q, { limit: n, timeoutMs: 10_000 });
  return r.rows.map((row) => String(row.val));
}

// ---------------------------------------------------------------------------
// Eşleşme oranı (match-rate)
// ---------------------------------------------------------------------------

export type MatchRateResult = {
  /** Kırılıma eşleşen (yani "(Tanımsız)" düşmeyen) aktif müşteri sayısı. */
  matched: number;
  /** Toplam aktif müşteri sayısı (BYTDURUM = 0). */
  total: number;
  /** `matched / total` — `total` 0 ise 0 (bölme hatası yerine güvenli varsayılan). */
  rate: number;
};

/**
 * `computeMatchRate` için ebeveyn-sorgu geçersiz kılmaları — vermezseniz
 * müşteri kırılımının bugünkü davranışı (TBLMUSTERI m, `m.BYTDURUM = 0`,
 * `customerBreakdownJoin(candidate)`, lookup alias `k`) BİREBİR korunur.
 * Ürün/bölge kırılımı servisleri kendi ebeveyn tablosunu (TBLURUN/TBLDIST)
 * ve JOIN fragment'ını (`productBreakdownJoin`/`regionBreakdownJoin`) geçirir.
 */
export type MatchRateQueryOpts = {
  parentTable?: string;
  parentAlias?: string;
  /** Vermezseniz `${parentAlias}.BYTDURUM = 0` (müşteri/ürün/dist üçünde de
   *  aktiflik bu kolonla işaretlenir — Univera kuralı). */
  activeFilter?: string;
  /** Vermezseniz `customerBreakdownJoin(candidate)` (geriye-uyum). */
  join?: string;
  lookupAlias?: string;
};

/**
 * Aday kırılımın kaç aktif ebeveyn satırında ("(Tanımsız)" düşmeden) gerçekten
 * çözüldüğünü ölçer. Varsayılan JOIN üreticisi (`customerBreakdownJoin()`) —
 * sink'lerin ZATEN çağırdığı ÜRETİCİYİ tekrar kullanır (DRY + "önizlemenin
 * gördüğü JOIN, üretimde çalışacak JOIN'in AYNISI" garantisi — paralel bir
 * kopya değil). `opts` ile ürün/bölge kırılımı da AYNI sorgu iskeletini kendi
 * ebeveyn tablosu/alias'ıyla kullanır.
 */
export async function computeMatchRate(
  run: RunReadOnlyFn,
  candidate: CustomerBreakdownMeta,
  opts: MatchRateQueryOpts = {},
): Promise<MatchRateResult> {
  const parentAlias = opts.parentAlias ?? "m";
  const parentTable = opts.parentTable ?? "TBLMUSTERI";
  const lookupAlias = opts.lookupAlias ?? "k";
  const activeFilter = opts.activeFilter ?? `${parentAlias}.BYTDURUM = 0`;
  const join = opts.join ?? customerBreakdownJoin(candidate);
  const q = `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN ${lookupAlias}.TXTKOD IS NOT NULL THEN 1 ELSE 0 END) AS matched
             FROM dbo.${parentTable} ${parentAlias}
             ${join}
             WHERE ${activeFilter}`;
  const r = await run(q, { limit: 1, timeoutMs: 20_000 });
  const row = r.rows[0] ?? {};
  const total = Number(row.total ?? 0);
  const matched = Number(row.matched ?? 0);
  return { matched, total, rate: total > 0 ? matched / total : 0 };
}
