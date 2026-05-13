"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Unmerge action button on a composite event detail page. POSTs to
 * /api/events/[id]/unmerge — server flips members back to visible,
 * adds the pair to the denylist (so re-detection won't re-flag), and
 * deletes the composite. Client navigates back to the events list.
 */
export function UnmergeButton({ compositeId }: { compositeId: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!confirm("Unmerge this composite? The source events will be visible again and won't re-flag as duplicates.")) {
      return;
    }
    setRunning(true);
    setErr(null);
    const res = await fetch(`/api/events/${compositeId}/unmerge`, {
      method: "POST",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `HTTP ${res.status}`);
      setRunning(false);
      return;
    }
    router.push("/data/events");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-accent-red border border-border rounded disabled:opacity-50"
      >
        {running ? "Unmerging…" : "Unmerge"}
      </button>
      {err && <span className="text-[0.8125rem] text-accent-red">{err}</span>}
    </div>
  );
}
