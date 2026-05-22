"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

export interface EventJournalEntry {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Event journal: add + reverse-chron list + edit-in-place + delete.
 * Markdown via react-markdown (no rehype-raw — injection-safe, same as
 * the goal journal). Issue #19.
 *
 * Unlike the goal journal (append-only), this supports full CRUD. When
 * #33 lands, the goal journal should adopt this component's shape.
 *
 * Local optimistic state so add/edit/delete reflect immediately; we
 * also router.refresh() so the server-rendered count (and the unmerge
 * dialog's note count on composites) stays in sync.
 */
export function EventJournal({
  eventId,
  initialEntries,
}: {
  eventId: number;
  initialEntries: EventJournalEntry[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<EventJournalEntry[]>(initialEntries);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const content = draft.trimEnd();
    if (!content) {
      setError("Entry can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/journal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as EventJournalEntry;
      setEntries((prev) => [created, ...prev]);
      setDraft("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: number) {
    const content = editDraft.trimEnd();
    if (!content) {
      setError("Entry can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/journal/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as EventJournalEntry;
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      setEditingId(null);
      setEditDraft("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this journal entry?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/journal/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 pt-6 border-t border-border">
      <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3">
        Journal
      </h2>

      {/* Add form */}
      <div className="mb-5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What happened? Markdown supported."
          rows={3}
          disabled={busy}
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] font-sans resize-y min-h-[5rem] bg-background"
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          {error && (
            <span className="text-[0.75rem] text-accent-red mr-auto">{error}</span>
          )}
          <button
            type="button"
            onClick={add}
            disabled={busy || !draft.trim()}
            className="px-3 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add entry"}
          </button>
        </div>
      </div>

      {/* List */}
      {entries.length === 0 ? (
        <p className="text-[0.875rem] text-muted py-2">No entries yet.</p>
      ) : (
        <div className="space-y-5">
          {entries.map((e) => {
            const edited = e.updatedAt && e.updatedAt !== e.createdAt;
            return (
              <div key={e.id} className="pl-3 border-l border-surface">
                <div className="flex items-baseline gap-2 text-[0.6875rem] font-mono text-muted mb-1">
                  <span className="tabular-nums">{formatTimestamp(e.createdAt)}</span>
                  {edited && <span className="uppercase tracking-wider">edited</span>}
                  {editingId !== e.id && (
                    <span className="ml-auto flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(e.id);
                          setEditDraft(e.content);
                          setError(null);
                        }}
                        className="hover:text-foreground"
                        disabled={busy}
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(e.id)}
                        className="hover:text-accent-red"
                        disabled={busy}
                      >
                        delete
                      </button>
                    </span>
                  )}
                </div>
                {editingId === e.id ? (
                  <div>
                    <textarea
                      value={editDraft}
                      onChange={(ev) => setEditDraft(ev.target.value)}
                      rows={3}
                      disabled={busy}
                      className="w-full px-3 py-2 border border-border rounded text-[0.875rem] font-sans resize-y min-h-[5rem] bg-background"
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => saveEdit(e.id)}
                        disabled={busy || !editDraft.trim()}
                        className="px-3 py-1 bg-foreground text-background text-[0.75rem] rounded hover:opacity-90 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft("");
                        }}
                        disabled={busy}
                        className="text-[0.75rem] text-muted hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[0.875rem] prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>{e.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${min}`;
}
