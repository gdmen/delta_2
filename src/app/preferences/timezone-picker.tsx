"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * IANA TZ picker. ~600 entries grouped by region (the prefix before the
 * first `/`). A native `<select>` with `<optgroup>` per region is fast,
 * keyboard-navigable, and doesn't need a search box for the volume.
 *
 * Save behavior: PATCH /api/app-settings, then router.refresh() so any
 * server-rendered "today" values on other tabs recompute on next view.
 */
export function TimezonePicker({
  initial,
  all,
  runtimeDefault,
}: {
  initial: string;
  all: string[];
  runtimeDefault: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Group by the IANA prefix (e.g. "America/Los_Angeles" -> "America"),
  // alphabetized within each group. UTC + the standalone "Etc/*" zones
  // get their own bucket at the bottom.
  const groups = useMemo(() => {
    const buckets = new Map<string, string[]>();
    for (const z of all) {
      const prefix = z.includes("/") ? z.split("/")[0] : "Other";
      if (!buckets.has(prefix)) buckets.set(prefix, []);
      buckets.get(prefix)!.push(z);
    }
    for (const list of buckets.values()) list.sort();
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all]);

  const dirty = value !== initial;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/app-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${res.status}).`);
        setBusy(false);
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono bg-background min-w-[280px]"
        >
          {groups.map(([region, zones]) => (
            <optgroup key={region} label={region}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="px-3 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        {savedAt && !dirty && (
          <span className="text-[0.75rem] text-accent-green">
            ✓ Saved
          </span>
        )}
      </div>
      <p className="text-[0.6875rem] font-mono text-muted">
        runtime default: <span className="text-foreground">{runtimeDefault}</span>
        {" · "}
        currently saved: <span className="text-foreground">{initial}</span>
      </p>
      {err && (
        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {err}
        </div>
      )}
    </div>
  );
}
