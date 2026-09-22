/**
 * `/setup` ekranı (Faz A Dalga 2 — boş sunucuda ekrandan kurulum) wire
 * tipleri + fetch yardımcıları.
 *
 * `SETUP_TOKEN_HEADER` `packages/core/src/tenant/setup-mode.ts`'teki AYNI
 * sabit ("x-setup-token") ile BİREBİR — bilerek deep-import DEĞİL, KOPYA
 * (bkz. `app/admin/konfigurator/types.ts` üst yorumundaki AYNI gerekçe):
 * `@enroute/core/tenant` alt-yolu `setup-mode.ts`'i export ETMİYOR (yalnız
 * kök `@enroute/core` barrel'ında — `apps/api/src/setup-gate.ts`'in kendisi
 * de oradan import ediyor); o kök barrel mssql/Gemini/Anthropic client'ları
 * taşıyor — tek bir header adı için içeri çekmek gereksiz coupling olurdu
 * (`next.config.ts`'teki `serverExternalPackages` yorumu: dashboard bilerek
 * yalnız `@enroute/core/tenant`'ı kullanıyor).
 */
export const SETUP_TOKEN_HEADER = "x-setup-token";

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

/** `SetupTenantDefinitionBody` (`apps/api/src/server.ts`) ile BİREBİR —
 *  `id` YOK: server-otoriter, `resolveActiveTenantId()`'den (`process.env.
 *  TENANT`) gelir, kullanıcı hiçbir yerde girmez. */
export type SetupTenantDefinitionInput = {
  displayName: string;
  industry: Industry;
  strategicBrands: string[];
  labels: TenantLabels;
  tax: TaxToggle;
  logoMark?: string;
};

/** POST `/api/setup/tenant` başarı yanıtındaki `config`'in bu ekranda
 *  kullanılan alt kümesi — yalnız `id`'yi (sunucunun atadığı gerçek tenant
 *  id'si) kullanıcıya göstermek için. */
export type SetupTenantSavedConfig = { id: string };

export type SetupMsg = { tone: "good" | "bad"; text: string; loginLink?: boolean };

export type SetupErrorKind = "token" | "inactive" | "generic";

const GENERIC_ERROR = "Beklenmeyen bir hata oluştu — tekrar deneyin.";

function classifySetupError(status: number): SetupErrorKind {
  if (status === 401) return "token";
  if (status === 404) return "inactive";
  return "generic";
}

/** 401 ("token geçersiz") ve 404 ("kurulum bu ortamda artık etkin değil" —
 *  `createSetupGate()`'in H-1 durum-türevli kapanışı, bkz. `setup-mode.ts`)
 *  için AYRI, eyleme-dönük Türkçe metin üretir; diğer hatalarda backend'in
 *  zaten sanitize edilmiş mesajını (varsa) kullanır. */
function setupErrorMsg(kind: SetupErrorKind, serverMessage: string | null): SetupMsg {
  if (kind === "token") {
    return {
      tone: "bad",
      text: serverMessage
        ? `Kurulum token'ı reddedildi: ${serverMessage}`
        : "Kurulum token'ı geçersiz — yukarıdaki alanı kontrol edip tekrar deneyin.",
    };
  }
  if (kind === "inactive") {
    return {
      tone: "bad",
      text: "Kurulum bu ortamda artık etkin değil — muhtemelen az önce tamamlandı.",
      loginLink: true,
    };
  }
  return { tone: "bad", text: serverMessage ?? GENERIC_ERROR };
}

/** `fetch` response'unu `{data, msg, issues}`'a çevirir. `!res.ok`
 *  durumunda 401/404'ü `setupErrorMsg` ile anlamlı metne çevirir; `issues`
 *  yalnız tenant-kimlik ucunda (`TenantValidationError`) dolu gelir, diğer
 *  çağıranlar yok sayar (`app/admin/konfigurator/types.ts` `readJson` ile
 *  AYNI disiplin). */
export async function readSetupResponse<T>(
  res: Response,
): Promise<{ data: T | null; msg: SetupMsg | null; issues: string[] | null }> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const parsed = body as { error?: string; issues?: string[] } | null;
    const issues = Array.isArray(parsed?.issues) ? parsed.issues : null;
    return { data: null, msg: setupErrorMsg(classifySetupError(res.status), parsed?.error ?? null), issues };
  }
  return { data: body as T, msg: null, issues: null };
}

/** Beklenmeyen (ağ/parse) hatalar için — ham hata console'a, kullanıcıya
 *  jenerik mesaj (`friendlyError` ile AYNI disiplin). */
export function setupGenericError(err: unknown): SetupMsg {
  console.error("[insider-setup]", err);
  return { tone: "bad", text: GENERIC_ERROR };
}
