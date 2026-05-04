import type { DividerConfig } from "./schema";

/**
 * Section break inside a dashboard. Optional heading; otherwise a plain
 * hairline rule. Useful between thematically distinct widget clusters
 * (e.g. "Recovery" header above metric blocks for sleep/protein/water).
 */
export function DividerComponent({ config }: { config: DividerConfig }) {
  if (!config.heading) {
    return <hr className="border-t border-border my-2" />;
  }
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-2">
      <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
        {config.heading}
      </h2>
    </div>
  );
}
