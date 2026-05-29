import Link from "next/link";

interface GoalBarProps {
  name: string;
  deadline: string;
  daysLeft: number;
  progress: number;
  actualRate: string;
  requiredRate: string;
  status: "complete" | "on-track" | "behind" | "critical";
  href?: string;
  activityColor?: string;
}

export function GoalBar({
  name,
  deadline,
  daysLeft,
  progress,
  actualRate,
  requiredRate,
  status,
  href,
  activityColor,
}: GoalBarProps) {
  const fillColor = {
    complete: "bg-accent-green",
    "on-track": "bg-foreground",
    behind: "bg-accent-orange",
    critical: "bg-accent-red",
  }[status];

  const textColor = {
    complete: "text-accent-green",
    "on-track": "text-foreground",
    behind: "text-accent-orange",
    critical: "text-accent-red",
  }[status];

  const inner = (
    <>
      <div className="flex justify-between items-baseline mb-[3px] gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {activityColor && (
            <span
              className="w-[6px] h-[6px] rounded-full flex-shrink-0"
              style={{ backgroundColor: activityColor }}
            />
          )}
          <span className="text-[0.8125rem] font-medium truncate">{name}</span>
        </div>
        <span className="font-mono text-[0.6875rem] text-muted whitespace-nowrap">
          {deadline} · {daysLeft}d
        </span>
      </div>
      <div className="h-[3px] bg-surface rounded-[1.5px]">
        <div
          className={`h-full rounded-[1.5px] ${fillColor}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <div className={`font-mono text-[0.6875rem] mt-0.5 ${textColor}`}>
        {status === "complete"
          ? `✓ Complete`
          : status === "on-track"
          ? `On track · ${actualRate}`
          : `${actualRate} actual · ${requiredRate} needed`}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block mb-3.5 -mx-2 px-2 py-1 rounded hover:bg-surface/40 transition-colors"
      >
        {inner}
      </Link>
    );
  }

  return <div className="mb-3.5">{inner}</div>;
}
