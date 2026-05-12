import { FocusCard } from "@/components/focus-card";
import { isDataDepError, type WidgetData } from "../types";
import type { FocusListConfig } from "./schema";
import { dataKey, type FocusRow } from "./keys";

export function FocusListComponent({
  config,
  data,
  shareMode = false,
}: {
  config: FocusListConfig;
  data: WidgetData;
  shareMode?: boolean;
}) {
  const raw = data.get(dataKey(config));
  const focuses: FocusRow[] = isDataDepError(raw) || raw === undefined ? [] : (raw as FocusRow[]);
  const heading = config.sportFilter ? `${config.sportFilter} focuses` : "Focuses";

  return (
    <div>
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          {heading}
        </span>
        <span className="font-mono text-[0.6875rem] text-muted">
          {focuses.length} active
        </span>
      </div>
      {focuses.length === 0 ? (
        <p className="text-[0.875rem] text-muted py-2">
          No active focuses. Open a goal to add focuses to it.
        </p>
      ) : (
        focuses.map((f) => (
          <FocusCard
            key={f.id}
            name={f.name}
            sportColor={f.sportColor}
            weekNumber={f.weekNumber}
            sparklineData={[]}
            valueLabel="-"
            href={shareMode ? undefined : `/goals/${f.goalId}`}
          />
        ))
      )}
    </div>
  );
}
