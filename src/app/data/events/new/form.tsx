"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Activity {
  id: number;
  name: string;
}

export function NewEventForm({
  activities,
  typesByActivity,
}: {
  activities: Activity[];
  typesByActivity: Record<number, string[]>;
}) {
  const router = useRouter();
  const [activityId, setActivityId] = useState<number>(activities[0]?.id ?? 0);
  const typeSuggestions = typesByActivity[activityId] ?? [];
  // Default to the most common existing type for the chosen activity so the
  // form lands in a useful state. Free-text fallback for anything new.
  const [type, setType] = useState(typeSuggestions[0] ?? "");
  const [startedAt, setStartedAt] = useState(() => localDatetimeValue(new Date()));
  const [durationMinutes, setDurationMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!activityId) {
      setErr("Pick a activity");
      return;
    }
    if (!type.trim()) {
      setErr("Type is required (e.g. strength, run, class)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId,
          type: type.trim(),
          durationMinutes: durationMinutes.trim() === "" ? undefined : Number(durationMinutes),
          notes: notes.trim() || undefined,
          startedAt: new Date(startedAt).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Save failed");
        setBusy(false);
        return;
      }
      // upsertEvent returns { status, eventId }. Jump straight to the
      // editor so the user can start adding sets.
      router.push(`/data/events/${json.eventId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Activity">
        <select
          value={activityId}
          onChange={(e) => {
            const next = Number(e.target.value);
            setActivityId(next);
            // Re-seed the type with the most common existing type for the
            // newly-picked activity so the field stays consistent with the
            // selection. Empty string when the activity has no events yet.
            setType((typesByActivity[next] ?? [])[0] ?? "");
          }}
          className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
        >
          {activities.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Type">
        <input
          type="text"
          value={type}
          onChange={(e) => setType(e.target.value)}
          list="event-type-suggestions"
          placeholder={
            typeSuggestions.length > 0
              ? `e.g. ${typeSuggestions.slice(0, 3).join(", ")}`
              : "e.g. strength, run, ride, class"
          }
          className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem]"
        />
        <datalist id="event-type-suggestions">
          {typeSuggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {typeSuggestions.length > 0 && (
          <p className="mt-1 text-[0.6875rem] font-mono text-muted">
            existing types for this activity: {typeSuggestions.join(", ")}
          </p>
        )}
      </Field>
      <Field label="Started at">
        <input
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
          className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono"
          required
        />
      </Field>
      <Field label="Duration (minutes, optional)">
        <input
          type="number"
          step="any"
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(e.target.value)}
          className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono"
          placeholder="blank = null"
        />
      </Field>
      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem]"
        />
      </Field>
      <div className="flex gap-3 items-center pt-2">
        <button
          type="submit"
          disabled={busy}
          className="px-5 py-2 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save and add sets"}
        </button>
      </div>
      {err && (
        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {err}
        </div>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[0.6875rem] font-mono uppercase tracking-wider text-muted mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Build YYYY-MM-DDTHH:mm for a datetime-local input using local time. */
function localDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
