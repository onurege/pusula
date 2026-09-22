/**
 * Insider Konfigüratörü — wire tipleri + fetch yardımcıları (Faz A Dalga 3,
 * Faz B Dalga 2'de ürün/bölge kırılımlarını kapsayacak şekilde genişletildi).
 *
 * `packages/core/src/tenant/{customer,product,region}-breakdown-config-
 * service.ts`, `db-connection-config.ts`, `{customer,product,region}
 * -breakdown-candidates.ts`, `schema-check.ts`'teki gerçek response
 * şekliyle BİREBİR (server.ts'ten okunarak yazıldı — üç boyut da AYNI
 * `{current, candidates[]}` / `{meta, live, sampleValues, matchRate}`
 * şeklini döner, bu yüzden tipler zaten boyut-agnostik: `table`/`joinColumn`/
 * `labelColumn` isimleri üç boyutta da sabit, yalnız DEĞERLERİ değişir).
 * Bilerek buradan import ETMİYORUZ: o paketin "./tenant" export'u dışına
 * deep-import Node ESM exports map'i yüzünden zaten mümkün değil, ve o
 * dosyalar `mssql` gibi server-only bağımlılık taşıyor — client bundle'a hiç
 * bulaşmasın diye yalnız DTO şeklini burada, kullanım noktasında, kopyalıyoruz
 * (colocation).
 */

export type LiveCheck = {
  tableExists: boolean;
  joinColumnExists: boolean;
  labelColumnExists: boolean;
  joinColumnDataType: string | null;
  lookupKeyDataType: string | null;
  typeMismatch: boolean;
};

export type BreakdownMeta = { table: string; joinColumn: string; labelColumn: string };

export type Candidate = BreakdownMeta & {
  id: string;
  displayName: string;
  description: string;
  live: LiveCheck;
};

export type BreakdownConfigResponse = { current: BreakdownMeta; candidates: Candidate[] };

export type MatchRate = { matched: number; total: number; rate: number };

export type PreviewResponse = {
  meta: BreakdownMeta;
  live: LiveCheck;
  sampleValues: string[] | null;
  matchRate: MatchRate | null;
};

export type DbConnectionMeta = {
  server: string | null;
  database: string | null;
  user: string | null;
  hasPassword: boolean;
};

/**
 * Tenant kimliği DTO'ları — `packages/core/src/tenant/{types,tenant-
 * definition-store,tenant-config-service}.ts`'teki gerçek şekille BİREBİR
 * (koddan okunarak yazıldı, Faz A Dalga 1). Yine buradan import ETMİYORUZ:
 * bu dosyanın üst yorumundaki gerekçe (deep-import mümkün değil + modülün
 * kendi DTO kopyalama disiplini) burada da geçerli — `Industry`/`TaxToggle`/
 * `TenantLabels` teknik olarak `@enroute/core/tenant`'ın public yüzeyinde
 * olsa da (`tenant-provider.tsx` onları type-only import eder), bu dosyanın
 * TÜM wire tipleri aynı kuralı izliyor: tek modül, tek kaynak, karışık
 * import stratejisi yok.
 */
export type Industry = "alcohol" | "fmcg";

export type TaxToggle = {
  key: string;
  label: string;
  showInToggle: boolean;
};

export type TenantLabels = {
  morningHeadline: string;
  channelTypeTitle: string;
  channelTypeSource: string;
  mapEmptyDataSource: string;
  kpiSourceNote: string;
  volumeMultiplierHint: string;
};

export type TenantDefinitionInput = {
  id: string;
  displayName: string;
  industry: Industry;
  strategicBrands: string[];
  labels: TenantLabels;
  tax: TaxToggle;
  logoMark?: string;
};

export type TenantDefinition = TenantDefinitionInput & {
  updatedAt: string;
  updatedBy?: string;
};

/** GET `/api/admin/config/tenant` yanıtı — alan adı `registryManaged`
 *  (`isRegistryManaged` DEĞİL — `tenant-config-service.ts`'ten teyitli). */
export type ActiveTenantDefinitionMeta = {
  tenantId: string;
  registryManaged: boolean;
  definition: TenantDefinition | null;
  /** Bu ekranda kullanılmıyor (yalnız kimlik alanları düzenleniyor,
   *  `buildTenantFromDefinition` önizlemesi kapsam dışı) — şekli tam
   *  modellemek yerine `unknown` bırakıldı, erken soyutlama yok. */
  config: unknown;
};

/** Çok-DB (login'de DB seçimi) — `databases-config.ts` şekliyle birebir. */
export type DatabaseEntry = { id: string; label: string; database: string };

export type SaveMsg = { tone: "good" | "bad"; text: string };

const GENERIC_ERROR = "Beklenmeyen bir hata oluştu — tekrar deneyin.";

/** Sunucudan gelen `{error}` metnini gösterir (bunlar zaten sanitize edilmiş,
 *  kullanıcıya-uygun mesajlar — bkz. servis katmanı yorumları); yalnız ağ/parse
 *  hatası gibi BEKLENMEYEN durumlarda jenerik mesaja düşer, ham hata console'a. */
export function friendlyError(err: unknown, serverMessage?: string | null): string {
  if (serverMessage) return serverMessage;
  console.error("[insider-konfigurator]", err);
  return GENERIC_ERROR;
}

/** `fetch` response'unu `{data, errorMessage, issues}`'a çevirir — `!res.ok`
 *  durumunda body'deki `{error}` metnini (ve varsa `TenantValidationError`'ın
 *  alan-bazlı `{issues}` listesini) taşır, aksi halde `data`'yı doldurur.
 *  `issues` yalnız tenant-kimlik uçlarında dolu gelir; diğer çağıranlar bu
 *  alanı yok sayar (geriye uyumlu ek). */
export async function readJson<T>(
  res: Response,
): Promise<{ data: T | null; errorMessage: string | null; issues: string[] | null }> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { data: null, errorMessage: null, issues: null };
  }
  if (!res.ok) {
    const parsed = body as { error?: string; issues?: string[] } | null;
    const issues = Array.isArray(parsed?.issues) ? parsed.issues : null;
    return { data: null, errorMessage: parsed?.error ?? null, issues };
  }
  return { data: body as T, errorMessage: null, issues: null };
}

export function matchRateTone(rate: number): "good" | "warn" | "bad" {
  if (rate >= 0.9) return "good";
  if (rate >= 0.5) return "warn";
  return "bad";
}
