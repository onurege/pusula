/**
 * Kullanıcı yetki store'u — ekran erişimi + şehir-bazlı veri kapsamı.
 *
 * MSSQL salt-okunur olduğu için yetkiler DB'ye yazılamaz → tenant-bazlı bir
 * JSON dosyada tutulur (`<repo>/data/perms.<tenant>.json`). Hem dashboard
 * (admin yazar) hem API (şehir enforcement için okur) erişir; ikisi de aynı
 * repo-kök `data/` klasörünü çözer.
 *
 * Şema: { [username]: { admin?: bool, screens: string[]|null, dists: number[]|null, cities: string[]|null } }
 *   - admin:   içerik + Yetkiler ekranına erişebilir mi (grantable). Bootstrap
 *              admin ADMIN_USERS env'inden (varsayılan ERCYONETICI) gelir; ek
 *              adminler bu bayrakla verilir. Bir admin başka kullanıcıya admin
 *              verebilir (düz model — verilen de aynı işi yapar).
 *   - screens: erişilebilen ekran id'leri; null → hepsi (kısıt yok)
 *   - dists:   görülebilen distribütör kodları (LNGKOD); null → hepsi/oturum-varsayılanı
 *   - cities:  görülebilen şehirler; null → hepsi (kısıt yok) — opsiyonel/dormant
 * Kayıt yoksa kullanıcı kısıtsız + admin-değil — mevcut davranış korunur.
 */
import fs from "node:fs";
import path from "node:path";

export type UserPerm = {
  admin: boolean;
  screens: string[] | null;
  dists: number[] | null;
  cities: string[] | null;
};
export type PermsMap = Record<string, UserPerm>;

let cachedRoot: string | null = null;
/** cwd'den yukarı yürüyerek monorepo kökünü bul (apps + packages içeren dizin). */
function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "apps")) && fs.existsSync(path.join(dir, "packages"))) {
      cachedRoot = dir;
      return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

function permsFilePath(): string {
  const tenant = process.env.TENANT || "default";
  return path.join(repoRoot(), "data", `perms.${tenant}.json`);
}

/** Küçük harfe indirger + boşluk kırpar (username eşleşmesi büyük/küçük duyarsız). */
function normUser(u: string): string {
  return u.trim().toLocaleLowerCase("tr");
}

export function getAllPerms(): PermsMap {
  try {
    const raw = fs.readFileSync(permsFilePath(), "utf8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as PermsMap) : {};
  } catch {
    return {};
  }
}

/** Bir kullanıcının yetkisi — kayıt yoksa kısıtsız (null/null). */
export function getUserPerm(username: string): UserPerm {
  const all = getAllPerms();
  const key = Object.keys(all).find((k) => normUser(k) === normUser(username));
  const p = key ? all[key] : undefined;
  return {
    admin: !!p?.admin,
    screens: p?.screens ?? null,
    dists: p?.dists ?? null,
    cities: p?.cities ?? null,
  };
}

/** ADMIN_USERS env'inden bootstrap admin listesi (varsayılan: ERCYONETICI). */
function adminAllowlist(): string[] {
  const raw = process.env.ADMIN_USERS?.trim();
  return raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : ["ERCYONETICI"];
}

/**
 * Kullanıcı admin mi? Bootstrap allowlist (ADMIN_USERS) VEYA perms store'da
 * admin:true. Sunucu-otoriter — içerik + Yetkiler ekranı bununla gate'lenir.
 */
export function isAdminUser(username: string): boolean {
  if (!username) return false;
  if (adminAllowlist().some((u) => normUser(u) === normUser(username))) return true;
  const all = getAllPerms();
  const key = Object.keys(all).find((k) => normUser(k) === normUser(username));
  return !!(key && all[key]?.admin);
}

/** Yetki yaz (merge). null veya [] → o boyutta kısıt yok/temizle. */
export function setUserPerm(username: string, perm: UserPerm): PermsMap {
  const all = getAllPerms();
  const key = Object.keys(all).find((k) => normUser(k) === normUser(username)) ?? username.trim();
  all[key] = {
    admin: !!perm.admin,
    screens: perm.screens && perm.screens.length ? perm.screens : null,
    dists: perm.dists && perm.dists.length ? perm.dists : null,
    cities: perm.cities && perm.cities.length ? perm.cities : null,
  };
  const p = permsFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(all, null, 2), "utf8");
  return all;
}

/** Kullanıcı kaydını sil (kısıtsıza döner). */
export function deleteUserPerm(username: string): PermsMap {
  const all = getAllPerms();
  const key = Object.keys(all).find((k) => normUser(k) === normUser(username));
  if (key) delete all[key];
  const p = permsFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(all, null, 2), "utf8");
  return all;
}
