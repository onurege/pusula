/**
 * DB bağlantı bilgisi konfigüratör servisi — Insider'ın admin panelden
 * (kod değişmeden) yeni bir MSSQL hedefine işaret edebilmesi için Faz A
 * Dalga 2'nin ikinci boyutu.
 *
 * Kapsam KASITLI OLARAK dar: bu dosyanın ADMİN-PANEL YÜZÜ (test/save/GET
 * meta) yalnız CREDS'İ test eder / şifreli saklar / maskeli okur — hiçbiri
 * `decryptSecret` çağırmaz. Aktif bağlantı havuzunun (`db.ts` `getPool()`)
 * bu store'dan runtime'da OKUYUP kullanması (Faz A Dalga 2'nin ikinci
 * yarısı — "creds → getPool wire") `getDecryptedDbConnectionOverride()`
 * ile burada sağlanır; bu TEK fonksiyon `decryptSecret` çağıran TEK yer ve
 * YALNIZ `db.ts` pool-init'inden çağrılmalı (dosya-altı not).
 *
 * GÜVENLİK (Security H2 — ham mssql hatası SIZDIRILMAZ):
 *   `testDbConnection()` her hatayı yutar, yalnız `{ ok: boolean }` döner.
 *   Ham hata (sunucu adı, sürücü mesajı, stack) yalnız sunucu log'una
 *   (`console.error`) yazılır — istemciye ASLA geçmez. mssql sürücü
 *   hataları tipik olarak sunucu/host/port bilgisini mesaja gömer; bunu
 *   client'a döndürmek iç ağ topolojisini (bir saldırgana) ifşa eder.
 *
 * GÜVENLİK (parola write-only, admin API yüzeyinde): `getDbConnectionMeta()`
 * şifreli alanı bile DÖNDÜRMEZ — yalnız `hasPassword: boolean`. Şifre çözme
 * (`decryptSecret`) admin panel endpoint'lerinden (GET/POST/test) HİÇ
 * ÇAĞRILMAZ — yalnız `getDecryptedDbConnectionOverride()` çözer, ve onun tek
 * çağıranı `db.ts getPool()`'dur (hiçbir HTTP yanıtına asla yazılmaz).
 */
import sql from "mssql";
import { decryptSecret, encryptSecret, getMappingOverride, setMappingOverride } from "./mapping-store";
import { recordConfigAudit } from "./audit-log";

export type DbConnectionInput = {
  server: string;
  database: string;
  user: string;
  password: string;
};

/** Endpoint'in gerçek mssql bağlantı denemesini enjekte ettiği fonksiyon
 *  tipi — başarılı olursa resolve, başarısızsa reject eder (mesaj/detay
 *  önemsiz, `testDbConnection` zaten yutup sanitize edecek). */
export type ConnectFn = (input: DbConnectionInput) => Promise<void>;

/**
 * `ConnectFn`'in ÜRETİM implementasyonu — kısa timeout'lu geçici bir
 * `sql.ConnectionPool` açar, bağlanır, HEMEN kapatır. Sorgu ÇALIŞTIRMAZ
 * (bağlantının kendisi yeterli test — DB salt-okunur ilkesiyle tutarlı,
 * hatta bir SELECT bile atmaz). Havuzu daima `finally`'de kapatır — bağlantı
 * başarılı olsa da başarısız olsa da soket sızıntısı bırakmaz.
 */
export const connectWithMssql: ConnectFn = async (input) => {
  const pool = new sql.ConnectionPool({
    server: input.server,
    database: input.database,
    user: input.user,
    password: input.password,
    connectionTimeout: 10_000,
    requestTimeout: 10_000,
    options: {
      encrypt: true,
      trustServerCertificate: process.env.NODE_ENV !== "production",
    },
  });
  try {
    await pool.connect();
  } finally {
    await pool.close().catch(() => undefined);
  }
};

/**
 * Bağlantıyı DENER, sonucu SANİTİZE EDİLMİŞ döner. `connectFn` başarısız
 * (reject) olursa ham hata yalnız log'a yazılır — client'a asla sızmaz.
 */
