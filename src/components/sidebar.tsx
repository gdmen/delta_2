"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SPORT_COLORS } from "@/lib/sport-colors";

const NAV_SECTIONS = [
  {
    label: "Dashboard",
    items: [
      { href: "/", label: "Home" },
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
    label: "Focuses",
    items: [
      { href: "/focuses", label: "Active" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-[200px] border-r border-border fixed h-screen overflow-y-auto py-5">
      <div className="px-5 pb-5 font-bold text-[15px] tracking-tight">
        Delta 2
      </div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="px-5 pt-4 pb-1 text-[13px] font-semibold text-muted uppercase tracking-wider">
            {section.label}
          </div>
          {section.items.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-5 py-[5px] text-[13px] hover:text-foreground ${
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

      <div className="px-5 pt-4 pb-1 text-[13px] font-semibold text-muted uppercase tracking-wider">
        Quick Add
      </div>
      <Link href="/input/bjj" className="block px-5 py-[5px] text-[13px] text-text-secondary hover:text-foreground">
        + Log BJJ Session
      </Link>
      <Link href="/input/focus" className="block px-5 py-[5px] text-[13px] text-text-secondary hover:text-foreground">
        + New Focus
      </Link>
    </nav>
  );
}
