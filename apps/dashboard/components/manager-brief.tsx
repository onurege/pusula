/**
 * Renders the manager brief with structural awareness.
 * Splits on blank lines and tags each block by its leading marker:
 *   - "⚠"  → warning tint (DİKKAT)
 *   - "→"  → accent tint (BUGÜN)
 *   - else → headline / plain
 */
type Tone = "headline" | "warn" | "action" | "plain";

function classify(line: string): Tone {
  const t = line.trim();
  if (t.startsWith("⚠")) return "warn";
  if (t.startsWith("→")) return "action";
  return "headline";
}

function splitBlocks(brief: string): { tone: Tone; lines: string[] }[] {
  const paragraphs = brief.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const blocks: { tone: Tone; lines: string[] }[] = [];
  for (const para of paragraphs) {
    const lines = para.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    // If a paragraph mixes warn / action lines, split per line.
    const allSame = lines.every((l) => classify(l) === classify(lines[0]!));
    if (allSame) {
      blocks.push({ tone: classify(lines[0]!), lines });
    } else {
      for (const l of lines) blocks.push({ tone: classify(l), lines: [l] });
    }
  }
  return blocks;
}

export function ManagerBrief({
  brief,
  date,
}: {
  brief: string;
  date: string;
}) {
  const blocks = splitBlocks(brief);
  const headline = blocks.find((b) => b.tone === "headline");
  const warn = blocks.filter((b) => b.tone === "warn");
  const action = blocks.filter((b) => b.tone === "action");
  // Anything after the first headline that isn't tagged → still useful prose.
  const plain = blocks.filter(
    (b) => b.tone === "headline" && b !== headline,
  );

  return (
    <section className="rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent p-6 lg:p-7 h-full flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[11px] uppercase tracking-wider text-accent font-semibold">
          Yönetici Brifingi
        </div>
        <div className="text-[11px] text-muted tabular-nums">{date}</div>
      </div>

      {headline && (
        <p className="text-[17px] lg:text-[19px] font-medium leading-snug text-fg">
          {headline.lines.join(" ")}
        </p>
      )}

      {plain.map((b, i) => (
        <p key={`p-${i}`} className="text-[14px] leading-relaxed text-fg/90">
          {b.lines.join(" ")}
        </p>
      ))}

      {warn.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-bad font-semibold">
            Dikkat
          </div>
          <ul className="space-y-1.5">
            {warn.flatMap((b) => b.lines).map((line, i) => (
              <li
                key={`w-${i}`}
                className="text-[14px] leading-relaxed text-fg/95 pl-3 border-l-2 border-bad/60"
              >
                {line.replace(/^⚠\s*/, "")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {action.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-good font-semibold">
            Bugün
          </div>
          <ul className="space-y-1.5">
            {action.flatMap((b) => b.lines).map((line, i) => (
              <li
                key={`a-${i}`}
                className="text-[14px] leading-relaxed text-fg/95 pl-3 border-l-2 border-good/60"
              >
                {line.replace(/^→\s*/, "")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
