import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Navbar } from "@/components/ui/navbar";
import { WeeklyActionsDrawer } from "@/components/weekly-actions/WeeklyActionsDrawer";
import { TenantProvider } from "@/components/tenant-provider";
import { getTenantConfig } from "@/lib/tenant";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Enroute Pusula",
  description: "Saha satış için yön bulan AI asistanı — risk, fırsat ve aksiyon, tek yerde.",
};

// Tema bootstrap script — ilk paint öncesi <html data-theme="..."> ayarlar.
// localStorage'da kullanıcı tercihi varsa onu, yoksa OS prefers-color-scheme'i
// dinler. next/script ile beforeInteractive strategy → React hydration
// reconciliation'a girmez, browser extension'lar (Bitdefender bis_use vs.)
// script tag'ini değiştirse bile React mismatch hatası vermez.
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Server tarafı tenant config'ini layout'ta okuyup TenantProvider'a geçir.
  // RSC sınırından plain object olarak geçer; client component'ler `useTenant()`
  // ile bu değeri çeker. Her request'te yeniden okunur (process.env stable).
  const tenant = getTenantConfig();
  return (
    <html lang="tr" className={inter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Theme bootstrap — beforeInteractive: ilk paint öncesi çalışır,
            FOUC olmaz. next/script React tree dışında render eder → DOM
            mutasyonu yapan browser extension'lar hydration error tetiklemez. */}
        <Script
          id="enroute-theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
        <TenantProvider value={tenant}>
          <div className="min-h-dvh">
            <Navbar />
            <main className="mx-auto max-w-[1600px] px-5 py-5">{children}</main>
          </div>
          {/* Demo journey output — sağ alt floating drawer. Tüm sayfalardan
              erişilebilsin diye layout seviyesinde tek seferlik mount. */}
          <WeeklyActionsDrawer />
        </TenantProvider>
      </body>
    </html>
  );
}
