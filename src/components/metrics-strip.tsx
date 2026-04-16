interface MetricCell {
  label: string;
  value: string;
  delta: string;
  status: "up" | "down" | "flat";
}

export function MetricsStrip({ metrics }: { metrics: MetricCell[] }) {
  const statusColor = {
    up: "text-foreground",
    down: "text-accent-orange",
    flat: "text-muted",
  };

  return (
    <div
      className="grid gap-px bg-border border border-border mb-6 grid-cols-3 md:grid-cols-5"
    >
      {metrics.map((m) => (
        <div key={m.label} className="bg-background p-3 overflow-hidden">
          <div className="text-[0.6875rem] text-muted uppercase tracking-wider font-medium truncate">
            {m.label}
          </div>
          <div className="font-mono text-[1.25rem] md:text-[1.375rem] font-medium mt-0.5 truncate">
            {m.value}
          </div>
          <div className={`font-mono text-[0.6875rem] mt-0.5 truncate ${statusColor[m.status]}`}>
            {m.delta}
          </div>
        </div>
      ))}
    </div>
  );
}
