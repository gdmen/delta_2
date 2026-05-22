"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Member {
  id: number;
  label: string;
}

/**
 * Unmerge action on a composite event. POSTs to
 * /api/events/[id]/unmerge — server flips members back to visible, adds
 * the pair to the denylist, and deletes the composite.
 *
 * If the composite has journal entries, they'd be cascade-deleted with
 * the composite. So when journalCount > 0 we first show a checklist of
 * member events (all checked by default) and copy the composite's notes
 * onto the checked members before tearing down. Notes written directly
 * on member events are untouched. Issue #19.
 */
export function UnmergeButton({
  compositeId,
  journalCount = 0,
  members = [],
}: {
  compositeId: number;
  journalCount?: number;
  members?: Member[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Live journal count, fetched on click. Seeded from the server-rendered
  // prop so the button label is right on first paint, but the click path
  // never trusts it — a note added this session would make the prop stale,
  // and trusting it would silently destroy notes on unmerge.
  const [liveCount, setLiveCount] = useState(journalCount);
  // member id → receive a copy of the composite's notes (default all on)
  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(members.map((m) => [m.id, true])),
  );

  async function doUnmerge(copyJournalToEventIds: number[]) {
    setRunning(true);
    setErr(null);
    const res = await fetch(`/api/events/${compositeId}/unmerge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ copyJournalToEventIds }),
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

  async function onClick() {
    setErr(null);
    // Fetch the LIVE journal count — never trust the (possibly stale)
    // server-rendered prop. A note added in this session must still
    // trigger the copy-to-members dialog.
    let count = journalCount;
    if (members.length > 0) {
      setRunning(true);
      try {
        const res = await fetch(`/api/events/${compositeId}/journal`);
        if (res.ok) {
          const entries = (await res.json()) as unknown[];
          count = Array.isArray(entries) ? entries.length : journalCount;
        }
      } catch {
        // Network hiccup — fall back to the prop. Worst case the dialog
        // doesn't show and the confirm path warns about note loss below.
      } finally {
        setRunning(false);
      }
      setLiveCount(count);
    }

    if (count > 0 && members.length > 0) {
      // Notes on the composite need a destination decision first.
      setDialogOpen(true);
      return;
    }
    // No composite-level notes → plain confirm + unmerge.
    if (
      !confirm(
        "Unmerge this composite? The source events will be visible again and won't re-flag as duplicates.",
      )
    ) {
      return;
    }
    void doUnmerge([]);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-accent-red border border-border rounded disabled:opacity-50"
      >
        {running ? "Unmerging…" : "Unmerge"}
      </button>
      {err && <span className="text-[0.8125rem] text-accent-red">{err}</span>}

      {dialogOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !running && setDialogOpen(false)}
        >
          <div
            className="bg-background border border-border rounded shadow-lg max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[1rem] font-semibold mb-2">
              Unmerge — keep {liveCount} journal{" "}
              {liveCount === 1 ? "note" : "notes"}?
            </h2>
            <p className="text-[0.8125rem] text-text-secondary mb-4">
              This merged record has {liveCount} journal{" "}
              {liveCount === 1 ? "note" : "notes"} that will be deleted with
              it. Copy {liveCount === 1 ? "it" : "them"} onto which source
              events? (Notes written directly on a source event aren&apos;t
              affected.)
            </p>
            <div className="space-y-2 mb-5">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 text-[0.8125rem] font-mono"
                >
                  <input
                    type="checkbox"
                    checked={checked[m.id] ?? false}
                    onChange={(e) =>
                      setChecked((prev) => ({ ...prev, [m.id]: e.target.checked }))
                    }
                    disabled={running}
                  />
                  <span className="truncate">{m.label}</span>
                </label>
              ))}
            </div>
            {err && (
              <div className="mb-3 text-[0.75rem] text-accent-red">{err}</div>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={running}
                className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targets = members
                    .map((m) => m.id)
                    .filter((id) => checked[id]);
                  void doUnmerge(targets);
                }}
                disabled={running}
                className="px-4 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
              >
                {running ? "Unmerging…" : "Unmerge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
