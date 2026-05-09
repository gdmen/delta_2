import Link from "next/link";
import { db } from "@/db";
import { mergeLog } from "@/db/schema";
import { desc } from "drizzle-orm";
import { DataTabShell } from "@/components/data-tab-shell";
import { MergesUndoButton } from "./undo-button";
import { MergesFilterInput } from "./filter-input";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

interface MergeRow {
  id: number;
  kind: "metric_type" | "sport";
  createdAt: string;
  canonicalName: string;
  mergedNames: string;
  undoneAt: string | null;
}

const RELATIVE_FMT = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(isoLike: string): string {
  const d = new Date(isoLike.includes("T") ? isoLike : `${isoLike.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return isoLike;
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return RELATIVE_FMT.format(Math.round(diffMs / 1000), "second");
  if (abs < 3_600_000) return RELATIVE_FMT.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return RELATIVE_FMT.format(Math.round(diffMs / 3_600_000), "hour");
  return RELATIVE_FMT.format(Math.round(diffMs / 86_400_000), "day");
}

/** YYYY-MM-DD bucket of an isoLike timestamp in local time. */
function dayKey(isoLike: string): string {
  const d = new Date(isoLike.includes("T") ? isoLike : `${isoLike.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return isoLike.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  if (key === today) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return "Yesterday";
  return key;
}

export default async function MergesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUserOrSignin();
  const sp = await searchParams;
  const qParam = sp.q?.trim() ?? "";

  const allRows = (await db
    .select({
      id: mergeLog.id,
      kind: mergeLog.kind,
      createdAt: mergeLog.createdAt,
      canonicalName: mergeLog.canonicalName,
      mergedNames: mergeLog.mergedNames,
      undoneAt: mergeLog.undoneAt,
    })
    .from(mergeLog)
    .where(userScope(user.id).mergeLog)
    .orderBy(desc(mergeLog.createdAt))
    .limit(200)) as MergeRow[];

  // Free-text `q` matches anywhere in mergedNames + canonicalName.
  // The Aliases tab and per-metric Aliases section deep-link here with
  // `?q=<alias>` so a substring match against `mergedNames` (which is
  // a comma-joined list of merged-away names) lights up the originating
  // merge.
  let rows = allRows;
  if (qParam) {
    const needle = qParam.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.mergedNames.toLowerCase().includes(needle) ||
        r.canonicalName.toLowerCase().includes(needle),
    );
  }

  // Group by day key. Insertion order preserves desc-by-date order
  // because rows are already sorted.
  const groups = new Map<string, MergeRow[]>();
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return (
    <DataTabShell
      active="merges"
      label="Recent merges"
      count={{
        value: rows.length,
        unit: rows.length === 1 ? "merge" : "merges",
      }}
      description="Recent metric_type and sport merges. Click Undo to reverse one — restores the merged rows + re-points everything that pointed at the canonical back to the original. Chain merges (you merged A→B then B→C) require undoing the more-recent one first."
    >
      <MergesFilterInput initial={qParam} />
      {rows.length === 0 ? (
        <div className="border border-border rounded p-8 text-center">
          {qParam ? (
            <p className="text-[0.875rem] text-text-secondary mb-2">
              No merges match{" "}
              <code className="font-mono bg-surface px-1.5 py-0.5 rounded">
                {qParam}
              </code>
              .
            </p>
          ) : (
            <>
              <p className="text-[0.875rem] text-text-secondary mb-2">
                No merges yet.
              </p>
              <p className="text-[0.8125rem] text-muted">
                When you combine duplicate metric types or sports, they&apos;ll appear here for undo.
              </p>
              <Link
                href="/data/metrics"
                className="inline-block mt-4 text-[0.8125rem] text-foreground underline"
              >
                Go to metric types →
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([key, group], groupIdx) => (
            <section key={key}>
              <div className="text-[0.6875rem] font-mono uppercase tracking-wider text-muted mb-2 sticky top-0 bg-background py-1 -mx-2 px-2">
                {dayLabel(key)}
              </div>
              <div className="border border-border rounded overflow-hidden">
                {group.map((row, i) => {
                  const isHero = groupIdx === 0 && i === 0 && !row.undoneAt;
                  const undone = !!row.undoneAt;
                  return (
                    <div
                      key={row.id}
                      className={`px-4 py-3 flex items-center gap-4 ${
                        i > 0 ? "border-t border-border" : ""
                      } ${isHero ? "bg-surface/40" : ""} ${undone ? "text-muted" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-0.5">
                          {row.kind.replace("_", " ")} ·{" "}
                          {undone
                            ? `Undone ${relativeTime(row.undoneAt!)}`
                            : relativeTime(row.createdAt)}
                        </div>
                        <div className={`text-[0.875rem] truncate ${isHero ? "font-medium" : ""}`}>
                          <span className="font-mono">{row.mergedNames}</span>
                          <span className="text-muted"> → </span>
                          <span className="font-mono">{row.canonicalName}</span>
                        </div>
                      </div>
                      {undone ? (
                        <span className="text-[0.6875rem] font-mono text-muted italic">
                          undone
                        </span>
                      ) : (
                        <MergesUndoButton id={row.id} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </DataTabShell>
  );
}
