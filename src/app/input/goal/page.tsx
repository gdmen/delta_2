"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Sport {
  id: number;
  name: string;
  color: string;
}

interface MetricType {
  id: number;
  name: string;
  unit: string;
  sportId: number | null;
}

interface Goal {
  id: number;
  metricName: string;
  metricUnit: string;
  sportName: string;
  sportColor: string;
  targetValue: number;
  deadline: string;
  status: string;
  progressPct: number;
  currentValue: number | null;
}

export default function GoalInputPage() {
  const [sportList, setSportList] = useState<Sport[]>([]);
  const [metricList, setMetricList] = useState<MetricType[]>([]);
  const [goalList, setGoalList] = useState<Goal[]>([]);

  const [sportId, setSportId] = useState<number | null>(null);
  const [metricTypeId, setMetricTypeId] = useState<number | null>(null);
  const [targetValue, setTargetValue] = useState("");
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    const [sportsRes, metricsRes, goalsRes] = await Promise.all([
      fetch("/api/sports"),
      fetch("/api/metric-types"),
      fetch("/api/goals"),
    ]);
    const sportsData = await sportsRes.json();
    const metricsData = await metricsRes.json();
    const goalsData = await goalsRes.json();
    setSportList(sportsData);
    setMetricList(metricsData);
    setGoalList(goalsData);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When sport changes, restrict metric options to that sport or cross-sport.
  const availableMetrics = metricList.filter(
    (m) => m.sportId === null || m.sportId === sportId
  );

  useEffect(() => {
    // If current metric selection isn't valid for the new sport, clear it.
    if (metricTypeId && !availableMetrics.find((m) => m.id === metricTypeId)) {
      setMetricTypeId(null);
    }
  }, [sportId, metricTypeId, availableMetrics]);

  const selectedMetric = metricList.find((m) => m.id === metricTypeId);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!sportId || !metricTypeId || !targetValue || !deadline) return;
    setSubmitting(true);

    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sportId,
        metricTypeId,
        targetValue: parseFloat(targetValue),
        deadline,
      }),
    });

    if (res.ok) {
      setTargetValue("");
      setDeadline("");
      setMetricTypeId(null);
      await loadData();
    }
    setSubmitting(false);
  }

  const activeGoals = goalList.filter((g) => g.status !== "complete");
  const completedGoals = goalList.filter((g) => g.status === "complete");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Goals</h1>

      <form onSubmit={handleCreate} className="space-y-4 mb-10 pb-8 border-b border-border">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">Add a New Goal</h2>

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
          <label className="block text-[0.75rem] text-muted mb-1">Metric</label>
          <select
            value={metricTypeId ?? ""}
            onChange={(e) => setMetricTypeId(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground"
            required
          >
            <option value="">Pick a metric...</option>
            {availableMetrics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.unit})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted mb-1">
            Target Value{selectedMetric ? ` (${selectedMetric.unit})` : ""}
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder="e.g. 500"
            className="w-full px-3 py-2 border border-border rounded font-mono text-[1rem] focus:outline-none focus:border-foreground"
            required
          />
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted mb-1">Deadline</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded font-mono text-[0.9375rem] focus:outline-none focus:border-foreground"
            required
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !sportId || !metricTypeId || !targetValue || !deadline}
          className="px-6 py-2.5 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          Create Goal
        </button>
      </form>

      <GoalList title="Active" items={activeGoals} emptyMessage="No goals set yet." />
      <GoalList title="Completed" items={completedGoals} dim />
    </div>
  );
}

function GoalList({ title, items, dim = false, emptyMessage }: { title: string; items: Goal[]; dim?: boolean; emptyMessage?: string }) {
  if (items.length === 0 && !emptyMessage) return null;

  return (
    <div className="mb-8">
      <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">{title}</span>
        <span className="font-mono text-[0.6875rem] text-muted">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[0.875rem] text-muted py-2">{emptyMessage}</p>
      ) : (
        items.map((g) => {
          const daysLeft = Math.max(
            0,
            Math.ceil((new Date(g.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
          );
          return (
            <Link
              key={g.id}
              href={`/goals/${g.id}`}
              className={`flex justify-between items-center gap-3 py-3 border-b border-surface last:border-b-0 hover:bg-surface/40 -mx-2 px-2 rounded ${dim ? "opacity-70 hover:opacity-100" : ""}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                  style={{ backgroundColor: g.sportColor }}
                />
                <div className="min-w-0">
                  <div className="text-[0.875rem] font-medium">
                    {g.metricName} {g.targetValue}{g.metricUnit}
                  </div>
                  <div className="font-mono text-[0.6875rem] text-muted">
                    {g.sportName.toUpperCase()} · by {g.deadline} · {daysLeft}d left
                  </div>
                </div>
              </div>
              <span className="text-muted text-[0.875rem] flex-shrink-0">→</span>
            </Link>
          );
        })
      )}
    </div>
  );
}
