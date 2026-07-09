/**
 * Kullanıcı girişi + dist-bazlı yetkilendirme.
 *
 * text-to-sql uygulamasındaki `lib/auth.ts` desenini Pusula'nın iki-servisli
 * mimarisine (ayrı Hono API + Next dashboard) uyarlar:
 *
 *   - Kimlik doğrulama Univera'nın `TBLKULLANICI` tablosundan
 *   - İzinli distribütörler `ERCVIEWTBLKULLANICIDIST_DASHBOARD` view'ından
 *   - Rol: BYTTIP=0 + tüm aktif dist'lere erişim → `merkez`, aksi → `dist`
 *   - Oturum: jose ile HS256 imzalı JWT
 *   - `resolveTenantScope`: SUNUCU-OTORİTER — dist kullanıcı client'tan başka
 *     distId gönderse bile kendi izinli dist'lerinin dışına çıkamaz
 *   - `distFilterClause`: SQL'e `AND <alias> IN (...)` enjekte eder
 *
 * Şifre doğrulama: Univera şifreleri statik-anahtar AES-128-ECB ile şifreli
 * (base64, 16 byte tek blok, salt yok). Anahtar `UNIVERA_PW_KEY` env
 * değişkeninden gelir; verilmezse veya boot self-test'i tutmazsa DEMO MODU'na
 * düşer (kullanıcı aktifse şifre kontrol edilmez — text-to-sql davranışı).
 */
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { runReadOnly } from "./db.js";

const DEV_JWT_SECRET_FALLBACK = "enroute-pusula-secret-change-in-production";
const MIN_JWT_SECRET_LENGTH = 16;

/**
 * JWT_SECRET'i doğrula ve döndür. Üretimde eksik/kısa secret ile token forge
 * edilebileceğinden boot'ta fail-fast ile durur; dev'de default'a düşer.
 */
function resolveJwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!raw) {
    if (isProd) {
      throw new Error("JWT_SECRET üretimde zorunlu — .env dosyasına en az 16 karakterlik bir secret ekleyin.");
    }
    console.warn(
      "[auth] JWT_SECRET yok — DEV varsayılan secret kullanılıyor. Üretimde bu ölümcül bir açıktır, mutlaka ayarlayın.",
    );
    return DEV_JWT_SECRET_FALLBACK;
  }

  if (raw.length < MIN_JWT_SECRET_LENGTH) {
    if (isProd) {
      throw new Error(
        `JWT_SECRET çok kısa (${raw.length} karakter) — üretimde en az ${MIN_JWT_SECRET_LENGTH} karakter zorunlu.`,
      );
    }
    console.warn(
      `[auth] JWT_SECRET çok kısa (${raw.length} karakter, min ${MIN_JWT_SECRET_LENGTH} önerilir). Üretimde reddedilecek.`,
    );
  }

  return raw;
}

const JWT_SECRET = new TextEncoder().encode(resolveJwtSecret());

export const AUTH_COOKIE_NAME = "enroute_auth";

export type UserRole = "merkez" | "dist";

export type UserSession = {
  userId: number;
  username: string;
  displayName: string | null;
  role: UserRole;
  /** Kullanıcının erişebildiği aktif distribütör kodları. */
  allowedDistKods: number[];
};

/**
 * Tenant scope — sunucu-otoriter distribütör filtresi.
 *
 * - `merkez` + `distKods: null`  → filtre yok (tüm distribütörler)
 * - `merkez` + `distKods: [N]`   → merkez kullanıcı tek dist'e drill-down yaptı
 * - `dist`   + `distKods`        → dist kullanıcı; DAİMA JWT-izinli dist'lerle
 *                                   sınırlı, client ne gönderirse göndersin
 */
export type TenantScope =
  | { type: "merkez"; distKods: number[] | null }
  | { type: "dist"; distKods: number[] };

// ---------------------------------------------------------------------------
// Şifre doğrulama (AES-128-ECB pluggable + demo fallback)
// ---------------------------------------------------------------------------

// Bilinen açık/şifreli çift — anahtar doğru yüklendiğinde boot self-test'i.
const SELFTEST_PLAIN = "321";
const SELFTEST_CIPHER = "NHZI8nQ3ijIGZVRW2jwShg==";

/** UNIVERA_PW_KEY'i hex / base64 / utf8 olarak yorumlayıp 16/24/32 bayta çevir. */
function loadPwKey(): Buffer | null {
  const raw = process.env.UNIVERA_PW_KEY;
  if (!raw) return null;
  // hex mi?
  if (/^[0-9a-fA-F]+$/.test(raw) && (raw.length === 32 || raw.length === 48 || raw.length === 64)) {
    return Buffer.from(raw, "hex");
  }
  // base64 mü? (16/24/32 bayta çözülüyorsa)
  try {
    const b = Buffer.from(raw, "base64");
    if ([16, 24, 32].includes(b.length)) return b;
  } catch {
    /* düş */
  }
  // ham utf8 (16/24/32 karakter)
  if ([16, 24, 32].includes(Buffer.byteLength(raw, "utf8"))) {
    return Buffer.from(raw, "utf8");
  }
  return null;
}

