import ReactMarkdown from "react-markdown";

interface JournalEntry {
  id: number;
  content: string;
  createdAt: string;
  verdictFocusId: number | null;
  verdictFocusName?: string | null;
}

/**
 * Reverse-chronological per-goal journal feed. Verdict entries (auto-generated
 * when a focus closes) get a thin sport-color left-accent + 'verdict:' label so
 * they're scannable when reviewing the goal months later.
 *
 * react-markdown defaults are sandboxed against HTML injection — we deliberately
 * do NOT enable rehype-raw or pass any custom renderer that interprets HTML.
 */
export function JournalList({
  entries,
  sportColor,
}: {
  entries: JournalEntry[];
  sportColor: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-[0.875rem] text-muted py-2">
        No entries yet. Write the first one above.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {entries.map((e) => {
        const isVerdict = e.verdictFocusId !== null;
        return (
          <div
            key={e.id}
            className={
              isVerdict
                ? "pl-3 border-l-2"
                : "pl-3 border-l border-surface"
            }
            style={isVerdict ? { borderLeftColor: sportColor } : undefined}
          >
            <div className="flex items-baseline gap-2 text-[0.6875rem] font-mono text-muted mb-1">
              <span className="tabular-nums">{formatTimestamp(e.createdAt)}</span>
              {isVerdict && (
                <span className="uppercase tracking-wider">
                  verdict{e.verdictFocusName ? `: ${e.verdictFocusName}` : ""}
                </span>
              )}
            </div>
            <div className="text-[0.875rem] prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{e.content}</ReactMarkdown>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  // The rest of the app uses YYYY-MM-DD HH:mm for journal-style timestamps.
  // Mono font keeps the columns lined up.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${min}`;
}
