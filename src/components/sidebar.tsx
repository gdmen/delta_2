"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { SPORT_COLORS } from "@/lib/sport-colors";

const NAV_SECTIONS = [
  {
    label: "Dashboard",
    items: [
      { href: "/", label: "Today" },
      { href: "/body-comp", label: "Body Comp" },
    ],
  },
  {
    label: "Sports",
    items: Object.entries(SPORT_COLORS).map(([name, color]) => ({
      href: `/sports/${name}`,
      label: name === "bjj" ? "BJJ" : name.charAt(0).toUpperCase() + name.slice(1),
      color,
    })),
  },
  {
    label: "Coach",
    items: [
      { href: "/coach", label: "Briefing" },
      { href: "/coach/chat", label: "Chat" },
    ],
  },
  {
    label: "Targets",
    items: [
      { href: "/goals", label: "Goals" },
      { href: "/focuses", label: "Focuses" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/data-sources", label: "Data Sources" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer open.
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
      {/* Mobile header */}
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

      {/* Backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar: drawer on mobile, fixed on desktop */}
      <nav
        className={`
          fixed top-0 left-0 h-screen overflow-y-auto py-5 z-50
          w-[260px] md:w-[200px]
          border-r border-border bg-background
          transition-transform duration-200
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
        `}
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

        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="px-5 pt-4 pb-1 text-[0.8125rem] font-semibold text-muted uppercase tracking-wider">
              {section.label}
            </div>
            {section.items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-5 py-[5px] text-[0.8125rem] hover:text-foreground ${
                    isActive ? "text-foreground font-medium" : "text-text-secondary"
                  }`}
                >
                  {"color" in item && (
                    <span
                      className="inline-block w-[6px] h-[6px] rounded-full mr-[6px] align-middle"
                      style={{ backgroundColor: item.color }}
                    />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="px-5 pt-4 pb-1 text-[0.8125rem] font-semibold text-muted uppercase tracking-wider">
          Quick Add
        </div>
        <Link href="/input/goal" className="block px-5 py-[5px] text-[0.8125rem] text-text-secondary hover:text-foreground">
          + New Goal
        </Link>
        <Link href="/input/focus" className="block px-5 py-[5px] text-[0.8125rem] text-text-secondary hover:text-foreground">
          + New Focus
        </Link>
        <Link href="/input/bjj" className="block px-5 py-[5px] text-[0.8125rem] text-text-secondary hover:text-foreground">
          + Log BJJ Session
        </Link>
      </nav>
    </>
  );
}
