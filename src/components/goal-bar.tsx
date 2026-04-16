interface GoalBarProps {
  name: string;
  deadline: string;
  daysLeft: number;
  progress: number;
  actualRate: string;
  requiredRate: string;
  status: "on-track" | "behind" | "critical";
}

export function GoalBar({ name, deadline, daysLeft, progress, actualRate, requiredRate, status }: GoalBarProps) {
  const fillColor = {
    "on-track": "bg-foreground",
    behind: "bg-accent-orange",
    critical: "bg-accent-red",
  }[status];

  const textColor = {
    "on-track": "text-foreground",
    behind: "text-accent-orange",
    critical: "text-accent-red",
  }[status];

  return (
    <div className="mb-3.5">
      <div className="flex justify-between items-baseline mb-[3px]">
        <span className="text-[13px] font-medium">{name}</span>
        <span className="font-mono text-[11px] text-muted">{deadline} · {daysLeft}d</span>
      </div>
      <div className="h-[3px] bg-surface rounded-[1.5px]">
        <div
          className={`h-full rounded-[1.5px] ${fillColor}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <div className={`font-mono text-[11px] mt-0.5 ${textColor}`}>
        {status === "on-track" ? `On track · ${actualRate}` : `${actualRate} actual · ${requiredRate} needed`}
      </div>
    </div>
  );
}