function aesEcbEncryptBase64(plain: string, key: Buffer, enc: BufferEncoding): string | null {
  const algo = key.length === 16 ? "aes-128-ecb" : key.length === 24 ? "aes-192-ecb" : "aes-256-ecb";
  try {
    const c = crypto.createCipheriv(algo, key, null);
    c.setAutoPadding(true);
    return Buffer.concat([c.update(Buffer.from(plain, enc)), c.final()]).toString("base64");
  } catch {
    return null;
  }
}

let pwModeCache: { mode: "aes"; key: Buffer; enc: BufferEncoding } | { mode: "demo" } | null = null;

/**
 * Şifre modunu bir kez çöz: geçerli anahtar + self-test tutan encoding varsa
 * "aes", yoksa "demo". Sonuç cache'lenir (process ömrü boyunca).
 */
function resolvePwMode(): { mode: "aes"; key: Buffer; enc: BufferEncoding } | { mode: "demo" } {
  if (pwModeCache) return pwModeCache;
  const key = loadPwKey();
  if (key) {
    for (const enc of ["utf8", "utf16le"] as BufferEncoding[]) {
      if (aesEcbEncryptBase64(SELFTEST_PLAIN, key, enc) === SELFTEST_CIPHER) {
        console.log(`[auth] Şifre doğrulama AKTİF (AES-ECB, ${enc}). Self-test geçti.`);
        pwModeCache = { mode: "aes", key, enc };
        return pwModeCache;
      }
    }
  }

  // Anahtar yok veya self-test tutmadı → demo moduna düşülecek. Üretimde bu,
  // "her şifre kabul edilir" demek olduğundan varsayılan olarak durdurulur;
  // yalnızca ALLOW_DEMO_AUTH=1 ile bilinçli override edilebilir.
  const isProd = process.env.NODE_ENV === "production";
  const demoOverride = process.env.ALLOW_DEMO_AUTH === "1";
  const reason = key
    ? "UNIVERA_PW_KEY verildi ama self-test tutmadı (321 → beklenen cipher üretilemedi)"
    : "UNIVERA_PW_KEY yok";

  if (isProd && !demoOverride) {
    throw new Error(
      `UNIVERA_PW_KEY üretimde zorunlu — şifre doğrulaması yapılamıyor (${reason}). ` +
        "Bilinçli olarak demo moduna izin vermek için ALLOW_DEMO_AUTH=1 ayarlayın.",
    );
  }

  if (isProd && demoOverride) {
    console.warn(
      `[auth] ÜRETİMDE DEMO MODU AÇIK (ALLOW_DEMO_AUTH=1) — ${reason}. Aktif kullanıcı için şifre doğrulanmıyor. Bu bilinçli bir override.`,
    );
  } else {
    console.warn(`[auth] ${reason} — DEMO MODU: aktif kullanıcı için şifre doğrulanmaz. Üretimde anahtarı ekleyin.`);
  }

  pwModeCache = { mode: "demo" };
  return pwModeCache;
}

/**
 * Girilen şifreyi DB'deki şifreli değerle karşılaştır.
 * - AES modu: encrypt(girilen) === stored
 * - Demo modu: her zaman true (çağıran, kullanıcının aktifliğini ayrıca kontrol eder)
 */
export function verifyUniveraPassword(plain: string, storedCipher: string | null): boolean {
  const mode = resolvePwMode();
  if (mode.mode === "demo") return true;
  if (!storedCipher) return false;
  return aesEcbEncryptBase64(plain, mode.key, mode.enc) === storedCipher.trim();
}

