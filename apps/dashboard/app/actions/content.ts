"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { writeContentMap, getContentMap, type ContentMap } from "@/lib/content";

const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";

/** Token'ı API'ye doğrulatıp admin mi diye bakar (sunucu-otoriter). */
async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = (await cookies()).get("enroute_auth")?.value;
  if (!token) return { ok: false, error: "Oturum gerekli" };
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: "Oturum geçersiz" };
    const d = (await res.json()) as { user?: { isAdmin?: boolean } };
    if (!d?.user?.isAdmin) return { ok: false, error: "Yetki yok (admin gerekli)" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Admin panelinden UI metin override'larını kaydeder. Yalnızca ADMIN yetkili
 * kullanıcı yazabilir. Boş değer gönderilen anahtar silinir (varsayılana
 * döner). Yazım sonrası tüm sayfalar revalidate edilir.
 */
export async function saveContentOverrides(
  patch: Record<string, string | null>,
): Promise<{ ok: true; map: ContentMap } | { ok: false; error: string }> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate;
    const map = writeContentMap(patch);
    // Tüm layout ağacını tazele — override'lar her sayfada okunuyor.
    revalidatePath("/", "layout");
    return { ok: true, map };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Tek anahtarı sıfırla (varsayılana döndür). */
export async function resetContentOverride(
  key: string,
): Promise<{ ok: true; map: ContentMap } | { ok: false; error: string }> {
  return saveContentOverrides({ [key]: null });
}

/** Tüm override'ları sıfırla. */
export async function resetAllContent(): Promise<
  { ok: true; map: ContentMap } | { ok: false; error: string }
> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate;
    const cur = getContentMap();
    const clear: Record<string, string | null> = {};
    for (const k of Object.keys(cur)) clear[k] = null;
    const map = writeContentMap(clear);
    revalidatePath("/", "layout");
    return { ok: true, map };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
