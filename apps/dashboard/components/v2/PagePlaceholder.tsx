import { Construction } from "lucide-react";
import { SubTabNav, type SubTab } from "./SubTabNav";

type Props = {
  eyebrow?: string;
  title: string;
  description: string;
  /** Sub-tab listesi varsa render edilir, query param `?tab=` kullanır */
  tabs?: SubTab[];
  defaultTabId?: string;
  /** Bu sekmede taşınacak / eklenecek panellerin özeti — kullanıcıya
   *  "henüz Faz B'de gelecek" hikayesini anlatır */
  comingSoon: string[];
};

/**
 * V2'nin Faz A iskelet sayfası. Her sekme için aynı hissi verir, geride
 * kalan içerik plan'ı listeler. Faz B'de gerçek paneller buraya iner.
 */
export function PagePlaceholder({
  eyebrow,
  title,
  description,
  tabs,
  defaultTabId,
  comingSoon,
}: Props) {
  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {eyebrow && (
            <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-1">
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">{description}</p>
        </div>
        {tabs && defaultTabId && (
          <SubTabNav tabs={tabs} defaultId={defaultTabId} />
        )}
      </header>

      <div className="rounded-xl border border-dashed border-border bg-surface-2/50 p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
            <Construction size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold">İskelet sayfa — Faz A</div>
            <div className="text-[12px] text-muted">
              Bu sekmeye taşınacak / eklenecek paneller aşağıda. Faz B'de
              içerik V1'den buraya kopyalanır.
            </div>
          </div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {comingSoon.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[12.5px] text-fg-2"
            >
              <span className="size-4 rounded-sm bg-accent-soft text-accent text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
