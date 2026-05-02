import Link from "next/link";

/**
 * Empty state for a dashboard with zero widgets. Per the design (Pass 7
 * decisions in docs/designs/configurable-dashboards.md): center-positioned,
 * primary-button CTA. PR3 wires the CTA to the widget palette; PR2 ships
 * the disabled-looking inert version with a forward link to settings so
 * the user has somewhere to go (rename, set sport, delete, etc.) instead
 * of staring at a dead page.
 */
export function DashboardEmptyState({ settingsHref }: { settingsHref: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[0.875rem] text-foreground mb-2">This dashboard is empty.</p>
      <p className="text-[0.75rem] text-muted mb-6">
        The widget editor lands in a future update.
      </p>
      <Link
        href={settingsHref}
        className="inline-block px-4 py-2 border border-border rounded text-[0.8125rem] hover:bg-surface"
      >
        Dashboard settings
      </Link>
    </div>
  );
}
