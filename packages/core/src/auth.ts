/**
 * Kullanıcı girişi + dist-bazlı yetkilendirme.
 *
 * text-to-sql uygulamasındaki `lib/auth.ts` desenini Insider'ın iki-servisli
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
 * Şifre doğrulama: Univera şifreleri `clsString.CustomEncrypt` şemasıyla
 * saklanır — AES-128-CBC, sabit public key/IV (`P@ssw0rd`/`%1Az=-@qT`), cp1252,
 * PKCS7, base64 (bkz. `univeraCustomEncrypt`). Doğrulama app'te
 * `encrypt(girilen) === stored` ile yapılır; env anahtarı GEREKMEZ. Şema
 * self-test'i (`pwReady`) tutmazsa doğrulama FAIL-CLOSED'dur (giriş reddedilir);
 * eski "demo modu = her şifre kabul" davranışı kaldırılmıştır. (Yalnız
 * `demoData` tenant'ları ayrı bir statik `DEMO_LOGIN_*` yolu kullanır.)
 */
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";
import { getTenantConfig } from "./tenant/index.js";
import { getUserPerm } from "./user-perms.js";

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
  /**
   * Çok-DB kurulumunda (login'de DB seçimi) seçili veritabanı kimliği
   * (`TenantConfig.databases[].id`). Tek-DB tenant'larda undefined. JWT'ye
   * gömülür → sonraki her istek bu DB'ye yönlenir (bkz. `request-context.ts`).
   */
  dbId?: string;
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
  | { type: "merkez"; distKods: number[] | null; cities: string[] | null }
  | { type: "dist"; distKods: number[]; cities: string[] | null };

// ---------------------------------------------------------------------------
// Şifre doğrulama — Univera legacy CustomEncrypt (AES-128-CBC, sabit key/IV)
// ---------------------------------------------------------------------------
//
// Panorama, TBLKULLANICI.TXTPASSWORD'u Univera'nın clsString.CustomEncrypt
// (Univera.Framework.Extensions.dll, 2015) şemasıyla saklar:
//   AES-128-CBC · PKCS7 · sabit anahtar "P@ssw0rd"+0 (16B) · sabit IV
//   "%1Az=-@qT"+0 (16B) · düz metin cp1252(≈latin1) · çıktı base64.
// Anahtar ve IV programa gömülü, herkese açık sabitlerdir (gerçek gizlilik
// değil, eski-veri uyumluluğu) — bu yüzden env anahtarı GEREKMEZ. Doğrulama:
// encrypt(girilen) === stored (sabit IV → deterministik). Şema kaynak spec'in
// test vektörleriyle bit-bazında doğrulandı; "321" → SELFTEST_CIPHER boot'ta
// teyit edilir.
//
// cp1252 notu: Türkçe'ye özgü ğ ş İ ı harfleri cp1252'de yoktur (orijinal DLL
// bunları '?' yapar); şifreler tipik olarak ASCII olduğundan latin1 yeterli.

