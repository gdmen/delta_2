import { ReactNode } from "react";
import { DataTabs, type DataTab } from "@/app/data/tabs";
import { ImportExportBar } from "@/app/data/import-export-bar";

/**
 * Unified chrome for /data, /data/events, /data/activities, /data/exercises:
 * page header + import/export bar + tab nav + an optional sub-header row
 * (section label + count). Each tab's unique content renders as children.
 */
export function DataTabShell({
  active,
  description = "Every row Delta has stored.",
  label,
  count,
  children,
}: {
  active: DataTab;
  description?: string;
  label?: string;
  count?: { value: number; unit: string };
  children: ReactNode;
}) {
  return (
    <div className="max-w-[1100px]">
      <h1 className="text-2xl font-semibold mb-2">Data</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">{description}</p>

      <div className="mb-8">
        <ImportExportBar />
      </div>

      <DataTabs active={active} />

      {(label || count) && (
        <div
          className={`flex items-baseline ${label ? "justify-between" : "justify-end"} mb-3`}
        >
          {label && (
            <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
              {label}
            </span>
          )}
          {count && (
            <span className="font-mono text-[0.6875rem] text-muted">
              {count.value.toLocaleString()} {count.unit}
            </span>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
