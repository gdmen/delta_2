import Link from "next/link";
import { isDataDepError, type WidgetData } from "../types";
import { DATA_KEY, type CoachCardData } from "./keys";
import type { CoachCardConfig } from "./schema";

const ENDPOINT_LABEL: Record<string, string> = {
  "suggest-focuses": "Suggested focuses",
  "score-focus": "Scored a focus",
  "validate-goal": "Validated a goal",
  "summarize-session": "Summarized a session",
};

/**
 * "What did the coach do recently?" Reads the latest coach_calls row
 * (metadata only — endpoint, status, target goal, ts). Empty state when
 * the user has never invoked the coach. Status: "ok" renders neutral,
 * "error" renders muted-red so dashboard glance flags failed runs.
 */
export function CoachCardComponent({
  data,
}: {
  config: CoachCardConfig;
  data: WidgetData;
}) {
  const raw = data.get(DATA_KEY);
  const row: CoachCardData | null =
    isDataDepError(raw) || raw === undefined ? null : (raw as CoachCardData | null);

  return (
    <div>
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Coach
        </span>
        {row && (
          <span className="font-mono text-[0.6875rem] text-muted">
            {relative(row.ts)}
          </span>
        )}
      </div>
      {!row ? (
        <p className="text-[0.875rem] text-muted py-2">
          No coach activity yet.
        </p>
      ) : (
        <div className="text-[0.875rem]">
          <div className="flex items-baseline gap-2">
            <span
              className={
                row.status === "ok"
                  ? "text-foreground"
                  : "text-[color:var(--color-status-critical,#b91c1c)]"
              }
            >
              {ENDPOINT_LABEL[row.endpoint] ?? row.endpoint}
            </span>
            {row.goalName && row.goalId !== null && (
              <Link
                href={`/goals/${row.goalId}`}
                className="text-text-secondary hover:text-foreground underline truncate"
              >
                {row.goalName}
              </Link>
            )}
          </div>
          {row.status !== "ok" && (
            <p className="mt-1 font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
              status: {row.status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}