export async function testDbConnection(
  connectFn: ConnectFn,
  input: DbConnectionInput,
): Promise<{ ok: boolean }> {
  try {
    await connectFn(input);
    return { ok: true };
  } catch (err) {
    console.error(
      `[db-connection/test] "${input.server}/${input.database}" bağlantı başarısız:`,
      (err as Error).message,
    );
    return { ok: false };
  }
}

export type DbConnectionMeta = {
  server: string | null;
  database: string | null;
  user: string | null;
  /** Parola KENDİSİ asla dönmez — yalnız kayıtlı olup olmadığı. */
  hasPassword: boolean;
};

/** Kayıtlı DB bağlantı override'ının maskeli görünümü — parola alanı YOK. */
export function getDbConnectionMeta(tenantId: string): DbConnectionMeta {
  const creds = getMappingOverride(tenantId)?.dbCredentials;
  if (!creds) return { server: null, database: null, user: null, hasPassword: false };
  return { server: creds.server, database: creds.database, user: creds.user, hasPassword: true };
}

/** `getDecryptedDbConnectionOverride()`'ın döndürdüğü ŞİFRESİ ÇÖZÜLMÜŞ şekil
 *  — parola DÜZ METİN. Bu tip yalnız `db.ts` pool-init'inde dolaşır, hiçbir
 *  HTTP response/log/audit'e serialize EDİLMEMELİ. */
export type DecryptedDbConnection = {
  server: string;
  database: string;
  user: string;
  password: string;
};

/**
 * DB creds'i ŞİFRESİ ÇÖZÜLMÜŞ olarak döner — override yoksa `null` (çağıran
 * `.env` prefix fallback'ine düşer).
 *
 * GÜVENLİK: bu, dosyadaki (ve pratikte tüm konfigüratörde) `decryptSecret`
 * çağıran TEK fonksiyondur. YALNIZ `db.ts` `getPool()` pool-init'inde
 * çağrılmalı — hiçbir admin/setup endpoint'i bunu çağırmamalı (parola
 * write-only sözleşmesi, dosya-üstü not). Bozuk/kurcalanmış şifreli alan
 * (yanlış `CONFIG_ENC_KEY` ya da auth-tag uyuşmazlığı) burada THROW eder —
 * sessizce `.env`'e düşmek YANLIŞ bir tenant'ın DB'sine bağlanma riski
 * taşır (fail-closed, `mapping-store.ts` `decryptSecret` sözleşmesiyle
 * tutarlı).
 */
export function getDecryptedDbConnectionOverride(tenantId: string): DecryptedDbConnection | null {
  const creds = getMappingOverride(tenantId)?.dbCredentials;
  if (!creds) return null;
  return {
    server: creds.server,
    database: creds.database,
    user: creds.user,
    password: decryptSecret(creds.password),
  };
}

/** Audit satırına yazılacak maskeli görünüm — şifreli alanı bile TUTMAZ. */
function maskCredentials(
  creds: { server: string; database: string; user: string } | undefined,
): Record<string, string> | null {
  if (!creds) return null;
  return { server: creds.server, database: creds.database, user: creds.user, password: "***" };
}

export type SaveDbConnectionDeps = {
  tenantId: string;
  actor: string;
  input: DbConnectionInput;
};

/**
 * DB bağlantı bilgisini şifreli (AES-256-GCM, `mapping-store.ts`) yazar.
 * Mevcut override'ın DİĞER alanları (`dimensions.customerBreakdown`)
 * KORUNUR — yalnız `dbCredentials` üzerine yazılır.
 */
export async function saveDbConnectionOverride(deps: SaveDbConnectionDeps): Promise<void> {
  const { tenantId, actor, input } = deps;
  const current = getMappingOverride(tenantId);

  await setMappingOverride(tenantId, {
    ...current,
    dbCredentials: {
      server: input.server,
      database: input.database,
      user: input.user,
      password: encryptSecret(input.password),
    },
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  });

  await recordConfigAudit({
    tenantId,
    actor,
    action: "save",
    field: "dbCredentials",
    oldValue: maskCredentials(current?.dbCredentials),
    newValue: maskCredentials({ server: input.server, database: input.database, user: input.user }),
  });
}