// ---------------------------------------------------------------------------
// Kimlik doğrulama
// ---------------------------------------------------------------------------

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Kullanıcıyı doğrula. Başarılıysa oturum bilgisini döner, aksi halde null.
 * Şifre AES modunda gerçek doğrulanır; demo modunda yalnızca kullanıcının
 * aktif (BYTDURUM=0) olması yeterlidir.
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<UserSession | null> {
  const uname = escapeSqlLiteral(username.trim());
  if (!uname) return null;

  // Kullanıcı + izinli aktif dist'ler tek sorguda.
  const userRes = await runReadOnly(
    `SELECT TOP 1 LNGKOD, TXTKULLANICIISIM, TXTPASSWORD, TXTADSOYAD, BYTTIP
     FROM dbo.TBLKULLANICI
     WHERE TXTKULLANICIISIM = '${uname}' AND BYTDURUM = 0`,
    { limit: 1 },
  );
  const user = userRes.rows[0];
  if (!user) return null;

  if (!verifyUniveraPassword(password, user.TXTPASSWORD == null ? null : String(user.TXTPASSWORD))) {
    return null;
  }

  const userId = Number(user.LNGKOD);

  // İzinli aktif distribütörler — view'ı TBLDIST (aktif) ile kesiştir ki
  // pasif dist'ler listeye girmesin.
  const distRes = await runReadOnly(
    `SELECT DISTINCT v.LNGDISTKOD
     FROM dbo.ERCVIEWTBLKULLANICIDIST_DASHBOARD v
     INNER JOIN dbo.TBLDIST d ON d.LNGKOD = v.LNGDISTKOD AND d.BYTDURUM = 0
     WHERE v.LNGKOD = ${userId} AND v.BYTDURUM = 0`,
    { limit: 1000 },
  );
  const allowedDistKods = distRes.rows
    .map((r) => Number(r.LNGDISTKOD))
    .filter((n) => Number.isInteger(n));

  // Toplam aktif dist — merkez/dist ayrımı için.
  const totalRes = await runReadOnly(
    `SELECT COUNT(*) AS c FROM dbo.TBLDIST WHERE BYTDURUM = 0`,
    { limit: 1 },
  );
  const totalDists = Number(totalRes.rows[0]?.c ?? 0);

  const byttip = Number(user.BYTTIP ?? 0);
  const role: UserRole =
    byttip === 0 && totalDists > 0 && allowedDistKods.length >= totalDists * 0.8
      ? "merkez"
      : "dist";

  return {
    userId,
    username: String(user.TXTKULLANICIISIM ?? username),
    displayName: user.TXTADSOYAD == null ? null : String(user.TXTADSOYAD),
    role,
    allowedDistKods,
  };
}

// ---------------------------------------------------------------------------
// JWT oturum
// ---------------------------------------------------------------------------

export async function signSession(user: UserSession): Promise<string> {
  return new SignJWT({
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    allowedDistKods: user.allowedDistKods,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

export async function verifySession(token: string | null | undefined): Promise<UserSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as number,
      username: payload.username as string,
      displayName: (payload.displayName as string | null) ?? null,
      role: payload.role as UserRole,
      allowedDistKods: (payload.allowedDistKods as number[]) ?? [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tenant scope + SQL filtresi
// ---------------------------------------------------------------------------

/**
 * Oturum + opsiyonel seçili dist'ten scope çöz. SUNUCU-OTORİTER.
 *
 * @throws Error("UNAUTHENTICATED") oturum yoksa.
 */
export function resolveTenantScope(
  session: UserSession | null,
  selectedDistKod?: number | null,
): TenantScope {
  if (!session) throw new Error("UNAUTHENTICATED");

  const sel =
    selectedDistKod != null && Number.isInteger(selectedDistKod) ? selectedDistKod : null;

  if (session.role === "merkez") {
    // Merkez: tam görünürlük; ama izinli bir dist'e drill-down yapabilir.
    if (sel != null && session.allowedDistKods.includes(sel)) {
      return { type: "merkez", distKods: [sel] };
    }
    return { type: "merkez", distKods: null };
  }

  // Dist: sunucu otoritesi. Client'tan gelen distKod YALNIZCA kendi izinli
  // dist'lerinden biriyse kabul edilir; aksi halde tüm izinli listeye düşer.
  // Asla genişletmez → başka dist'in verisi görülemez.
  const allowed = session.allowedDistKods.filter((n) => Number.isInteger(n));
  if (sel != null && allowed.includes(sel)) {
    return { type: "dist", distKods: [sel] };
  }
  return { type: "dist", distKods: allowed };
}

/**
 * Scope'u SQL WHERE fragment'ına çevir.
 * - merkez + null  → "" (filtre yok)
 * - boş liste      → " AND 1=0" (hiçbir şey görme — güvenli varsayılan)
 * - aksi           → " AND <alias> IN (1,2,3)"
 */
export function distFilterClause(scope: TenantScope, alias = "LNGDISTKOD"): string {
  if (scope.type === "merkez" && scope.distKods === null) return "";
  const ids = (scope.distKods ?? []).filter((n) => Number.isInteger(n));
  if (ids.length === 0) return " AND 1=0";
  return ` AND ${alias} IN (${ids.join(",")})`;
}

/** Scope tek bir dist'e sabitlenmişse onu döner; aksi halde null. */
export function scopeSingleDistId(scope: TenantScope): number | null {
  if (scope.distKods && scope.distKods.length === 1) return scope.distKods[0] ?? null;
  return null;
}

/** İzinli distribütörlerin (kod + ad) listesi — dropdown için. */
export async function listAllowedDistributors(
  session: UserSession,
): Promise<Array<{ id: number; ad: string }>> {
  const ids = session.allowedDistKods.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];
  const res = await runReadOnly(
    `SELECT LNGKOD, TXTAD FROM dbo.TBLDIST
     WHERE LNGKOD IN (${ids.join(",")}) AND BYTDURUM = 0
     ORDER BY TXTAD`,
    { limit: 1000 },
  );
  return res.rows.map((r) => ({ id: Number(r.LNGKOD), ad: String(r.TXTAD ?? "") }));
}
