"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Counts {
  metrics: number;
  events: number;
  reconcileLog: number;
}

/**
 * Danger-zone button to remove a custom CSV source completely: the
 * import_sources mapping, the source_settings row, and every
 * metrics/events/reconcile_log entry tagged with this source.
 *
 * Distinct from <WipeSourceButton>, which deletes the data but keeps
 * the source's mapping alive. Use that one to clear out a bad import
 * and re-upload; use this one when you're done with the source for
 * good and want it gone from the sidebar list.
 *
 * On success: navigates back to /data-sources so the deleted source's
 * page doesn't 404 in place.
 */
export function DeleteSourceButton({
  sourceId,
  sourceName,
  sourceTag,
}: {
  sourceId: number;
  sourceName: string;
  sourceTag: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-accent-red/40 text-accent-red text-[0.8125rem] font-medium rounded hover:bg-accent-red/10"
      >
        Delete this source completely
      </button>
      <p className="text-[0.75rem] text-muted mt-2 leading-[1.5]">
        Removes the import mapping AND every metric/event/reconcile-log row
        attached to this source. Source-prefixed metric types
        (<code className="font-mono">{sourceTag}:*</code>) get cleaned up too,
        unless something else still references them (goals, foreign-source
        aliases) — those get listed for manual cleanup.
      </p>

      {/* Modal lives in its own component so its state resets via the
          natural mount/unmount cycle when the user re-opens it. */}
      {open && (
        <DeleteModal
          sourceId={sourceId}
          sourceName={sourceName}
          sourceTag={sourceTag}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

function DeleteModal({
  sourceId,
  sourceName,
  sourceTag,
  onClose,
}: {
  sourceId: number;
  sourceName: string;
  sourceTag: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsErr, setCountsErr] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Fetch counts on mount via the per-source wipe GET (it returns the
  // same per-table counts we want to show). The component is gated on
  // the parent's `open`, so it remounts each time and the effect runs
  // fresh without resetting state synchronously.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/data-sources/wipe?source=${encodeURIComponent(sourceTag)}`,
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
  }, [sourceTag]);

  async function submit() {
    setBusy(true);
    setSubmitErr(null);
    try {
      const res = await fetch(`/api/import-sources/${sourceId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitErr(json.error ?? `Delete failed (${res.status})`);
        setBusy(false);
        return;
      }
      // If any metric_types were kept (because other rows still reference
      // them), surface the list so the user can clean up manually.
      const kept = (json.keptMetricTypes ?? []) as { name: string; reason: string }[];
      if (kept.length > 0) {
        const lines = kept.map((k) => `• ${k.name} — kept (${k.reason})`).join("\n");
        alert(
          `Source deleted, but ${kept.length} metric type${kept.length === 1 ? "" : "s"} couldn't be removed:\n\n${lines}\n\nDelete them individually from /data if you want them gone.`,
        );
      }
      // Source is gone — kick the user back to the list.
      router.push("/data-sources");
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const total = counts ? counts.metrics + counts.events + counts.reconcileLog : 0;
  // For zero-data sources we still allow deletion (the config row alone
  // is enough to want gone), so we just require the name confirmation.
  const canSubmit = confirmText === sourceName && counts !== null && !busy;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}
      aria-modal
      role="dialog"
    >
      <div
        className="bg-background border border-border rounded max-w-md w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[1rem] font-semibold">
          Delete source <code className="font-mono">{sourceName}</code>?
        </h3>

        {countsErr ? (
          <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
            {countsErr}
          </div>
        ) : counts === null ? (
          <div className="text-[0.8125rem] text-muted">Counting rows…</div>
        ) : (
          <>
            <div className="text-[0.8125rem] text-text-secondary leading-[1.55]">
              This will delete:
            </div>
            <ul className="text-[0.8125rem] font-mono space-y-1 ml-1">
              <li>1 import mapping ({sourceName})</li>
              <li>{counts.metrics.toLocaleString()} metrics</li>
              <li>
                {counts.events.toLocaleString()} events (workout sets and
                attached metrics cascade)
              </li>
              <li>{counts.reconcileLog.toLocaleString()} reconcile-log entries</li>
            </ul>
            <p className="text-[0.8125rem] text-text-secondary leading-[1.55]">
              Plus any{" "}
              <code className="font-mono">{sourceTag}:*</code> metric types
              that are now unreferenced. Anything still pinned by a goal or
              cross-source alias is kept and listed after the delete.
            </p>
            <p className="text-[0.8125rem] text-text-secondary leading-[1.55]">
              This cannot be undone. Type{" "}
              <code className="font-mono bg-surface px-1 rounded">{sourceName}</code>{" "}
              to confirm:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono"
              placeholder={sourceName}
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
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1.5 bg-accent-red text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Deleting…" : `Delete source${total > 0 ? " + data" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
