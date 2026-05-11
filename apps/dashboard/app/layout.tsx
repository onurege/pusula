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
  title: "Enroute Pusula",
  description: "Saha satış için yön bulan AI asistanı — risk, fırsat ve aksiyon, tek yerde.",
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
