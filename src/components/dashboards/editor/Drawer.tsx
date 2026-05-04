"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Right-slide drawer on `sm`+ viewports, bottom-sheet on `< sm`.
 * Tailwind's responsive variants pick the orientation; the same component
 * renders both so the call sites don't fork. Backdrop tap closes; Escape
 * closes; backdrop is tinted not opaque to keep the dashboard visible.
 */
export function Drawer({
  ariaLabel,
  width = "24rem",
  onClose,
  children,
}: {
  ariaLabel: string;
  /** Desktop width; mobile is always 100% of viewport. */
  width?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={ariaLabel}
        aria-modal="true"
        className="fixed z-50 bg-background border-border overflow-y-auto
                   inset-x-0 bottom-0 h-[70vh] border-t rounded-t-lg
                   sm:inset-y-0 sm:right-0 sm:bottom-auto sm:left-auto sm:h-full sm:rounded-none sm:border-l sm:border-t-0"
        style={{ width: "100%", maxWidth: width }}
      >
        {/* Mobile drag-handle indicator (purely visual; tap-backdrop / Escape close) */}
        <div className="sm:hidden pt-2 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-border" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-border">
          <h2 className="text-[0.9375rem] font-semibold">{ariaLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-text-tertiary hover:text-foreground -mr-1"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </>
  );
}
