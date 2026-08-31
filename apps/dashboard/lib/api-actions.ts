"use server";

// Client bileşenlerinden çağrılan veri fonksiyonları için Server Action köprüsü.
//
// SORUN: lib/api.ts `request()` auth cookie'sini `next/headers` ile okuyup
// Hono API'ye `Authorization: Bearer` olarak iletir. Bir "use client" bileşen
// bu fonksiyonları DOĞRUDAN çağırırsa kod tarayıcıda çalışır; orada
// `next/headers` yoktur → token null → API guard 401 "oturum gerekli" döner.
// Ayrıca tarayıcıdan `http://localhost:8080`'e (API 127.0.0.1'e bind) erişilemez.
//
// ÇÖZÜM: Bu dosya `"use server"` — buradaki export'lar Server Action'dır,
// SUNUCUDA çalışır. Böylece cookie okunur, Bearer iletilir ve sunucu-otoriter
// dist scope uygulanır. Client bileşenler api.ts yerine bu modülü import eder.
import * as api from "./api";

export async function getCustomerSales(
  ...args: Parameters<typeof api.getCustomerSales>
): ReturnType<typeof api.getCustomerSales> {
  return api.getCustomerSales(...args);
}

export async function getCustomerForesight(
  ...args: Parameters<typeof api.getCustomerForesight>
): ReturnType<typeof api.getCustomerForesight> {
  return api.getCustomerForesight(...args);
}

export async function explainOnRadar(
  ...args: Parameters<typeof api.explainOnRadar>
): ReturnType<typeof api.explainOnRadar> {
  return api.explainOnRadar(...args);
}

export async function runRadarApi(
  ...args: Parameters<typeof api.runRadarApi>
): ReturnType<typeof api.runRadarApi> {
  return api.runRadarApi(...args);
}

export async function triggerMapSync(
  ...args: Parameters<typeof api.triggerMapSync>
): ReturnType<typeof api.triggerMapSync> {
  return api.triggerMapSync(...args);
}
