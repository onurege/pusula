import type { TenantConfig } from "./types";
import { PERNOD_CONFIG } from "./configs/pernod";
import { PERNOD_DEMO_CONFIG } from "./configs/pernod-demo";
import { FMCG_DEMO_CONFIG } from "./configs/fmcg-demo";
import { WIETNAUER_CONFIG } from "./configs/wietnauer";
import { getMappingOverride } from "./mapping-store";
import { parseDatabasesEnv } from "./databases";
import { getTenantDefinition, type TenantDefinition } from "./tenant-definition-store";
import {
  resolveCustomerBreakdown,
  resolveProductBreakdown,
  resolveRegionBreakdown,
  type CustomerBreakdownMeta,
  type ProductBreakdownMeta,
  type RegionBreakdownMeta,
} from "./identifier";

export type {
  TenantConfig,
  TenantDatabase,
  Industry,
  VolumeUnit,
  TaxToggle,
  TenantLabels,
  CustomerBreakdownDimension,
  ProductBreakdownDimension,
  RegionBreakdownDimension,
  TenantDimensions,
} from "./types";

import type { TenantDatabase } from "./types";

/**
 * Bilinen tüm tenant config'leri — id ile lookup map'i.
 *
 * Yeni tenant eklemek için:
 *   1. `configs/<isim>.ts` oluştur
 *   2. Buraya import et + map'e ekle
 *   3. `TENANT=<isim>` env var ile aktive et
 */
const REGISTRY: Record<string, TenantConfig> = {
  pernod: PERNOD_CONFIG,
  "pernod-demo": PERNOD_DEMO_CONFIG,
  "fmcg-demo": FMCG_DEMO_CONFIG,
  wietnauer: WIETNAUER_CONFIG,
};

/**
 * Default tenant — `TENANT` env var boşken veya bilinmeyen değerken bu döner.
 *
 * Pernod canlı sistemi etkilenmesin diye explicit olarak Pernod default.
 * Yeni tenant eklendiğinde bu değer asla değişmemeli (geriye uyumluluk).
 */
const DEFAULT_TENANT_ID = "pernod";

let cachedConfig: TenantConfig | null = null;
let cachedEnvValue: string | undefined = undefined;

/**
 * Aktif tenant config'ini döner. `process.env.TENANT` her seferinde okunur
 * (yalnızca değer değişirse cache invalidate edilir — geri kalan çağrılar
 * sabit map lookup).
 *
 * Çözüm sırası (Faz A Dalga 1 — additive fallback, Faz 0 tasarım kararı):
 *   1. `REGISTRY[id]` — derleme-zamanı config, BİRİNCİL. pernod/pernod-demo/
 *      fmcg-demo/wietnauer HER ZAMAN buradan gelir, bu dal DEĞİŞMEDİ →
 *      blast-radius sıfır (mevcut davranış birebir korunur).
 *   2. REGISTRY-miss → `getTenantDefinition(id)` (runtime store, kodsuz
 *      onboarding) — bulunursa `buildTenantFromDefinition` ile tam
 *      `TenantConfig` üretilir.
 *   3. İkisi de yoksa: eskiden burada sessizce Pernod-default'a düşülüyordu
 *      (typo'yu yutup YANLIŞ müşterinin verisini gösterme riski). Faz 0
 *      güvenlik veto şartı #6 (store-miss fail-closed) bunu YASAKLAR — THROW
 *      eder. `TENANT` env'i boş/tanımsızsa `id` zaten `DEFAULT_TENANT_ID`
 *      ("pernod") olur ve REGISTRY'de bulunur — bu throw yalnız GERÇEKTEN
 *      bilinmeyen bir id için tetiklenir, mevcut default-boş-env davranışını
 *      DEĞİŞTİRMEZ.
 */
/**
 * `process.env.TENANT`'ı çözer (boşsa/tanımsızsa `DEFAULT_TENANT_ID`) — THROW
 * ETMEZ, `getTenantConfig()`'in aksine REGISTRY/store'da var olup olmadığına
 * bile bakmaz, yalnız "hangi id" sorusunu yanıtlar. `getTenantConfig()` ve
 * setup modu (`setup-mode.ts`) AYNI çözümleme kuralını kullanır — tek kaynak
 * (Metz DRY), iki yerde ayrı ayrı "TENANT env'i nasıl okunur" mantığı
 * TUTULMAZ (ileride biri güncellenip diğeri unutulursa sessizce ayrışabilirdi).
 */
export function resolveActiveTenantId(): string {
  return process.env.TENANT?.trim() || DEFAULT_TENANT_ID;
}

