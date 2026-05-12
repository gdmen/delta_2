import { GoalBar } from "@/components/goal-bar";
import { formatRate } from "@/lib/goal-format";
import { isDataDepError, type WidgetData } from "../types";
import type { GoalBarConfig } from "./schema";
import { dataKey, type GoalBarData } from "./keys";

export function GoalBarComponent({
  config,
  data,
  shareMode = false,
}: {
  config: GoalBarConfig;
  data: WidgetData;
  shareMode?: boolean;
}) {
  if (!config.goalId) {
    return (
      <div className="border border-border border-dashed rounded p-4 h-full flex items-center justify-center text-center text-[0.875rem] text-muted">
        No goal selected. Open the gear to pick one.
      </div>
    );
  }
  const raw = data.get(dataKey(config));
  // fetchGoal returns null when the goal has been deleted (stale ref).
  // Treat null + missing + errored fetch the same way: typed not-found.
  if (isDataDepError(raw) || raw === undefined || raw === null) {
    return (
      <p className="text-[0.875rem] text-muted py-2">Goal not found.</p>
    );
  }
  const g = raw as GoalBarData;
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
}
