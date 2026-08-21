import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/ui/navbar";
import { WeeklyActionsDrawer } from "@/components/weekly-actions/WeeklyActionsDrawer";
import { TenantProvider } from "@/components/tenant-provider";
import { AuthProvider } from "@/components/auth/auth-context";
import { getTenantConfig } from "@/lib/tenant";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Server tarafı tenant config'ini layout'ta okuyup TenantProvider'a geçir.
  // RSC sınırından plain object olarak geçer; client component'ler `useTenant()`
  // ile bu değeri çeker. Her request'te yeniden okunur (process.env stable).
  const tenant = getTenantConfig();
  const themeBootstrap = tenant.ui?.forceLightTheme
    ? THEME_FORCE_LIGHT_SCRIPT
    : THEME_BOOTSTRAP_SCRIPT;
  return (
    <html lang="tr" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Theme bootstrap: <head> içinde inline script — browser parse ederken
            ilk paint öncesi çalışır, FOUC olmaz. React tree'nin dışında
            (hydration ile alakasız). */}
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
      </head>
      <body suppressHydrationWarning>
        <TenantProvider value={tenant}>
          <AuthProvider>
            <div className="min-h-dvh">
              <Navbar />
              <main className="mx-auto max-w-[1600px] px-5 py-5">{children}</main>
            </div>
            {/* Demo journey output — sağ alt floating drawer. Tüm sayfalardan
                erişilebilsin diye layout seviyesinde tek seferlik mount. */}
            <WeeklyActionsDrawer />
          </AuthProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