export function getTenantConfig(): TenantConfig {
  const envValue = process.env.TENANT;
  if (cachedConfig && cachedEnvValue === envValue) return cachedConfig;

  const id = resolveActiveTenantId();
  const registryConfig = REGISTRY[id];

  if (registryConfig) {
    cachedConfig = registryConfig;
  } else {
    const definition = getTenantDefinition(id);
    if (!definition) {
      throw new Error(
        `[tenant] Bilinmeyen TENANT="${envValue}" — ne REGISTRY'de ne tenant-definition store'da ` +
          `("data/tenant-def.${id}.json") bulundu. Yanlış tenant verisi göstermemek için fail-closed ` +
          `durduruldu. Mevcut REGISTRY id'leri: ${Object.keys(REGISTRY).join(", ")}.`,
      );
    }
    cachedConfig = buildTenantFromDefinition(definition);
  }
  cachedEnvValue = envValue;
  return cachedConfig;
}

/**
 * `getTenantConfig()` THROW EDER Mİ diye ÖNCEDEN, yan etkisiz kontrol eder —
 * REGISTRY-miss VE tenant-definition store'da da yoksa `true`. Kendisi ASLA
 * throw etmez (`getTenantDefinition` zaten yoksa/bozuksa sessizce `null`
 * döner) — güvenli setup modunun BOOT-ÇÖKME ÖNLEME kararı (server.ts) ve
 * global "kurulum gerekli" kısa-devresi bunu kullanır: `TENANT=<id>` ile
 * açılışta id ne REGISTRY'de ne store'da varsa, modül-seviyesi bir
 * `getTenantConfig()` çağrısı (ör. `server.ts` `DEMO_DATA` sabiti) import
 * anında THROW edip TÜM sunucuyu çökertirdi — bu fonksiyon o kontrolü
 * exception fırlatmadan ÖNCE yapmayı mümkün kılar.
 */
export function isTenantFullyMissing(): boolean {
  const id = resolveActiveTenantId();
  if (REGISTRY[id]) return false;
  return getTenantDefinition(id) === null;
}

/**
 * Panorama tenant-tanımından (kurulumcunun girdiği minimum alanlar) TAM bir
 * `TenantConfig` üretir — kodsuz onboarding'in çekirdeği (Faz A Dalga 1).
 *
 * Kurulumcu girer: id, displayName, industry, strategicBrands, labels, tax
 * (+ opsiyonel `logoMark` override). Geri kalanı Panorama-varsayılanlarından
 * TÜRETİLİR (Faz 0 raporu "Kapsam — minimum tenant"):
 *   - `productName` = "Insider", `currencySymbol` = "₺"
 *   - `ui` = { defaultLanding:"/v3", hideVersionToggle:true, forceLightTheme:true }
 *     — `configs/wietnauer.ts` ile BİREBİR aynı (Panorama tek-sürüm ürünü).
 *   - `mssqlEnvPrefix` = `<ID>_MSSQL_` (tire → alt çizgi; env var adları
 *     tire kabul etmez), `sqliteFileName` = `<id>.sqlite`.
 *   - `logoMark` = id'nin ilk 2 harfi (büyük harf) — kurulumcu override edebilir.
 *   - `volume` = kapalı toggle (`showInToggle:false`, `divisor:1`) — Faz 0
 *     "volume kapalı" kararı; alan boş bırakılmaz (KPI etiketinde HER ZAMAN
 *     kullanılır, `komuta.ts` `volShort`, toggle görünürlüğünden bağımsız).
 *
 * `dimensions`/`brandTable`/`distRegionTable`/`customerEkGrupLink` Pernod
 * konvansiyonuna varsayılanlanır — bu İCAT EDİLMİŞ bir değer DEĞİL,
 * `types.ts`'in kendisinin zaten "tanımsızsa" fallback'ı olarak belgelediği
 * konvansiyon (bkz. `distRegionTable` dokümantasyonu: "Tanımsızsa
 * TBLDISTGRUP/TXTGRUP (Pernod default)"). Faz 0 S1 ("Allowlist kapsamı") bu
 * dalgada NETLEŞMEDİ — yeni Panorama müşterisinin gerçek tablo adları canlı
 * şemada probe edilmedi. Kurulum SONRASI admin panel (mevcut Dalga 2
 * `/api/admin/config/{customer,product,region}-breakdown` uçları, HİÇBİR kod
 * değişikliği olmadan, HERHANGİ bir tenant id için zaten çalışır) bu üç
 * boyutu gerçek şemaya göre değiştirebilir — "kodsuz" iddiası bu ikinci
 * adımla tamamlanır.
 */
