/**
 * Determinate progress bar. Pass `value` and `max` for a known total;
 * the fill animates smoothly when `value` updates.
 *
 * No indeterminate / "pulsing" state — callers that don't know the
 * total should render a spinner instead.
 */
export function ProgressBar({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={`h-2 bg-surface rounded overflow-hidden ${className ?? ""}`}
    >
      <div
        className="h-full bg-foreground transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
