"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Counts {
  metrics: number;
  events: number;
  reconcileLog: number;
}

/**
 * Danger-zone footer block for source pages. Renders a "Delete all data
 * from this source" button; clicking opens a modal that
 *   - fetches per-table counts so the user knows the blast radius
 *   - requires the user to type the source key as confirmation
 *
 * On success: refreshes the route so the data browser empties out.
 *
 * Pure UI; the wiping itself happens in /api/data-sources/wipe.
 */
export function WipeSourceButton({ source }: { source: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsErr, setCountsErr] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Fetch counts on modal open. Re-fetch every open so stale numbers
  // don't trick a user who imported more data since their last visit.
  useEffect(() => {
    if (!open) return;
    setCounts(null);
    setCountsErr(null);
    setConfirmText("");
    setSubmitErr(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/data-sources/wipe?source=${encodeURIComponent(source)}`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setCountsErr(json.error ?? `Failed to fetch counts (${res.status})`);
          return;
        }
        setCounts(json.counts as Counts);
      } catch (err) {
        if (cancelled) return;
        setCountsErr(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, source]);

  async function submit() {
    setBusy(true);
    setSubmitErr(null);
    try {
      const res = await fetch("/api/data-sources/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, confirm: confirmText }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitErr(json.error ?? `Wipe failed (${res.status})`);
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const total = counts ? counts.metrics + counts.events + counts.reconcileLog : 0;
  const canSubmit = confirmText === source && counts !== null && total > 0 && !busy;

  return (
    <section className="mt-10 pt-6 border-t border-border">
      <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-accent-red mb-2">
        Danger zone
      </h2>
      <p className="text-[0.8125rem] text-text-secondary mb-3 leading-[1.55]">
        Permanently delete every metric, event, and reconcile-log entry that
        came from this source. Use before re-importing under a different schema,
        or to start fresh after a misconfigured import. Other sources&apos; data
        is unaffected.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-accent-red/40 text-accent-red text-[0.8125rem] font-medium rounded hover:bg-accent-red/10"
      >
        Delete all data from this source
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
          aria-modal
          role="dialog"
        >
          <div
            className="bg-background border border-border rounded max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[1rem] font-semibold">
              Delete data from <code className="font-mono">{source}</code>?
            </h3>

            {countsErr ? (
              <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
                {countsErr}
              </div>
            ) : counts === null ? (
              <div className="text-[0.8125rem] text-muted">Counting rows…</div>
            ) : total === 0 ? (
              <div className="text-[0.8125rem] text-muted">
                No rows to delete. This source has no imported data right now.
              </div>
            ) : (
              <>
                <div className="text-[0.8125rem] text-text-secondary leading-[1.55]">
                  This will delete:
                </div>
                <ul className="text-[0.8125rem] font-mono space-y-1 ml-1">
                  <li>{counts.metrics.toLocaleString()} metrics</li>
                  <li>
                    {counts.events.toLocaleString()} events (workout sets and
                    attached metrics cascade)
                  </li>
                  <li>{counts.reconcileLog.toLocaleString()} reconcile-log entries</li>
                </ul>
                <p className="text-[0.8125rem] text-text-secondary leading-[1.55]">
                  This cannot be undone. Type{" "}
                  <code className="font-mono bg-surface px-1 rounded">{source}</code>{" "}
                  to confirm:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoFocus
                  className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono"
                  placeholder={source}
                />
                {submitErr && (
                  <div className="p-2 bg-accent-red/10 border border-accent-red/20 rounded text-[0.75rem] text-accent-red">
                    {submitErr}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              {total > 0 && (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="px-3 py-1.5 bg-accent-red text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