/**
 * Aktif tenant'ın ETKİN çok-DB listesi. Kaynak sırası (additive fallback,
 * konfigüratörün diğer alanlarıyla AYNI felsefe):
 *   1. Şifreli store override (`databases-config.ts` `saveDatabasesOverride`) —
 *      admin konfigüratörden KODSUZ yönetilir; VARSA birincil.
 *   2. YOKSA — `${ID}_DATABASES` env fallback (`buildTenantFromDefinition`
 *      derleme-zamanı okur, `getTenantConfig().databases`).
 * Her iki kaynakta da yalnız ≥2 eleman çok-DB'yi aktive eder; aksi halde
 * `undefined` (tek-DB, login'de seçici çıkmaz, davranış birebir korunur).
 */
function getEffectiveDatabases(): TenantDatabase[] | undefined {
  const stored = getMappingOverride(resolveActiveTenantId())?.databases;
  const source = stored && stored.length > 0 ? stored : getTenantConfig().databases;
  return source && source.length >= 2 ? source : undefined;
}

/**
 * Aktif tenant'ın login'de seçilebilir veritabanları (yalnız id+label — ham
 * `database` adı UNAUTHENTICATED endpoint'e sızmaz). Tek-DB tenant'ta boş dizi
 * döner (dashboard dropdown'u gizler).
 */
export function listSelectableDatabases(): Array<{ id: string; label: string }> {
  const dbs = getEffectiveDatabases();
  if (!dbs) return [];
  return dbs.map((d) => ({ id: d.id, label: d.label }));
}

/**
 * Seçili dbId'yi gerçek MSSQL `database` adına çevirir — SQL'e/bağlantıya giden
 * tek kapı, allowlist'e karşı fail-closed:
 *   - tenant çok-DB DEĞİLSE → `null` (çağıran env/store `database`'ini kullanır,
 *     bugünkü davranış birebir).
 *   - çok-DB + `dbId` boş → ilk (varsayılan) DB'nin adı (bağlam olmayan
 *     warm/job yolları için deterministik).
 *   - çok-DB + tanımlı `dbId` → eşleşen `database`.
 *   - çok-DB + TANIMSIZ `dbId` → THROW (istekten gelen bilinmeyen değer sessizce
 *     yanlış/keyfi bir DB'ye düşemez).
 */
export function resolveDatabaseName(dbId: string | null | undefined): string | null {
  const dbs = getEffectiveDatabases();
  const first = dbs?.[0];
  if (!dbs || !first) return null;
  if (!dbId) return first.database;
  const found = dbs.find((d) => d.id === dbId);
  if (!found) {
    throw new Error(`[tenant] Bilinmeyen dbId="${dbId}" — bu tenant'ta tanımlı değil (fail-closed).`);
  }
  return found.database;
}

export function buildTenantFromDefinition(def: TenantDefinition): TenantConfig {
  const id = def.id;
  const envPrefix = `${id.toUpperCase().replace(/-/g, "_")}_MSSQL_`;

  return {
    id,
    displayName: def.displayName,
    industry: def.industry,
    logoMark: def.logoMark?.trim() || id.slice(0, 2).toUpperCase(),
    productName: "Insider",

    sqliteFileName: `${id}.sqlite`,
    mssqlEnvPrefix: envPrefix,

    volume: {
      key: "unit",
      short: "birim",
      longLabel: "Hacim",
      hint: "Hacim birimi — kurulum sonrası admin panelden özelleştirilebilir.",
      showInToggle: false,
      divisor: 1,
    },
    tax: def.tax,
    currencySymbol: "₺",

    labels: def.labels,

    ui: {
      defaultLanding: "/v3",
      hideVersionToggle: true,
      forceLightTheme: true,
    },

    // Panorama-default (Pernod konvansiyonu) — bkz. dosya-üstü fonksiyon notu.
    brandTable: "TBLURUNEKGRUP",
    brandJoinColumn: "TXTURUNEKGRUPKOD",
    distRegionTable: "TBLDISTGRUP",
    distRegionColumn: "TXTGRUP",

    strategicBrands: def.strategicBrands,

    // Çok-DB seçici (ör. Reckitt Core / ESSHOME) — `${ID}_DATABASES` env'inden.
    // Tanımsızsa undefined → tek-DB (regresyon-sıfır).
    databases: parseDatabasesEnv(id),

    dimensions: {
      customerBreakdown: {
        table: "TBLMUSTERIGRUPKIRILIM",
        joinColumn: "TXTGRUPKIRILIMKOD",
        labelColumn: "TXTAD",
      },
      productBreakdown: {
        table: "TBLURUNEKGRUP",
        joinColumn: "TXTURUNEKGRUPKOD",
        labelColumn: "TXTAD",
      },
      regionBreakdown: {
        table: "TBLDISTGRUP",
        joinColumn: "TXTGRUP",
        labelColumn: "TXTAD",
      },
    },
  };
}