/** clsString.CustomEncrypt'in "zaten base64 ise dokunma" kısayolu. */
function looksBase64(s: string): boolean {
  const t = s.replace(/[ \t\r\n]/g, "");
  return t.length > 0 && t.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

// Sabit anahtar/IV — 16 bayta sıfırla sağdan doldurulur (Rijndael min 128 bit).
const PW_KEY = ((): Buffer => {
  const b = Buffer.alloc(16);
  Buffer.from("P@ssw0rd", "latin1").copy(b);
  return b;
})();
const PW_IV = ((): Buffer => {
  const b = Buffer.alloc(16);
  Buffer.from("%1Az=-@qT", "latin1").copy(b);
  return b;
})();

/**
 * Univera clsString.CustomEncrypt birebir taklidi. Girdi geçerli base64 ise
 * (orijinal kısayol) olduğu gibi döner; aksi halde AES-128-CBC/PKCS7 ile
 * şifreleyip base64 döner.
 */
export function univeraCustomEncrypt(plain: string): string {
  if (looksBase64(plain)) return plain;
  const c = crypto.createCipheriv("aes-128-cbc", PW_KEY, PW_IV);
  return Buffer.concat([c.update(Buffer.from(plain, "latin1")), c.final()]).toString("base64");
}

// Bilinen açık/şifreli çift — boot self-test'i (CustomEncrypt CBC vektörü).
const SELFTEST_PLAIN = "321";
const SELFTEST_CIPHER = "NHZI8nQ3ijIGZVRW2jwShg==";

let pwSelftestOk: boolean | null = null;
/** Şema self-test'ini bir kez koşar; tutmazsa doğrulama fail-closed olur. */
function pwReady(): boolean {
  if (pwSelftestOk === null) {
    pwSelftestOk = univeraCustomEncrypt(SELFTEST_PLAIN) === SELFTEST_CIPHER;
    if (pwSelftestOk) {
      console.log("[auth] Şifre doğrulama AKTİF (Univera CustomEncrypt, AES-128-CBC). Self-test geçti.");
    } else {
      console.error(
        "[auth] ŞİFRE SELF-TEST TUTMADI — CustomEncrypt beklenen vektörü üretmedi; tüm girişler reddedilecek.",
      );
    }
  }
  return pwSelftestOk;
}

/**
 * Girilen şifreyi DB'deki şifreli değerle karşılaştır: encrypt(girilen) ===
 * stored. Env anahtarı gerekmez (şema sabit). Self-test tutmazsa fail-closed
 * — eski "demo modu = her şifre kabul" davranışı kaldırıldı.
 */
export function verifyUniveraPassword(plain: string, storedCipher: string | null): boolean {
  if (!storedCipher || !pwReady()) return false;
  return univeraCustomEncrypt(plain) === storedCipher.trim();
}

// ---------------------------------------------------------------------------
// Kimlik doğrulama
// ---------------------------------------------------------------------------

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Kullanıcıyı doğrula. Başarılıysa oturum bilgisini döner, aksi halde null.
 * Şifre `verifyUniveraPassword` ile gerçek doğrulanır (fail-closed); yalnız
 * `demoData` tenant'ları ayrı statik `DEMO_LOGIN_*` yoluyla girer.
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<UserSession | null> {
  // Demo tenant (MSSQL yok): yalnızca statik demo kullanıcısıyla doğrula,
  // MSSQL'e HİÇ gidilmez. Kimlik env'den (DEMO_LOGIN_USER/PASSWORD).
  if (getTenantConfig().demoData) {
    const demoUser = process.env.DEMO_LOGIN_USER?.trim();
    const demoPass = process.env.DEMO_LOGIN_PASSWORD;
    if (
      demoUser &&
      demoPass &&
      username.trim() === demoUser &&
      password === demoPass
    ) {
      return {
        userId: 0,
        username: demoUser,
        displayName: "Demo Kullanıcı",
        role: "merkez",
        allowedDistKods: [],
      };
    }
    return null;
  }

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

  // Merkez/dist ayrımı DOĞRUDAN kullanıcı tablosundan: TBLKULLANICI.BYTTIP=0
  // → merkez kullanıcı, aksi halde dist. (Erişim politikası: şu an yalnızca
  // merkez giriş yapabilir — bkz. server.ts login/scope kapıları.)
  const byttip = Number(user.BYTTIP ?? 0);
  const role: UserRole = byttip === 0 ? "merkez" : "dist";

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
    dbId: user.dbId ?? null,
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
      dbId: (payload.dbId as string | null) ?? undefined,
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

  // Demo tenant (fmcg-demo): Panorama/MSSQL yok, tek statik merkez kullanıcı
  // `allowedDistKods=[]` ile gelir. Panorama-scoping BURADA geçerli değildir —
  // demo kullanıcısı tüm sentetik veriyi görür (filtresiz merkez).
  if (getTenantConfig().demoData === true) {
    return { type: "merkez", distKods: null, cities: null };
  }

  const sel =
    selectedDistKod != null && Number.isInteger(selectedDistKod) ? selectedDistKod : null;

  // Perms store — admin-yönetimli yetki override'ı (null → kısıt yok).
  // Sunucu-otoriter; client bunu değiştiremez.
  const perm = getUserPerm(session.username);
  const cities = perm.cities;
  const permDists =
    perm.dists != null ? perm.dists.filter((n) => Number.isInteger(n)) : null;

  // VERİ KAPSAMI = PANORAMA yetkisi (allowedDistKods) — HERKES İÇİN, merkez
  // dahil. Panorama tek otorite: BYTTIP=0 (merkez) sadece "giriş yapabilir"
  // demek; ne göreceği Panorama'daki distribütör yetkisiyle sınırlıdır. Admin
  // override'ı (perm.dists) bu kümeyi yalnızca DARALTIR (asla genişletemez).
  // `type` login rolünü yansıtır (merkez-only güç işlemleri bununla gate'lenir),
  // ama distKods artık merkez için de Panorama kümesidir (null=filtresiz DEĞİL).
  let allowed = session.allowedDistKods.filter((n) => Number.isInteger(n));
  if (permDists != null) {
    const permSet = new Set(permDists);
    allowed = allowed.filter((d) => permSet.has(d));
  }
  // İzinli bir dist'e drill-down (yalnızca kendi kapsamı içinde).
  const distKods = sel != null && allowed.includes(sel) ? [sel] : allowed;
  return session.role === "merkez"
    ? { type: "merkez", distKods, cities }
    : { type: "dist", distKods, cities };
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

/**
 * Şehir scope'unu SQL WHERE fragment'ına çevir (kullanıcının izinli şehirleri).
 * - cities null  → "" (kısıt yok)
 * - boş liste    → " AND 1=0"
 * - aksi         → " AND LTRIM(RTRIM(<alias>)) IN (N'İstanbul',...)"
 * `alias` şehir kolonu (TBLMUSTERI.TXTSEHIR) — çağıran join'i sağlamalı.
 */
export function cityFilterClause(scope: TenantScope, alias = "TXTSEHIR"): string {
  const cities = scope.cities;
  if (!cities) return "";
  if (cities.length === 0) return " AND 1=0";
  const escaped = cities.map((c) => `N'${c.replace(/'/g, "''")}'`).join(",");
  return ` AND LTRIM(RTRIM(${alias})) IN (${escaped})`;
}

/**
 * Şehir scope'unu AGREGAT fatura sorgularına GROUP BY'ı bozmadan uygulamak için
 * semi-join predikatı. TBLMUSTERI'ye JOIN eklemek yerine fact satırlarını
 * yalnızca izinli şehirlerdeki müşterilere daraltır — satır çoğalması / grup
 * kayması yok. `custKeyCol` fact tablosundaki müşteri anahtarı (LNGMUSTERIKOD).
 * - cities null  → "" (kısıt yok)
 * - boş liste    → " AND 1=0"
 */
export function cityFactClause(
  cities: string[] | null | undefined,
  custKeyCol = "f.LNGMUSTERIKOD",
): string {
  if (!cities) return "";
  if (cities.length === 0) return " AND 1=0";
  const escaped = cities.map((c) => `N'${c.replace(/'/g, "''")}'`).join(",");
  return (
    ` AND ${custKeyCol} IN (SELECT LNGKOD FROM dbo.TBLMUSTERI` +
    ` WHERE BYTDURUM = 0 AND LTRIM(RTRIM(TXTSEHIR)) IN (${escaped}))`
  );
}

/**
 * Doğrudan bir şehir kolonuna (ör. TBLMUSTERI.TXTSEHIR) uygulanan şehir
 * kısıtı — cityFilterClause'un ham (scope'suz) sürümü.
 */
export function cityColClause(
  cities: string[] | null | undefined,
  alias: string,
): string {
  if (!cities) return "";
  if (cities.length === 0) return " AND 1=0";
  const escaped = cities.map((c) => `N'${c.replace(/'/g, "''")}'`).join(",");
  return ` AND LTRIM(RTRIM(${alias})) IN (${escaped})`;
}

/**
 * İzinli şehir kümesi için deterministik, kısa cache etiketi. Sıra bağımsız
 * (sıralanır), djb2 hash — Date/Math.random yok. cities null → "all".
 */
export function cityCacheTag(cities: string[] | null | undefined): string {
  if (!cities) return "all";
  if (cities.length === 0) return "none";
  const norm = cities
    .map((c) => c.trim().toLocaleLowerCase("tr"))
    .sort()
    .join("|");
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(36)}`;
}

/** Scope tek bir dist'e sabitlenmişse onu döner; aksi halde null. */
export function scopeSingleDistId(scope: TenantScope): number | null {
  if (scope.distKods && scope.distKods.length === 1) return scope.distKods[0] ?? null;
  return null;
}

/**
 * Son `days` günde en çok fatura kesen aktif dist kodları (hacme göre azalan).
 * Gece-refresh'in dist-scope cache'lerini ısıtması için — TÜM dist'leri değil,
 * gerçekten kullanılan en aktif olanları döndürür (03:00 job'ını ve MSSQL'i
 * boğmamak için `limit` ile sınırlı). Session gerektirmez (sunucu job'ı).
 */
export async function listTopActiveDistIds(limit = 25, days = 30): Promise<number[]> {
  const n = Math.max(1, Math.min(500, Math.floor(limit)));
  const d = Math.max(1, Math.min(400, Math.floor(days)));
  const res = await runReadOnly(
    `SELECT TOP (${n}) f.LNGDISTKOD AS id
     FROM dbo.TBLMSDFATURA f
     INNER JOIN dbo.TBLDIST dist ON dist.LNGKOD = f.LNGDISTKOD AND dist.BYTDURUM = 0
     WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
       AND f.TRHISLEMTARIHI >= DATEADD(day, -${d}, ${sqlNow()})
       AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
     GROUP BY f.LNGDISTKOD
     ORDER BY COUNT(*) DESC`,
    { limit: 600, timeoutMs: 30_000 },
  );
  return res.rows
    .map((r) => Number(r.id))
    .filter((x) => Number.isFinite(x));
}

/**
 * Merkez kullanıcıların (BYTTIP=0) GÖRDÜĞÜ distinct dist-kod kümeleri.
 *
 * Neden gerekli: `resolveTenantScope` merkez için bile `distKods`'u Panorama
 * kümesi olarak döndürür (null=filtresiz DEĞİL). Cockpit/V3 snapshot cache
 * anahtarı bu AÇIK listeye göre kurulur (ör. "d1_4_5..._31"). Gece/manuel warm
 * eğer `allowedDistKods` geçmezse `null`→"all" anahtarını ısıtır ve cockpit'in
 * gerçekte okuduğu "d1_4..." anahtarına HİÇ dokunmaz → AI brief boş kalır,
 * merkez ilk açılışta cache'i ıskalar. Bu fonksiyon warm'ın cockpit ile AYNI
 * anahtarı ısıtmasını sağlar. Aynı dist kümesini paylaşan kullanıcılar imza
 * bazında tek sefer döner (distinct).
 */
export async function listMerkezScopes(): Promise<number[][]> {
  const res = await runReadOnly(
    `SELECT v.LNGKOD AS userId, v.LNGDISTKOD AS distId
       FROM dbo.ERCVIEWTBLKULLANICIDIST_DASHBOARD v
       INNER JOIN dbo.TBLDIST d ON d.LNGKOD = v.LNGDISTKOD AND d.BYTDURUM = 0
       INNER JOIN dbo.TBLKULLANICI u ON u.LNGKOD = v.LNGKOD AND u.BYTDURUM = 0 AND u.BYTTIP = 0
      WHERE v.BYTDURUM = 0`,
    { limit: 100_000, timeoutMs: 30_000 },
  );
  const byUser = new Map<number, Set<number>>();
  for (const r of res.rows) {
    const uid = Number(r.userId);
    const did = Number(r.distId);
    if (!Number.isInteger(uid) || !Number.isInteger(did)) continue;
    const set = byUser.get(uid) ?? new Set<number>();
    set.add(did);
    byUser.set(uid, set);
  }
  const seen = new Set<string>();
  const scopes: number[][] = [];
  for (const set of byUser.values()) {
    const sorted = [...set].sort((a, b) => a - b);
    const sig = sorted.join("_");
    if (sig && !seen.has(sig)) {
      seen.add(sig);
      scopes.push(sorted);
    }
  }
  return scopes;
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
