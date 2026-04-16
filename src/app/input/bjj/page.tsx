"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const BJJ_TYPES = [
  { value: "class", label: "Class" },
  { value: "open_mat", label: "Open Mat" },
  { value: "drilling", label: "Drilling" },
  { value: "teaching", label: "Teaching" },
];

export default function BjjInputPage() {
  const router = useRouter();
  const [bjjSportId, setBjjSportId] = useState<number | null>(null);
  const [type, setType] = useState("class");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch("/api/sports")
      .then((r) => r.json())
      .then((data) => {
        const bjj = data.find((s: { name: string }) => s.name === "bjj");
        if (bjj) setBjjSportId(bjj.id);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bjjSportId) return;
    setSubmitting(true);

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sportId: bjjSportId,
        type,
        durationMinutes: parseInt(durationMinutes, 10),
        notes: notes || undefined,
      }),
    });

    if (res.ok) {
      setSavedAt(new Date());
      setNotes("");
      setTimeout(() => router.push("/"), 1000);
    }
    setSubmitting(false);
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Log BJJ Session</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-[13px] font-semibold uppercase tracking-wider text-muted mb-2">
            Type
          </label>
          <div className="flex gap-0 border border-border rounded overflow-hidden">
            {BJJ_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
                  type === t.value ? "bg-foreground text-background" : "bg-background hover:bg-surface"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[13px] font-semibold uppercase tracking-wider text-muted mb-2">
            Duration (minutes)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded font-mono text-[16px] focus:outline-none focus:border-foreground"
            min="5"
            max="240"
            required
          />
        </div>

        <div>
          <label className="block text-[13px] font-semibold uppercase tracking-wider text-muted mb-2">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did you work on? Techniques drilled, rolls, training partners..."
            className="w-full px-3 py-2 border border-border rounded text-[14px] focus:outline-none focus:border-foreground min-h-[120px] resize-y"
          />
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting || !bjjSportId}
            className="px-6 py-2.5 bg-foreground text-background text-[14px] font-medium rounded hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Session"}
          </button>
          {savedAt && (
            <span className="text-[13px] text-accent-green">✓ Saved</span>
          )}
        </div>
      </form>
    </div>
  );
}