/**
 * Cache'i sıfırla — test runner'da TENANT'ı runtime'da değiştirmek için.
 * Production'da gerekmez (env var process boyunca sabittir).
 */
export function clearTenantCache(): void {
  cachedConfig = null;
  cachedEnvValue = undefined;
}

/**
 * Kayıtlı tüm tenant id'lerini listele — runtime tenant switcher (Faz 3)
 * dropdown'unda kullanılır.
 */
export function listTenantIds(): string[] {
  return Object.keys(REGISTRY);
}

/**
 * Aktif tenant config'i + varsa runtime override katmanı (Faz A:
 * `dimensions.customerBreakdown`; Faz B `productBreakdown`/`regionBreakdown`
 * ekledi — DB creds ayrı bir katman, `db-connection-config.ts`).
 *
 * Override yoksa/okunamıyorsa `getTenantConfig()` ile BİREBİR AYNI sonucu
 * döner — sıfır regresyon (Faz 0 davranış-koruma şartı). Override disk'ten
 * `getTenantConfig()`'in aksine HER ÇAĞRIDA okunur; mapping değişimi az
 * sıklıkta olduğu için bu I/O kabul edilebilir (cache Faz 2'de eklenebilir).
 *
 * Ham override burada henüz doğrulanmaz — SQL'e giden değer yalnız
 * `getCustomerBreakdownMeta()`/`getProductBreakdownMeta()`/
 * `getRegionBreakdownMeta()` üzerinden `resolveIdentifier`'dan geçtikten
 * sonra kullanılmalı.
 */
export function getMappingConfig(): TenantConfig {
  const base = getTenantConfig();
  const override = getMappingOverride(base.id);
  const customerBreakdown = override?.dimensions?.customerBreakdown;
  const productBreakdown = override?.dimensions?.productBreakdown;
  const regionBreakdown = override?.dimensions?.regionBreakdown;
  if (!customerBreakdown && !productBreakdown && !regionBreakdown) return base;
  return {
    ...base,
    dimensions: {
      ...base.dimensions,
      ...(customerBreakdown ? { customerBreakdown } : null),
      ...(productBreakdown ? { productBreakdown } : null),
      ...(regionBreakdown ? { regionBreakdown } : null),
    },
  };
}

/**
 * Müşteri kırılımı boyutunun DOĞRULANMIŞ tablo/kolon adları. Bu, Faz 0
 * C1 CRITICAL injection savunmasının SQL'e giden tek kapısıdır — her fetcher
 * (`komuta.ts`, `wietnauer-*.ts`) tabloyu/kolonu doğrudan config'ten değil,
 * bu fonksiyondan almalı.
 *
 * Geçersiz bir override (regex/allowlist dışı) THROW eder — fail-closed;
 * sessizce default'a düşmez (bir curator hatasını gizlemek C1'in savunmasını
 * boşa çıkarır).
 */
export function getCustomerBreakdownMeta(): CustomerBreakdownMeta {
  return resolveCustomerBreakdown(getMappingConfig().dimensions.customerBreakdown);
}

/**
 * Ürün/marka kırılımı boyutunun DOĞRULANMIŞ tablo/kolon adları — Faz B öncesi
 * `tenant.brandTable`/`brandJoinColumn`'ın SQL'e giden TEK kapısı. Her
 * fetcher (`komuta.ts`, `wietnauer-{marka,segment,aktivasyon,stok,metrics,
 * iskonto}.ts`) tabloyu/kolonu doğrudan `getTenantConfig().brandTable`'dan
 * değil, bu fonksiyondan almalı — aksi halde admin panel override'ı o sink'te
 * etkisiz kalır VE C1 fail-closed garantisi o sink'te delinmiş olur.
 */
export function getProductBreakdownMeta(): ProductBreakdownMeta {
  return resolveProductBreakdown(getMappingConfig().dimensions.productBreakdown);
}

/**
 * Bölge kırılımı boyutunun DOĞRULANMIŞ tablo/kolon adları — Faz B öncesi
 * `tenant.distRegionTable`/`distRegionColumn`'ın SQL'e giden TEK kapısı. Her
 * fetcher (`komuta.ts`, `wietnauer-{saha,stok}.ts`) tabloyu/kolonu doğrudan
 * `getTenantConfig().distRegionTable`'dan değil, bu fonksiyondan almalı.
 */
export function getRegionBreakdownMeta(): RegionBreakdownMeta {
  return resolveRegionBreakdown(getMappingConfig().dimensions.regionBreakdown);
}
