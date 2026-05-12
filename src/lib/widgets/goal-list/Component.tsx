import Link from "next/link";
import { GoalBar } from "@/components/goal-bar";
import { formatRate } from "@/lib/goal-format";
import { isDataDepError, type WidgetData } from "../types";
import type { GoalListConfig } from "./schema";
import { dataKey, type GoalRow } from "./keys";

export function GoalListComponent({
  config,
  data,
  shareMode = false,
}: {
  config: GoalListConfig;
  data: WidgetData;
  shareMode?: boolean;
}) {
  const raw = data.get(dataKey(config));
  const goals: GoalRow[] = isDataDepError(raw) || raw === undefined ? [] : (raw as GoalRow[]);
  const heading = config.sportFilter ? `${config.sportFilter} goals` : "Goals";

  return (
    <div>
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          {heading}
        </span>
        <span className="font-mono text-[0.6875rem] text-muted">
          {goals.length} active
        </span>
      </div>
      {goals.length === 0 ? (
        <p className="text-[0.875rem] text-muted py-2">
          No goals yet.
          {!shareMode && (
            <>
              {" "}
              <Link href="/input/goal" className="text-foreground underline">
                Create one →
              </Link>
            </>
          )}
        </p>
      ) : (
        goals.map((g) => {
          const p = g.progress;
          const uiStatus: "complete" | "on-track" | "behind" | "critical" =
            p.status === "complete"
              ? "complete"
              : p.status === "on-track"
                ? "on-track"
                : p.status === "behind"
                  ? "behind"
                  : "critical";
          return (
            <GoalBar
              key={g.id}
              name={`${g.metricName} ${g.targetValue}${g.metricUnit}`}
              deadline={g.deadline}
              daysLeft={p.daysRemaining}
              progress={p.progress}
              actualRate={formatRate(p.actualRatePerWeek, g.metricUnit)}
              requiredRate={formatRate(p.requiredRatePerWeek, g.metricUnit)}
              status={uiStatus}
              href={shareMode ? undefined : `/goals/${g.id}`}
              sportColor={g.sportColor}
            />
          );
        })
      )}
    </div>
  );
}
