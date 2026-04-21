"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Sport {
  id: number;
  name: string;
}

export function NewEventForm({ sports }: { sports: Sport[] }) {
  const router = useRouter();
  const [sportId, setSportId] = useState<number>(sports[0]?.id ?? 0);
  const [type, setType] = useState("strength");
  const [startedAt, setStartedAt] = useState(() => localDatetimeValue(new Date()));
  const [durationMinutes, setDurationMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!sportId) {
      setErr("Pick a sport");
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
          sportId,
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
      <Field label="Sport">
        <select
          value={sportId}
          onChange={(e) => setSportId(Number(e.target.value))}
          className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
        >
          {sports.map((s) => (
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
          placeholder="e.g. strength, run, ride, class"
          className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem]"
        />
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
