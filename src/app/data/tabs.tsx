import Link from "next/link";

/**
 * Tab-style navigation for the Data section. Used on /data (metrics tab)
 * and /data/events (events tab). The active tab is derived from the
 * route, so each tab link is an honest Next.js navigation.
 */
export function DataTabs({ active }: { active: "metrics" | "events" }) {
  return (
    <div className="flex gap-0 border-b border-border mb-6">
      <TabLink href="/data" label="Metrics" active={active === "metrics"} />
      <TabLink href="/data/events" label="Events" active={active === "events"} />
    </div>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  const base = "px-4 py-2 text-[0.8125rem] font-medium -mb-px border-b-2";
  return (
    <Link
      href={href}
      className={
        active
          ? `${base} border-foreground text-foreground`
          : `${base} border-transparent text-muted hover:text-foreground`
      }
    >
      {label}
    </Link>
  );
}
