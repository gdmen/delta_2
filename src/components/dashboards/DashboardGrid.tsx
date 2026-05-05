import type { ReactNode } from "react";

/**
 * The CSS Grid container. 12 columns on desktop (sm and up), 1 column
 * below sm. Row height is fully content-driven via grid-auto-rows: auto.
 *
 * Earlier this set a `minmax(8rem, auto)` floor as a safety against
 * collapsed empty widgets, but that reserved 8rem per gridH unit
 * regardless of content — fine for chart widgets (rem-fixed heights that
 * fill or exceed the floor) but wasteful for content-driven widgets like
 * goal_list, where a 1-goal render at ~7rem in a gridH=3 (24rem) cell
 * left ~17rem of dead space below the list. With `auto`, gridH still
 * spans the requested row tracks but the tracks size to content.
 *
 * Empty-state placeholders self-size via their own padding/min-height
 * (see e.g. metric-block/Component.tsx — border-dashed + p-4 gives a
 * visible ~3rem placeholder regardless of cell size).
 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-12"
      style={{ gridAutoRows: "auto" }}
    >
      {children}
    </div>
  );
}
