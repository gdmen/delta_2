import { MaybeLink } from "@/components/maybe-link";
import { isDataDepError, type WidgetData } from "../types";
import type { SessionsListConfig } from "./schema";
import { dataKey, type SessionRow } from "./keys";

export function SessionsListComponent({
  config,
  data,
  shareMode = false,
}: {
  config: SessionsListConfig;
  data: WidgetData;
  shareMode?: boolean;
}) {
  const raw = data.get(dataKey(config));
  const rows: SessionRow[] = isDataDepError(raw) || raw === undefined ? [] : (raw as SessionRow[]);
  const heading = config.activityFilter ? `${config.activityFilter} sessions` : "Recent sessions";

  return (
    <div>
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          {heading}
        </span>
        <span className="font-mono text-[0.6875rem] text-muted">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[0.875rem] text-muted py-2">No sessions yet.</p>
      ) : (
        <ul className="text-[0.8125rem]">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 py-1.5 border-b border-surface last:border-b-0"
            >
              <MaybeLink
                href={shareMode ? undefined : `/data/events/${s.id}`}
                className={`flex items-center gap-2 min-w-0${shareMode ? "" : " hover:text-foreground"}`}
              >
                <span
                  className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.activityColor }}
                />
                <span className="truncate">{s.type}</span>
              </MaybeLink>
              <span className="font-mono text-[0.6875rem] text-muted whitespace-nowrap">
                {s.startedAt.slice(0, 10)}
                {s.durationMinutes !== null ? ` · ${s.durationMinutes}m` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
