"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import type { DashboardRow } from "@/lib/dashboards/row-types";

interface UserFooterInfo {
  displayName: string;
  isOwner: boolean;
}

function dashboardHref(slug: string): string {
  return `/dashboards/${slug}`;
}

interface SidebarProps {
  dashboards: DashboardRow[];
  user: UserFooterInfo;
}

export function Sidebar({ dashboards, user }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Reset the mobile drawer's open state on route change. React 19's
  // "adjust state during render" pattern (vs. setState inside an effect)
  // — see https://react.dev/learn/you-might-not-need-an-effect.
  const [trackedPath, setTrackedPath] = useState(pathname);
  if (pathname !== trackedPath) {
    setTrackedPath(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <header className="md:hidden fixed top-0 left-0 right-0 h-12 bg-background border-b border-border flex items-center justify-between px-4 z-40">
        <Link
          href="/"
          className="text-[1rem]"
          style={{ fontFamily: "var(--font-wordmark)", fontWeight: 700, letterSpacing: "-0.04em" }}
        >
          Delta
        </Link>
        <button
          onClick={() => setMobileOpen(true)}
          className="w-9 h-9 flex items-center justify-center -mr-2"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="3" y1="6" x2="17" y2="6" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="14" x2="17" y2="14" />
          </svg>
        </button>
      </header>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <nav
        className={`
          fixed top-0 h-screen overflow-y-auto py-5 z-50
          w-[260px] md:w-[200px]
          right-0 md:right-auto md:left-0
          border-l md:border-l-0 md:border-r border-border bg-background
          transition-transform duration-200
          flex flex-col
          ${mobileOpen ? "translate-x-0" : "translate-x-full"}
          md:translate-x-0
        `}
        aria-label="Primary"
      >
        <div className="flex items-center justify-between px-5 pb-5">
          <Link
            href="/"
            className="text-[1.375rem]"
            style={{ fontFamily: "var(--font-wordmark)", fontWeight: 700, letterSpacing: "-0.04em" }}
          >
            Delta
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden w-8 h-8 flex items-center justify-center -mr-1"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>

        <Section label="Home">
          <NavItem href="/home" label="Home" active={pathname === "/home"} />
        </Section>

        <DashboardsSection dashboards={dashboards} pathname={pathname} />

        <Section label="Targets">
          <NavItem href="/goals" label="Goals" active={pathname === "/goals"} />
        </Section>

        <Section label="Settings">
          <NavItem href="/data-sources" label="Sources" active={pathname === "/data-sources"} />
          <NavItem
            href="/data"
            label="Data"
            active={pathname === "/data" || pathname.startsWith("/data/")}
          />
          <NavItem href="/preferences" label="Preferences" active={pathname === "/preferences"} />
          <NavItem
            href="/preferences/account"
            label="Account"
            active={pathname.startsWith("/preferences/account")}
          />
          {user.isOwner && (
            <NavItem
              href="/preferences/invites"
              label="Invites"
              active={pathname.startsWith("/preferences/invites")}
            />
          )}
        </Section>

        <UserFooter user={user} />
      </nav>
    </>
  );
}

function UserFooter({ user }: { user: UserFooterInfo }) {
  const truncated =
    user.displayName.length > 22
      ? `${user.displayName.slice(0, 20)}…`
      : user.displayName;
  return (
    <div className="mt-auto px-5 pt-6 pb-2 border-t border-border text-[0.75rem]">
      <div
        className="text-muted truncate"
        title={user.displayName}
      >
        Signed in as <span className="text-foreground">{truncated}</span>
      </div>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/auth/signout", { method: "POST" });
          window.location.href = "/signin";
        }}
        className="mt-1 text-muted hover:text-foreground underline-offset-2 hover:underline text-left"
      >
        Sign out
      </button>
    </div>
  );
}

function DashboardsSection({
  dashboards,
  pathname,
}: {
  dashboards: DashboardRow[];
  pathname: string;
}) {
  // PR2 doesn't render sport-color dots in this section yet — loadAllDashboards
  // returns the dashboards table only, so we'd need a join with `sports` to
  // resolve the color. Defer until PR3 ships the editor that creates
  // sport-associated dashboards (and surfaces the need).
  return (
    <Section label="Dashboards">
      {dashboards.map((d) => {
        const href = dashboardHref(d.slug);
        // Match the dashboard route AND its settings sub-route.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return <NavItem key={d.id} href={href} label={d.name} active={active} />;
      })}
      <Link
        href="/dashboards/new"
        className="block px-5 py-[5px] text-[0.8125rem] text-muted hover:text-foreground border-t border-border/40 mt-1 pt-2"
      >
        + New dashboard
      </Link>
    </Section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-5 pt-4 pb-1 text-[0.8125rem] font-semibold text-muted uppercase tracking-wider">
        {label}
      </div>
      {children}
    </div>
  );
}

function NavItem({
  href,
  label,
  color,
  active,
}: {
  href: string;
  label: string;
  color?: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block px-5 py-[5px] text-[0.8125rem] hover:text-foreground ${
        active ? "text-foreground font-medium" : "text-text-secondary"
      }`}
    >
      {color && (
        <span
          className="inline-block w-[6px] h-[6px] rounded-full mr-[6px] align-middle"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </Link>
  );
}
