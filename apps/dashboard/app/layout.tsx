import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import { Navbar } from "@/components/ui/navbar";
import { WeeklyActionsDrawer } from "@/components/weekly-actions/WeeklyActionsDrawer";
import { TenantProvider } from "@/components/tenant-provider";
import { AuthProvider } from "@/components/auth/auth-context";
import { ScreenGuard } from "@/components/auth/ScreenGuard";
import { ContentProvider } from "@/components/content-provider";
import { LocaleProvider } from "@/components/locale/LocaleProvider";
import { getTenantConfig, isTenantFullyMissing } from "@/lib/tenant";
import { getContentMap } from "@/lib/content";
import { getLocale } from "@/lib/i18n";
import { PATHNAME_HEADER } from "@/lib/request-pathname";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Insider",
  description: "Saha satış için yön bulan AI asistanı — risk, fırsat ve aksiyon, tek yerde.",
};

// Tema bootstrap script — ilk paint öncesi <html data-theme="..."> ayarlar.
// localStorage'da kullanıcı tercihi varsa onu, yoksa OS prefers-color-scheme'i
// dinler. <head> içinde düz <script> tag — SSR'da inline render edilir,
// browser parse ederken çalışır (Next 16 / React 19 next/script
// `beforeInteractive` artık React tree'de uyumlu değil).
//
// Hydration güvenliği: <body suppressHydrationWarning> aşağıda — browser
// extension'lar (Bitdefender bis_use vs.) body'yi değiştirse bile React
// patlamaz. <head> içindeki script, React hydrate etmediği için zaten güvenli.
const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('enroute:theme');
    if (t !== 'dark' && t !== 'light') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

// Light-only tenant (ör. Wietnauer): localStorage/OS tercihini yok say, her
// zaman "light" uygula. Tema butonu navbar'da zaten gizli.
const THEME_FORCE_LIGHT_SCRIPT = `document.documentElement.setAttribute('data-theme','light');`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Faz A Dalga 2 — GÜVENLİ SETUP MODU (boot-çökme önleme). Boş sunucuda
  // `TENANT=<yeni>` ile açılışta bu id için ne REGISTRY'de ne tenant-
  // definition store'da bir tanım varsa, aşağıdaki `getTenantConfig()`
  // THROW eder (`packages/core/src/tenant/index.ts`) — kök layout TÜM
  // sayfaları sardığı için korumasız bir çağrı `/setup`'ın KENDİSİNİ de
  // ayağa kaldıramadan tüm dashboard'u çökertirdi (tavuk-yumurta).
  // `isTenantFullyMissing()` bu kontrolü THROW ETMEDEN önce yapar.
  //
  // Mevcut tenant'larda (pernod/wietnauer — REGISTRY'de) bu kontrol her
  // zaman `false` döner ve fs'e bile dokunmaz (`REGISTRY[id]` bulunur) —
  // davranış BİREBİR korunur, aşağıdaki blok hiç çalışmaz (regresyon sıfır).
  // Locale — tenant/setup durumundan bağımsız, yalnız cookie'ye bakar; her
  // iki dalda da `<html lang>` doğru değeri alsın diye üstte tek sefer okunur.
  const locale = await getLocale();

  if (isTenantFullyMissing()) {
    // Hangi sayfa istendiğini bilmeden `/setup` DIŞINDAKİ her şeyi oraya
    // yönlendiremeyiz — Server Component'ler pathname'i doğrudan görmez,
    // `middleware.ts`'in enjekte ettiği header'dan okunur (bkz.
    // `lib/request-pathname.ts` üst yorumu).
    const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
    if (pathname !== "/setup") {
      redirect("/setup");
    }
    // Minimal kabuk — tenant/içerik/oturum altyapısı henüz YOK (Navbar/
    // AuthProvider/ScreenGuard/ContentProvider tümü gerçek bir tenant
    // config'i varsayar). Yalnız `/setup` sayfası bu dalda render edilir;
    // tema bootstrap script'i tenant'tan bağımsız (OS/localStorage tercihi)
    // — normal davranışla tutarlı bir ilk görünüm için korunur.
    return (
      <html lang={locale} className={inter.variable} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        </head>
        <body suppressHydrationWarning>{children}</body>
      </html>
    );
  }

  // Server tarafı tenant config'ini layout'ta okuyup TenantProvider'a geçir.
  // RSC sınırından plain object olarak geçer; client component'ler `useTenant()`
  // ile bu değeri çeker. Her request'te yeniden okunur (process.env stable).
  const tenant = getTenantConfig();
  const contentMap = getContentMap();
  const themeBootstrap = tenant.ui?.forceLightTheme
    ? THEME_FORCE_LIGHT_SCRIPT
    : THEME_BOOTSTRAP_SCRIPT;
  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Theme bootstrap: <head> içinde inline script — browser parse ederken
            ilk paint öncesi çalışır, FOUC olmaz. React tree'nin dışında
            (hydration ile alakasız). */}
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
      </head>
      <body suppressHydrationWarning>
        <LocaleProvider initialLocale={locale}>
          <TenantProvider value={tenant}>
            <ContentProvider map={contentMap}>
              <AuthProvider>
                <ScreenGuard />
                <div className="min-h-dvh">
                  <Navbar />
                  <main className="mx-auto max-w-[1600px] px-5 py-5">{children}</main>
                </div>
                {/* Demo journey output — sağ alt floating drawer. Tüm sayfalardan
                    erişilebilsin diye layout seviyesinde tek seferlik mount. */}
                <WeeklyActionsDrawer />
              </AuthProvider>
            </ContentProvider>
          </TenantProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
