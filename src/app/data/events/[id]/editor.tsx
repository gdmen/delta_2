"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { utcIsoToLocalInput } from "@/lib/format";

interface Event {
  id: number;
  sportId: number;
  sportName: string;
  type: string;
  durationMinutes: number | null;
  notes: string | null;
  startedAt: string;
  source: string;
  sourceId: string | null;
}

interface WorkoutSetRow {
  id: number;
  eventId: number;
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number;
  rpe: number | null;
  notes: string | null;
}

interface EventMetricRow {
  metricTypeId: number;
  name: string;
  unit: string;
  value: number;
}

interface Sport { id: number; name: string; }
interface MetricTypeOption { id: number; name: string; unit: string; }

export function EventEditor({
  event,
  sports,
  initialSets,
  initialEventMetrics,
  metricTypes,
}: {
  event: Event;
  sports: Sport[];
  initialSets: WorkoutSetRow[];
  initialEventMetrics: EventMetricRow[];
  metricTypes: MetricTypeOption[];
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Event header editable draft.
  const [header, setHeader] = useState({
    sportId: event.sportId,
    type: event.type,
    startedAt: utcIsoToLocalInput(event.startedAt),
    durationMinutes: event.durationMinutes?.toString() ?? "",
    notes: event.notes ?? "",
  });
  const [headerDirty, setHeaderDirty] = useState(false);

  const [sets, setSets] = useState<WorkoutSetRow[]>(initialSets);
  const [ems, setEms] = useState<EventMetricRow[]>(initialEventMetrics);
  const [newSet, setNewSet] = useState({
    exerciseName: "",
    setNumber: "",
    reps: "",
    weight: "",
    rpe: "",
    notes: "",
  });
  const [newEm, setNewEm] = useState({ metricTypeId: "", value: "" });

  const imported = event.source !== "manual";

  async function saveHeader() {
    setBusy(true);
    setErr(null);
    const dur = header.durationMinutes.trim() === "" ? null : Number(header.durationMinutes);
    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sportId: header.sportId,
        type: header.type,
        startedAt: new Date(header.startedAt).toISOString(),
        durationMinutes: dur,
        notes: header.notes || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json()).error ?? "Save failed");
      return;
    }
    setHeaderDirty(false);
    router.refresh();
  }

  async function deleteEvent() {
    if (!confirm("Delete this event? Its workout sets and attached metrics will be removed too.")) return;
    setBusy(true);
    const res = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setErr("Delete failed");
      return;
    }
    router.push("/data");
  }

  async function patchSet(id: number, patch: Partial<WorkoutSetRow>) {
    const res = await fetch(`/api/workout-sets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setErr("Failed to update set");
      return false;
    }
    setSets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    return true;
  }

  async function deleteSet(id: number) {
    if (!confirm("Delete this set?")) return;
    const res = await fetch(`/api/workout-sets/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setErr("Delete failed");
      return;
    }
    setSets((prev) => prev.filter((s) => s.id !== id));
  }

  async function addSet() {
    if (!newSet.exerciseName || !newSet.reps || !newSet.weight) {
      setErr("exerciseName, reps, weight required");
      return;
    }
    const setNumberNum = newSet.setNumber ? Number(newSet.setNumber) : (sets.at(-1)?.setNumber ?? 0) + 1;
    const body = {
      eventId: event.id,
      exerciseName: newSet.exerciseName,
      setNumber: setNumberNum,
      reps: Number(newSet.reps),
      weight: Number(newSet.weight),
      rpe: newSet.rpe ? Number(newSet.rpe) : null,
      notes: newSet.notes || null,
    };
    const res = await fetch("/api/workout-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setErr((await res.json()).error ?? "Create failed");
      return;
    }
    const { id } = await res.json();
    setSets((prev) => [...prev, { id, ...body }].sort((a, b) => a.setNumber - b.setNumber));
    setNewSet({ exerciseName: "", setNumber: "", reps: "", weight: "", rpe: "", notes: "" });
    setErr(null);
  }

  async function upsertEm(metricTypeId: number, value: number, name: string, unit: string) {
    const res = await fetch("/api/event-metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: event.id, metricTypeId, value }),
    });
    if (!res.ok) {
      setErr("Failed to save event metric");
      return false;
    }
    setEms((prev) => {
      const next = prev.filter((e) => e.metricTypeId !== metricTypeId);
      return [...next, { metricTypeId, value, name, unit }].sort((a, b) => a.name.localeCompare(b.name));
    });
    return true;
  }

  async function deleteEm(metricTypeId: number) {
    if (!confirm("Remove this attached metric?")) return;
    const res = await fetch(`/api/event-metrics/${event.id}/${metricTypeId}`, { method: "DELETE" });
    if (!res.ok) {
      setErr("Delete failed");
      return;
    }
    setEms((prev) => prev.filter((e) => e.metricTypeId !== metricTypeId));
  }

  async function addEm() {
    const mid = Number(newEm.metricTypeId);
    const val = Number(newEm.value);
    if (!Number.isFinite(mid) || !Number.isFinite(val)) {
      setErr("pick a metric + enter a number");
      return;
    }
    const meta = metricTypes.find((m) => m.id === mid);
    if (!meta) {
      setErr("unknown metric_type");
      return;
    }
    if (await upsertEm(mid, val, meta.name, meta.unit)) {
      setNewEm({ metricTypeId: "", value: "" });
      setErr(null);
    }
  }

  return (
    <div className="space-y-8">
      {imported && (
        <div className="p-3 bg-accent-orange/10 border border-accent-orange/20 rounded text-[0.8125rem] text-accent-orange">
          Imported row (source: <code className="font-mono">{event.source}</code>). Edits may be overwritten
          on the next sync from this source.
        </div>
      )}

      {/* Event header */}
      <section>
        <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-2">
          Event
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-border rounded p-4">
          <Field label="Sport">
            <select
              value={header.sportId}
              onChange={(e) => { setHeader((h) => ({ ...h, sportId: Number(e.target.value) })); setHeaderDirty(true); }}
              className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
            >
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <input
              type="text"
              value={header.type}
              onChange={(e) => { setHeader((h) => ({ ...h, type: e.target.value })); setHeaderDirty(true); }}
              className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem]"
            />
          </Field>
          <Field label="Started at">
            <input
              type="datetime-local"
              value={header.startedAt}
              onChange={(e) => { setHeader((h) => ({ ...h, startedAt: e.target.value })); setHeaderDirty(true); }}
              className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono"
            />
          </Field>
          <Field label="Duration (minutes)">
            <input
              type="number"
              step="any"
              value={header.durationMinutes}
              onChange={(e) => { setHeader((h) => ({ ...h, durationMinutes: e.target.value })); setHeaderDirty(true); }}
              className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono"
              placeholder="(empty = null)"
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <textarea
                value={header.notes}
                onChange={(e) => { setHeader((h) => ({ ...h, notes: e.target.value })); setHeaderDirty(true); }}
                rows={2}
                className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem]"
              />
            </Field>
          </div>
          <div className="md:col-span-2 flex gap-3 items-center">
            <button
              type="button"
              onClick={saveHeader}
              disabled={busy || !headerDirty}
              className="px-4 py-2 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
            >
              Save event
            </button>
            <button
              type="button"
              onClick={deleteEvent}
              disabled={busy}
              className="text-[0.8125rem] text-muted hover:text-accent-red"
            >
              Delete event
            </button>
          </div>
        </div>
      </section>

      {/* Workout sets */}
      <section>
        <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-2">
          Workout sets ({sets.length})
        </h2>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-[0.8125rem]">
            <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
              <tr>
                <th className="text-left font-mono font-semibold px-3 py-2 w-16">#</th>
                <th className="text-left font-mono font-semibold px-3 py-2">Exercise</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-20">Reps</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-24">Weight</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-20">RPE</th>
                <th className="text-left font-mono font-semibold px-3 py-2">Notes</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border bg-surface/40">
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={newSet.setNumber}
                    onChange={(e) => setNewSet((s) => ({ ...s, setNumber: e.target.value }))}
                    placeholder="#"
                    className="w-12 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={newSet.exerciseName}
                    onChange={(e) => setNewSet((s) => ({ ...s, exerciseName: e.target.value }))}
                    placeholder="Barbell Back Squat"
                    className="w-full px-2 py-1 border border-border rounded text-[0.8125rem]"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input type="number" step="any" value={newSet.reps}
                    onChange={(e) => setNewSet((s) => ({ ...s, reps: e.target.value }))}
                    className="w-14 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
                </td>
                <td className="px-3 py-2 text-right">
                  <input type="number" step="any" value={newSet.weight}
                    onChange={(e) => setNewSet((s) => ({ ...s, weight: e.target.value }))}
                    className="w-20 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
                </td>
                <td className="px-3 py-2 text-right">
                  <input type="number" step="0.5" value={newSet.rpe}
                    onChange={(e) => setNewSet((s) => ({ ...s, rpe: e.target.value }))}
                    className="w-14 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
                </td>
                <td className="px-3 py-2">
                  <input type="text" value={newSet.notes}
                    onChange={(e) => setNewSet((s) => ({ ...s, notes: e.target.value }))}
                    className="w-full px-2 py-1 border border-border rounded text-[0.8125rem]" />
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={addSet} className="px-3 py-1 bg-foreground text-background text-[0.75rem] rounded hover:opacity-90">
                    + Add
                  </button>
                </td>
              </tr>
              {sets.map((s) => <SetRow key={s.id} row={s} onPatch={(patch) => patchSet(s.id, patch)} onDelete={() => deleteSet(s.id)} />)}
            </tbody>
          </table>
        </div>
      </section>

      {/* Attached event metrics */}
      <section>
        <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-2">
          Attached metrics ({ems.length})
        </h2>
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-[0.8125rem]">
            <thead className="bg-surface text-foreground text-[0.6875rem] uppercase tracking-wider border-b border-border">
              <tr>
                <th className="text-left font-mono font-semibold px-3 py-2">Metric</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-32">Value</th>
                <th className="text-right font-mono font-semibold px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border bg-surface/40">
                <td className="px-3 py-2">
                  <select
                    value={newEm.metricTypeId}
                    onChange={(e) => setNewEm((n) => ({ ...n, metricTypeId: e.target.value }))}
                    className="w-full px-2 py-1 border border-border rounded text-[0.8125rem] bg-background"
                  >
                    <option value="">-- pick metric --</option>
                    {metricTypes
                      .filter((m) => !ems.some((e) => e.metricTypeId === m.id))
                      .map((m) => <option key={m.id} value={m.id}>{m.name} {m.unit ? `(${m.unit})` : ""}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <input type="number" step="any" value={newEm.value}
                    onChange={(e) => setNewEm((n) => ({ ...n, value: e.target.value }))}
                    className="w-24 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={addEm} disabled={!newEm.metricTypeId || !newEm.value}
                    className="px-3 py-1 bg-foreground text-background text-[0.75rem] rounded hover:opacity-90 disabled:opacity-50">
                    + Add
                  </button>
                </td>
              </tr>
              {ems.map((e) => (
                <EmRow
                  key={e.metricTypeId}
                  row={e}
                  onChange={(v) => upsertEm(e.metricTypeId, v, e.name, e.unit)}
                  onDelete={() => deleteEm(e.metricTypeId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {err && (
        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {err}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Row components
// -----------------------------------------------------------------------------

function SetRow({
  row,
  onPatch,
  onDelete,
}: {
  row: WorkoutSetRow;
  onPatch: (patch: Partial<WorkoutSetRow>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({
    setNumber: row.setNumber.toString(),
    exerciseName: row.exerciseName,
    reps: row.reps.toString(),
    weight: row.weight.toString(),
    rpe: row.rpe?.toString() ?? "",
    notes: row.notes ?? "",
  });
  const [dirty, setDirty] = useState(false);

  function update<K extends keyof typeof draft>(key: K, v: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: v }));
    setDirty(true);
  }

  async function save() {
    const ok = await onPatch({
      setNumber: Number(draft.setNumber),
      exerciseName: draft.exerciseName,
      reps: Number(draft.reps),
      weight: Number(draft.weight),
      rpe: draft.rpe.trim() === "" ? null : Number(draft.rpe),
      notes: draft.notes || null,
    });
    if (ok) setDirty(false);
  }

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-1.5">
        <input type="number" value={draft.setNumber} onChange={(e) => update("setNumber", e.target.value)}
          className="w-12 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
      </td>
      <td className="px-3 py-1.5">
        <input type="text" value={draft.exerciseName} onChange={(e) => update("exerciseName", e.target.value)}
          className="w-full px-2 py-1 border border-border rounded text-[0.8125rem]" />
      </td>
      <td className="px-3 py-1.5 text-right">
        <input type="number" step="any" value={draft.reps} onChange={(e) => update("reps", e.target.value)}
          className="w-14 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
      </td>
      <td className="px-3 py-1.5 text-right">
        <input type="number" step="any" value={draft.weight} onChange={(e) => update("weight", e.target.value)}
          className="w-20 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
      </td>
      <td className="px-3 py-1.5 text-right">
        <input type="number" step="0.5" value={draft.rpe} onChange={(e) => update("rpe", e.target.value)}
          className="w-14 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
      </td>
      <td className="px-3 py-1.5">
        <input type="text" value={draft.notes} onChange={(e) => update("notes", e.target.value)}
          className="w-full px-2 py-1 border border-border rounded text-[0.8125rem]" />
      </td>
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        {dirty && (
          <button type="button" onClick={save}
            className="px-2 py-1 bg-foreground text-background text-[0.75rem] rounded hover:opacity-90 mr-1">
            Save
          </button>
        )}
        <button type="button" onClick={onDelete}
          className="text-[0.75rem] text-muted hover:text-accent-red">
          ✕
        </button>
      </td>
    </tr>
  );
}

function EmRow({
  row,
  onChange,
  onDelete,
}: {
  row: EventMetricRow;
  onChange: (v: number) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(row.value.toString());
  const [dirty, setDirty] = useState(false);

  async function save() {
    const v = Number(draft);
    if (!Number.isFinite(v)) return;
    const ok = await onChange(v);
    if (ok) setDirty(false);
  }

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-1.5 font-mono">
        {row.name} <span className="text-muted">{row.unit && `(${row.unit})`}</span>
      </td>
      <td className="px-3 py-1.5 text-right">
        <input type="number" step="any" value={draft}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          className="w-24 px-1 py-1 border border-border rounded text-[0.8125rem] font-mono text-right" />
      </td>
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        {dirty && (
          <button type="button" onClick={save}
            className="px-2 py-1 bg-foreground text-background text-[0.75rem] rounded hover:opacity-90 mr-1">
            Save
          </button>
        )}
        <button type="button" onClick={onDelete}
          className="text-[0.75rem] text-muted hover:text-accent-red">
          ✕
        </button>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[0.6875rem] font-mono uppercase tracking-wider text-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
