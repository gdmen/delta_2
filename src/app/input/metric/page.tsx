"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Sport {
  id: number;
  name: string;
  color: string;
}

export default function NewMetricPage() {
  const router = useRouter();
  const [sportList, setSportList] = useState<Sport[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [sportId, setSportId] = useState<number | "">("");
  const [frequencyHint, setFrequencyHint] = useState<
    "daily" | "weekly" | "occasional"
  >("daily");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sports")
      .then((r) => r.json())
      .then((data: Sport[]) => setSportList(data))
      .catch(() => setSportList([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/metric-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          unit: unit.trim(),
          sportId: sportId === "" ? null : sportId,
          frequencyHint,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const created = await res.json();
      // Land on the metric detail page so the user can immediately add readings.
      router.push(`/data/metrics/${encodeURIComponent(created.name)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[560px]">
      <h1 className="text-2xl font-semibold mb-2">New metric</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Define a new primitive numeric metric. Examples: <span className="font-mono">overhead_1rm</span>,{" "}
        <span className="font-mono">resting_hr</span>,{" "}
        <span className="font-mono">grip_strength_kg</span>.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[0.8125rem] font-medium mb-1">
            Name <span className="text-muted">(required, unique)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="overhead_1rm"
            autoFocus
            pattern="[^:]*"
            title="No colons — `:` is reserved for source-imported metrics like body_spec:arms_fat_pct"
            className="w-full px-3 py-1.5 border border-border rounded text-[0.875rem] font-mono"
            disabled={submitting}
          />
          <p className="text-[0.75rem] text-muted mt-1">
            Use snake_case for consistency with imported metrics. The name is
            also the route at <span className="font-mono">/data/metrics/[name]</span>.
            <span className="block">
              No <code className="font-mono">:</code> — that&apos;s reserved for
              source-imported metrics like{" "}
              <code className="font-mono">body_spec:arms_fat_pct</code>.
            </span>
          </p>
        </div>

        <div>
          <label className="block text-[0.8125rem] font-medium mb-1">
            Unit <span className="text-muted">(optional)</span>
          </label>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="kg, lb, ms, h, %, reps…"
            className="w-full px-3 py-1.5 border border-border rounded text-[0.875rem] font-mono"
            disabled={submitting}
          />
          <p className="text-[0.75rem] text-muted mt-1">
            Leave blank for unitless metrics (e.g. counts).
          </p>
        </div>

        <div>
          <label className="block text-[0.8125rem] font-medium mb-1">
            Sport <span className="text-muted">(optional)</span>
          </label>
          <select
            value={sportId}
            onChange={(e) =>
              setSportId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full px-3 py-1.5 border border-border rounded text-[0.875rem] bg-background"
            disabled={submitting}
          >
            <option value="">— none (cross-sport) —</option>
            {sportList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="text-[0.75rem] text-muted mt-1">
            Cross-sport metrics like body weight or sleep usually have no sport.
          </p>
        </div>

        <div>
          <label className="block text-[0.8125rem] font-medium mb-1">
            Frequency hint
          </label>
          <select
            value={frequencyHint}
            onChange={(e) =>
              setFrequencyHint(
                e.target.value as "daily" | "weekly" | "occasional",
              )
            }
            className="w-full px-3 py-1.5 border border-border rounded text-[0.875rem] bg-background"
            disabled={submitting}
          >
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="occasional">occasional</option>
          </select>
          <p className="text-[0.75rem] text-muted mt-1">
            Informs how the dashboard treats gaps. <span className="font-mono">daily</span>{" "}
            metrics flag missing days; <span className="font-mono">occasional</span> ones
            (DEXA scans, 1RMs) don&apos;t.
          </p>
        </div>

        {error && (
          <div className="border border-red-500/40 bg-red-500/10 rounded p-3 text-[0.8125rem] text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="px-4 py-1.5 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create metric"}
          </button>
          <Link
            href="/data"
            className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
