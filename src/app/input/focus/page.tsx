"use client";

import { useState, useEffect } from "react";

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
}

export default function FocusInputPage() {
  const [sportList, setSportList] = useState<Sport[]>([]);
  const [focusList, setFocusList] = useState<Focus[]>([]);

  const [name, setName] = useState("");
  const [sportId, setSportId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    const [sportsRes, focusesRes] = await Promise.all([
      fetch("/api/sports"),
      fetch("/api/focuses"),
    ]);
    const sportsData = await sportsRes.json();
    const focusesData = await focusesRes.json();
    setSportList(sportsData);
    setFocusList(focusesData);
    if (sportsData.length > 0 && sportId === null) setSportId(sportsData[0].id);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!sportId || !name.trim()) return;
    setSubmitting(true);

    const res = await fetch("/api/focuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, sportId, technicalNotes: notes || undefined }),
    });

    if (res.ok) {
      setName("");
      setNotes("");
      await loadData();
    }
    setSubmitting(false);
  }

  async function handleClose(id: number) {
    const verdict = prompt("Close this focus. What's the verdict? What worked? What didn't?");
    if (verdict === null) return;
    await fetch(`/api/focuses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed", verdict }),
    });
    await loadData();
  }

  async function handleAddEntry(id: number) {
    const content = prompt("Add an entry to this focus's case file");
    if (!content) return;
    await fetch(`/api/focuses/${id}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  const activeFocuses = focusList.filter((f) => f.status === "active");
  const completedFocuses = focusList.filter((f) => f.status !== "active");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Focuses</h1>

      <form onSubmit={handleCreate} className="space-y-4 mb-10 pb-8 border-b border-border">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Start a New Focus</h2>

        <div>
          <label className="block text-[12px] text-muted mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Break 315 Bench, Cross-Face Defense"
            className="w-full px-3 py-2 border border-border rounded text-[14px] focus:outline-none focus:border-foreground"
            required
          />
        </div>

        <div>
          <label className="block text-[12px] text-muted mb-1">Sport</label>
          <select
            value={sportId ?? ""}
            onChange={(e) => setSportId(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 border border-border rounded text-[14px] focus:outline-none focus:border-foreground"
          >
            {sportList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name.charAt(0).toUpperCase() + s.name.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] text-muted mb-1">Technical Notes (markdown)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you working on technically? Programming details, techniques, protocols..."
            className="w-full px-3 py-2 border border-border rounded text-[14px] focus:outline-none focus:border-foreground min-h-[100px] resize-y"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !name.trim() || !sportId}
          className="px-6 py-2.5 bg-foreground text-background text-[14px] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          Create Focus
        </button>
      </form>

      <div className="mb-8">
        <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
          <span className="text-[13px] font-semibold uppercase tracking-wider text-muted">Active</span>
          <span className="font-mono text-[11px] text-muted">{activeFocuses.length}</span>
        </div>
        {activeFocuses.length === 0 ? (
          <p className="text-[14px] text-muted py-2">No active focuses yet.</p>
        ) : (
          activeFocuses.map((f) => {
            const weeks = Math.max(1, Math.ceil((Date.now() - new Date(f.startDate).getTime()) / (7 * 24 * 60 * 60 * 1000)));
            return (
              <div key={f.id} className="flex justify-between items-center py-3 border-b border-surface">
                <div className="flex items-center gap-3">
                  <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: f.sportColor }} />
                  <div>
                    <div className="text-[14px] font-medium">{f.name}</div>
                    <div className="font-mono text-[11px] text-muted">{f.sportName} · Week {weeks}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAddEntry(f.id)}
                    className="px-3 py-1.5 border border-border rounded text-[12px] hover:bg-surface"
                  >
                    Add Entry
                  </button>
                  <button
                    onClick={() => handleClose(f.id)}
                    className="px-3 py-1.5 border border-border rounded text-[12px] hover:bg-surface"
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {completedFocuses.length > 0 && (
        <div className="mb-8">
          <div className="flex justify-between items-baseline mb-3 border-b border-border pb-2">
            <span className="text-[13px] font-semibold uppercase tracking-wider text-muted">Completed</span>
            <span className="font-mono text-[11px] text-muted">{completedFocuses.length}</span>
          </div>
          {completedFocuses.map((f) => (
            <div key={f.id} className="flex justify-between items-center py-2 border-b border-surface text-muted">
              <div className="flex items-center gap-3">
                <span className="w-[6px] h-[6px] rounded-full opacity-50" style={{ backgroundColor: f.sportColor }} />
                <span className="text-[14px]">{f.name}</span>
              </div>
              <span className="font-mono text-[11px]">{f.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
