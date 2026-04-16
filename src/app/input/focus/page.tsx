"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Sport {
  id: number;
  name: string;
  color: string;
}

interface Focus {
  id: number;
  name: string;
  sportName: string;
  sportColor: string;
  startDate: string;
  status: string;
  technicalNotes: string | null;
  goalId: number | null;
  goalMetric: string | null;
  goalTarget: number | null;
  goalUnit: string | null;
}

interface Goal {
  id: number;
  sportId: number;
  metricName: string;
  metricUnit: string;
  targetValue: number;
  deadline: string;
  status: string;
}

export default function FocusInputPage() {
  const [sportList, setSportList] = useState<Sport[]>([]);
  const [focusList, setFocusList] = useState<Focus[]>([]);
  const [goalList, setGoalList] = useState<Goal[]>([]);

  const [name, setName] = useState("");
  const [sportId, setSportId] = useState<number | null>(null);
  const [goalId, setGoalId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    const [sportsRes, focusesRes, goalsRes] = await Promise.all([
      fetch("/api/sports"),
      fetch("/api/focuses"),
      fetch("/api/goals"),
    ]);
    const sportsData = await sportsRes.json();
    const focusesData = await focusesRes.json();
    const goalsData = await goalsRes.json();
    setSportList(sportsData);
    setFocusList(focusesData);
    setGoalList(goalsData);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When sport changes, clear goalId if it no longer matches.
  useEffect(() => {
    if (goalId !== null) {
      const linked = goalList.find((g) => g.id === goalId);
      if (linked && linked.sportId !== sportId) setGoalId(null);
    }
  }, [sportId, goalId, goalList]);

  const availableGoals = goalList.filter(
    (g) => g.sportId === sportId && g.status !== "complete"
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!sportId || !name.trim()) return;
    setSubmitting(true);

    const res = await fetch("/api/focuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        sportId,
        goalId: goalId ?? undefined,
        technicalNotes: notes || undefined,
      }),
    });

    if (res.ok) {
      setName("");
      setNotes("");
      setGoalId(null);
      await loadData();
    }
    setSubmitting(false);
  }

  const activeFocuses = focusList.filter((f) => f.status === "active");
  const completedFocuses = focusList.filter((f) => f.status !== "active");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Focuses</h1>

      <form onSubmit={handleCreate} className="space-y-4 mb-10 pb-8 border-b border-border">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Start a New Focus</h2>

        <div>
          <label className="block text-[0.75rem] text-muted mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Break 315 Bench, Cross-Face Defense"
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
            required
          />
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted mb-1">Sport</label>
          <select
            value={sportId ?? ""}
            onChange={(e) => setSportId(e.target.value === "" ? null : parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
            required
          >
            <option value="">Pick a sport...</option>
            {sportList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name === "bjj" ? "BJJ" : s.name.charAt(0).toUpperCase() + s.name.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted mb-1">
            Advances Goal <span className="text-[0.6875rem] font-mono">(optional)</span>
          </label>
          <select
            value={goalId ?? ""}
            onChange={(e) => setGoalId(e.target.value === "" ? null : parseInt(e.target.value, 10))}
            disabled={availableGoals.length === 0}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground disabled:opacity-50"
          >
            <option value="">— None (standalone focus) —</option>
            {availableGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.metricName} {g.targetValue}{g.metricUnit} by {g.deadline}
              </option>
            ))}
          </select>
          {availableGoals.length === 0 && sportId !== null && (
            <p className="mt-1 text-[0.6875rem] text-muted">
              No active goals for this sport.{" "}
              <Link href="/input/goal" className="text-foreground underline">Add one</Link> to link this focus to it.
            </p>
          )}
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted mb-1">Technical Notes (markdown)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you working on technically? Programming details, techniques, protocols..."
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground min-h-[100px] resize-y"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !name.trim() || !sportId}
          className="px-6 py-2.5 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          Create Focus
        </button>
      </form>

      <div className="mb-8">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Active</span>
          <span className="font-mono text-[0.6875rem] text-muted">{activeFocuses.length}</span>
        </div>
        {activeFocuses.length === 0 ? (
          <p className="text-[0.875rem] text-muted py-2">No active focuses yet.</p>
        ) : (
          activeFocuses.map((f) => {
            const weeks = Math.max(1, Math.ceil((Date.now() - new Date(f.startDate).getTime()) / (7 * 24 * 60 * 60 * 1000)));
            return (
              <Link
                key={f.id}
                href={`/focuses/${f.id}`}
                className="flex justify-between items-center gap-3 py-3 border-b border-surface last:border-b-0 hover:bg-surface/40 -mx-2 px-2 rounded"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                    style={{ backgroundColor: f.sportColor }}
                  />
                  <div className="min-w-0">
                    <div className="text-[0.875rem] font-medium">{f.name}</div>
                    <div className="font-mono text-[0.6875rem] text-muted">
                      {f.sportName.toUpperCase()} · Week {weeks}
                      {f.goalMetric && (
                        <>
                          {" · → "}
                          {f.goalMetric} {f.goalTarget}{f.goalUnit}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-muted text-[0.875rem] flex-shrink-0">→</span>
              </Link>
            );
          })
        )}
      </div>

      {completedFocuses.length > 0 && (
        <div className="mb-8">
          <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
            <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Completed</span>
            <span className="font-mono text-[0.6875rem] text-muted">{completedFocuses.length}</span>
          </div>
          {completedFocuses.map((f) => (
            <Link
              key={f.id}
              href={`/focuses/${f.id}`}
              className="flex justify-between items-center py-2 border-b border-surface last:border-b-0 opacity-70 hover:opacity-100 hover:bg-surface/40 -mx-2 px-2 rounded"
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-[6px] h-[6px] rounded-full"
                  style={{ backgroundColor: f.sportColor }}
                />
                <span className="text-[0.875rem]">{f.name}</span>
              </div>
              <span className="font-mono text-[0.6875rem] text-muted">{f.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
