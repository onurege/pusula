import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/ui/navbar";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Enroute — DBA Agent",
  description: "Univera verisi üzerinde Türkçe doğal dil ile rapor üret, çalıştır, paylaş.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={inter.variable}>
      <body suppressHydrationWarning>
        <div className="min-h-dvh">
          <Navbar />
          <main className="mx-auto max-w-[1600px] px-5 py-5">{children}</main>
        </div>
      </body>
    </html>
  );
}
