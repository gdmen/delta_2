import type { ReactNode } from "react";

/**
 * The CSS Grid container. 12 columns on desktop (sm and up), 1 column
 * below sm. Row height is content-driven via grid-auto-rows: minmax(8rem,
 * auto) — see docs/designs/configurable-dashboards.md "Responsive units"
 * for the no-pixels rationale.
 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-12"
      style={{ gridAutoRows: "minmax(8rem, auto)" }}
    >
      {children}
    </div>
  );
}
