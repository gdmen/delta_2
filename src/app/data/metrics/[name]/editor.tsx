"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatShort, utcIsoToLocalInput } from "@/lib/format";

interface MetricRow {
  /**
   * Stored rows: the metrics.id (real DB id, used for PATCH/DELETE).
   * Synthesized rows: a stable string id like "set:42:rep:0" — never
   * sent to /api/metrics/* because edit/delete actions are hidden for
   * these rows. Type widened to `number | string` so the existing
   * editor logic still works for stored rows.
   */
  id: number | string;
  value: number;
  recordedAt: string;
  source: string;
  sourceId: string | null;
  /**
   * True when this row's authoritative copy lives elsewhere — e.g.
   * synthesized at read time from per-rep workout_sets fanout, or
   * archived from a frozen-on-the-wire source. Hides Edit/Delete
   * buttons and links the source label to the parent record.
   */
  readOnly?: boolean;
  /**
   * Optional href for read-only rows — points at the parent record
   * (e.g. /data/events/123 for a workout_sets row's parent event).
   * Rendered as a link in the Source column.
   */
  parentHref?: string;
}

export function MetricHistoryEditor({
  metricTypeId,
  unit,
  initialRows,
}: {
  metricTypeId: number;
  unit: string;
  initialRows: MetricRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<MetricRow[]>(initialRows);
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [draft, setDraft] = useState<{ value: string; recordedAt: string }>({ value: "", recordedAt: "" });
  const [newDraft, setNewDraft] = useState<{ value: string; recordedAt: string }>({
    value: "",
    recordedAt: utcIsoToLocalInput(new Date().toISOString()),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit(r: MetricRow) {
    setEditingId(r.id);
    setDraft({
      value: String(r.value),
      // datetime-local takes YYYY-MM-DDTHH:MM in LOCAL time. The stored
      // ISO is UTC — convert through utcIsoToLocalInput so the input
      // shows the user's wall-clock time and the round-trip on save
      // doesn't shift by the TZ offset.
      recordedAt: utcIsoToLocalInput(r.recordedAt),
    });
    setErr(null);
  }

  async function saveEdit(id: number | string) {
    if (typeof id !== "number") return; // read-only row — id is a synthetic string key
    const val = Number(draft.value);
    if (!Number.isFinite(val)) {
      setErr("value must be a number");
      return;
    }
    const iso = new Date(draft.recordedAt).toISOString();
    setBusy(true);
    const res = await fetch(`/api/metrics/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: val, recordedAt: iso }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json()).error ?? "Save failed");
      return;
    }
    setRows((prev) =>
      prev
        .map((r) => (r.id === id ? { ...r, value: val, recordedAt: iso } : r))
        .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
    );
    setEditingId(null);
    setErr(null);
  }

  async function remove(id: number | string) {
    if (typeof id !== "number") return; // read-only row — id is a synthetic string key
    if (!confirm("Delete this row?")) return;
    setBusy(true);
    const res = await fetch(`/api/metrics/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setErr("Delete failed");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function add() {
    const val = Number(newDraft.value);
    if (!Number.isFinite(val)) {
      setErr("value must be a number");
      return;
    }
    const iso = new Date(newDraft.recordedAt).toISOString();
    setBusy(true);
    const res = await fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricTypeId, value: val, recordedAt: iso }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json()).error ?? "Create failed");
      return;
    }
    // Simplest way to get the new row's id: refresh.
    router.refresh();
    setNewDraft({ value: "", recordedAt: utcIsoToLocalInput(new Date().toISOString()) });
    setErr(null);
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[0.8125rem]">
          <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
            <tr>
              <th className="text-left font-mono font-semibold px-3 py-2">Recorded at</th>
              <th className="text-right font-mono font-semibold px-3 py-2">Value</th>
              <th className="text-left font-mono font-semibold px-3 py-2">Source</th>
              <th className="text-left font-mono font-semibold px-3 py-2">Source id</th>
              <th className="text-right font-mono font-semibold px-3 py-2 w-[140px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Add-new row */}
            <tr className="border-t border-border bg-surface/40">
              <td className="px-3 py-2">
                <input
                  type="datetime-local"
                  value={newDraft.recordedAt}
                  onChange={(e) => setNewDraft((d) => ({ ...d, recordedAt: e.target.value }))}
                  className="px-2 py-1 border border-border rounded text-[0.8125rem] font-mono"
                />
              </td>
              <td className="px-3 py-2 text-right">
                <input
                  type="number"
                  step="any"
                  value={newDraft.value}
                  onChange={(e) => setNewDraft((d) => ({ ...d, value: e.target.value }))}
                  placeholder={`value (${unit || "?"})`}
                  className="w-28 px-2 py-1 border border-border rounded text-[0.8125rem] font-mono text-right"
                />
              </td>
              <td className="px-3 py-2 text-muted font-mono text-[0.75rem]">manual</td>
              <td></td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  disabled={busy || !newDraft.value}
                  onClick={add}
                  className="px-3 py-1 bg-foreground text-background text-[0.75rem] rounded hover:opacity-90 disabled:opacity-50"
                >
                  + Add
                </button>
              </td>
            </tr>

            {rows.map((r) => {
              const imported = r.source !== "manual";
              const isEditing = editingId === r.id;
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {isEditing ? (
                      <input
                        type="datetime-local"
                        value={draft.recordedAt}
                        onChange={(e) => setDraft((d) => ({ ...d, recordedAt: e.target.value }))}
                        className="px-2 py-1 border border-border rounded text-[0.8125rem] font-mono"
                      />
                    ) : (
                      formatShort(r.recordedAt)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {isEditing ? (
                      <input
                        type="number"
                        step="any"
                        value={draft.value}
                        onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                        className="w-24 px-2 py-1 border border-border rounded text-[0.8125rem] font-mono text-right"
                      />
                    ) : (
                      r.value
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[0.75rem]">
                    {r.readOnly && r.parentHref ? (
                      <Link
                        href={r.parentHref}
                        className="text-muted hover:text-foreground underline-offset-2 hover:underline"
                        title="Read-only — owned by another table; click to open the parent record"
                      >
                        {r.source}
                      </Link>
                    ) : imported ? (
                      <span
                        className="text-accent-orange"
                        title="Imported from external source; edits may be overwritten on next sync"
                      >
                        {r.source} ⚠
                      </span>
                    ) : (
                      <span className="text-muted">{r.source}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[0.6875rem] text-muted truncate max-w-[200px]">
                    {r.sourceId}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.readOnly ? (
                      // Authoritative copy lives in another table (e.g.
                      // workout_sets); edits belong on the parent record's
                      // page.
                      <span className="text-[0.6875rem] text-muted italic">read-only</span>
                    ) : isEditing ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => saveEdit(r.id)}
                          className="px-2 py-1 bg-foreground text-background text-[0.75rem] rounded hover:opacity-90 disabled:opacity-50 mr-1"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 text-[0.75rem] text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="text-[0.75rem] text-muted hover:text-foreground mr-3"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(r.id)}
                          className="text-[0.75rem] text-muted hover:text-accent-red disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {err && (
        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {err}
        </div>
      )}
    </div>
  );
}

