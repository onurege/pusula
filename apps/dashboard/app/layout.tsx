import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/ui/navbar";
import { WeeklyActionsDrawer } from "@/components/weekly-actions/WeeklyActionsDrawer";

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
// dinler. Bu script body'den önce çalıştığı için sayfa renkleri "flash"
// etmez (önce light render olup sonra dark'a dönmez).
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
  return (
    <html lang="tr" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <div className="min-h-dvh">
          <Navbar />
          <main className="mx-auto max-w-[1600px] px-5 py-5">{children}</main>
        </div>
        {/* Demo journey output — sağ alt floating drawer. Tüm sayfalardan
            erişilebilsin diye layout seviyesinde tek seferlik mount. */}
        <WeeklyActionsDrawer />
      </body>
    </html>
  );
}
