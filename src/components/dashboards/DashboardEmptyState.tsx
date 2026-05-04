import Link from "next/link";

/**
 * Empty state for a dashboard with zero widgets. Per the design (Pass 7
 * decisions in docs/designs/configurable-dashboards.md): center-positioned,
 * primary-button CTA. PR3 wires the CTA to edit mode (which opens the
 * editor where the widget palette lives); the secondary "Dashboard
 * settings" link gives the user a way to rename/sport/delete.
 */
export function DashboardEmptyState({
  editHref,
  settingsHref,
}: {
  editHref: string;
  settingsHref: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[0.875rem] text-foreground mb-2">This dashboard is empty.</p>
      <p className="text-[0.75rem] text-muted mb-6">
        Add your first widget to start tracking.
      </p>
      <div className="flex items-center gap-3">
        <Link
          href={editHref}
          className="inline-block px-4 py-2 bg-foreground text-background rounded text-[0.8125rem] font-medium"
        >
          + Add your first widget
        </Link>
        <Link
          href={settingsHref}
          className="inline-block text-[0.8125rem] text-muted hover:text-foreground"
        >
          Dashboard settings
        </Link>
      </div>
    </div>
  );
}
