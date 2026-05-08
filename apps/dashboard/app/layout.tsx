import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enroute — DBA Agent",
  description: "Univera verisi üzerinde Türkçe doğal dil ile rapor üret, çalıştır, paylaş.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body suppressHydrationWarning>
        <div className="min-h-dvh">
          <header className="border-b border-border bg-surface/60 backdrop-blur sticky top-0 z-40">
            <div className="mx-auto max-w-[1600px] px-5 h-12 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <div className="size-6 rounded-md bg-accent text-accent-fg font-bold flex items-center justify-center text-sm">E</div>
                <div className="font-semibold tracking-tight">Enroute</div>
                <span className="text-muted text-xs">— DBA Agent</span>
              </Link>
              <nav className="flex items-center gap-5 text-sm text-muted">
                <Link href="/" className="hover:text-fg">Radar</Link>
                <Link href="/reports" className="hover:text-fg">Raporlar</Link>
                <Link href="/reports/new" className="hover:text-fg">Yeni rapor</Link>
                <Link href="/schema" className="hover:text-fg">Şema</Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-[1600px] px-5 py-5">{children}</main>
        </div>
      </body>
    </html>
  );
}
