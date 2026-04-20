import { MetricTrend } from "@/components/metric-trend";
import type { LiftStats } from "@/lib/strength-metrics";

const LIFT_LABEL: Record<LiftStats["lift"], string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
};

export function BigThree({
  stats,
  sportColor,
}: {
  stats: Record<LiftStats["lift"], LiftStats>;
  sportColor: string;
}) {
  const lifts: LiftStats["lift"][] = ["squat", "bench", "deadlift"];
  return (
    <section>
      <div className="flex items-baseline justify-between mb-4 border-b border-border pb-2">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Big 3
        </h2>
        <span className="font-mono text-[0.6875rem] text-muted">
          estimated 1RM via O&apos;Conner · actual 1-rep PRs
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {lifts.map((lift) => (
          <LiftCard key={lift} stats={stats[lift]} color={sportColor} label={LIFT_LABEL[lift]} />
        ))}
      </div>
    </section>
  );
}

function LiftCard({
  stats,
  color,
  label,
}: {
  stats: LiftStats;
  color: string;
  label: string;
}) {
  const hasData = stats.currentE1RM !== null;

  return (
    <div className="border border-border rounded p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[0.875rem] font-semibold">{label}</span>
        </div>
        {stats.topSet && (
          <span className="font-mono text-[0.6875rem] text-muted">
            {relativeDays(stats.topSet.date)}
          </span>
        )}
      </div>

      {/* Big current-e1RM number */}
      <div>
        {hasData ? (
          <>
            <div className="font-semibold tabular-nums" style={{ fontSize: "1.75rem", lineHeight: 1 }}>
              {stats.currentE1RM}
              <span className="font-normal text-text-secondary text-[0.875rem]"> lb</span>
            </div>
            <div className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mt-1">
              e1RM · estimated
            </div>
          </>
        ) : (
          <div className="text-[0.8125rem] text-muted">No data yet</div>
        )}
      </div>

      {/* Secondary rows */}
      {hasData && (
        <div className="text-[0.75rem] text-text-secondary space-y-1 font-mono">
          {stats.topSet && (
            <div>
              top set:{" "}
              <span className="text-foreground">
                {stats.topSet.weight} × {stats.topSet.reps}
                {stats.topSet.rpe !== null && ` @ ${stats.topSet.rpe}`}
              </span>
            </div>
          )}
          <div>
            1RM PR:{" "}
            <span className="text-foreground">
              {stats.pr1RM ? (
                <>
                  {stats.pr1RM.weight} lb · {stats.pr1RM.date.slice(0, 10)}
                </>
              ) : (
                <span className="text-muted">no 1-rep PR yet</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Trend chart */}
      {stats.history.length >= 2 && (
        <div className="mt-1">
          <div className="font-mono text-[0.625rem] uppercase tracking-wider text-muted mb-1">
            e1RM over time
          </div>
          <MetricTrend
            samples={stats.history.map((h) => ({ date: h.date, value: h.e1rm }))}
            unit="lb"
            color={color}
            height={100}
          />
        </div>
      )}
    </div>
  );
}

function relativeDays(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.round((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
