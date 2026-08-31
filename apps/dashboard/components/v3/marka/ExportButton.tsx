"use client";

import { FileSpreadsheet } from "lucide-react";
import type { MarkaPortfolioRow, TopSkuRow } from "./types";

/**
 * md28 — "Excel'e Aktar" butonu, Marka & SKU sayfası.
 *
 * Tamamen client-side: sayfa zaten server component'te fetch edilmiş
 * `portfolio` + `topSkus` snapshot'ını prop olarak alır, yeniden fetch YOK,
 * yeni API endpoint YOK. Repo'da xlsx/SheetJS kurulu değil (bkz.
 * package.json) — bundle/CSP riski almamak için gerçek .xlsx üretmek yerine
 * UTF-8 BOM'lu, noktalı virgülle ayrılmış CSV üretiyoruz. tr-TR Excel'in
 * varsayılan liste ayracı ";"dir (","ondalık ayracı olarak kullanıldığı
 * için) — bu yüzden hem alan ayracı ";" hem sayı formatı tr-TR (virgüllü
 * ondalık) seçildi; dosya çift tıklamayla Excel'de hatasız açılır.
 */
export function MarkaSkuExportButton({
  portfolio,
  topSkus,
}: {
  portfolio: MarkaPortfolioRow[];
  topSkus: TopSkuRow[];
}) {
  function handleExport() {
    const csv = buildCsv(portfolio, topSkus);
    // BOM: Excel UTF-8 CSV'yi BOM'suz açarsa Türkçe karakterler (ı, ş, ğ, ü)
    // bozuk görünür — bu yüzden dosyanın en başına BOM ekliyoruz.
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `marka-sku-${todayStamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      title="Marka portföyü ve Top SKU tablolarını CSV olarak indir (Excel'de doğrudan açılır)"
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-semibold border bg-surface-2 text-fg-2 border-border transition-colors hover:border-accent/40 hover:text-accent"
    >
      <FileSpreadsheet size={12} />
      Excel&rsquo;e Aktar
    </button>
  );
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** ";", `"`, satır sonu içeren alanları RFC4180 usulü tırnaklar. */
function csvCell(value: string | number): string {
  const s = String(value);
  if (/[;"\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(";");
}

/** tr-TR ondalık virgül + binlik nokta ayracıyla sayı formatlar. */
function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function buildCsv(
  portfolio: MarkaPortfolioRow[],
  topSkus: TopSkuRow[],
): string {
  const lines: string[] = [];

  lines.push(csvRow(["Marka & SKU Performansı — dışa aktarım"]));
  lines.push(
    csvRow([`Oluşturulma`, new Date().toLocaleString("tr-TR")]),
  );
  lines.push("");

  lines.push(csvRow(["MARKA PORTFÖYÜ (son 30 gün net ciro)"]));
  lines.push(
    csvRow([
      "Sıra",
      "Marka",
      "Marka Kodu",
      "Ciro (TL)",
      "Pay (%)",
      "Müşteri Sayısı",
      "Fatura Sayısı",
      "Stratejik Marka",
    ]),
  );
  for (const r of portfolio) {
    const special = r.isOther || r.isTotal;
    lines.push(
      csvRow([
        special ? "" : r.rank,
        r.isTotal ? "TOPLAM" : r.isOther ? "Diğer" : r.marka,
        special ? "" : r.markaKod,
        fmtNum(r.ciro, 2),
        fmtNum(r.payPct, 1),
        fmtNum(r.musteriSayi),
        fmtNum(r.faturaSayisi),
        special ? "" : r.isStratejik ? "Evet" : "Hayır",
      ]),
    );
  }

  lines.push("");
  lines.push(csvRow(["TOP SKU (son 30 gün net ciro)"]));
  lines.push(
    csvRow([
      "Sıra",
      "Ürün Kodu",
      "Ürün Adı",
      "Marka",
      "Ciro (TL)",
      "Miktar",
      "Müşteri Sayısı",
      "Pay (%)",
      "Stratejik Marka",
    ]),
  );
  for (const r of topSkus) {
    const special = r.isOther || r.isTotal;
    lines.push(
      csvRow([
        special ? "" : r.rank,
        special ? "" : r.urunKod,
        r.isTotal ? "TOPLAM" : r.isOther ? "Diğer" : r.ad,
        special ? "" : r.marka,
        fmtNum(r.ciro, 2),
        fmtNum(r.miktar),
        fmtNum(r.musteriSayi),
        fmtNum(r.payPct, 2),
        special ? "" : r.isStratejik ? "Evet" : "Hayır",
      ]),
    );
  }

  return lines.join("\r\n");
}
