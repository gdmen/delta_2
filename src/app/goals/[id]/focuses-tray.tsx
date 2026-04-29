"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Focus {
  id: number;
  name: string;
  source: "manual" | "llm";
  startDate: string;
  endDate: string | null;
  status: "active" | "completed" | "abandoned";
  technicalNotes: string | null;
  evidence: string | null;
}

/**
 * Per-goal focuses tray. PR #2 ships manual focuses only — `source: "llm"`
 * proposals + promote/dismiss arrive in PR #3 alongside the suggest-focuses
 * endpoint. Closed focuses render under a separator with reduced opacity so
 * the tray stays useful as a history view too.
 */
export function FocusesTray({
  goalId,
  focuses,
}: {
  goalId: number;
  focuses: Focus[];
}) {
  const active = focuses.filter((f) => f.status === "active");
  const closed = focuses.filter((f) => f.status !== "active");

  return (
    <div>
      <div className="space-y-2">
        {active.length === 0 && closed.length === 0 ? (
          <p className="text-[0.875rem] text-muted py-2">
            No focuses yet. Type one, or generate from your data.
          </p>
        ) : null}

        {active.map((f) => (
          <FocusRow key={f.id} goalId={goalId} focus={f} />
        ))}
      </div>

      <AddFocusForm goalId={goalId} />

      {closed.length > 0 && (
        <div className="mt-6 pt-4 border-t border-surface">
          <div className="text-[0.6875rem] font-mono text-muted uppercase tracking-wider mb-2">
            closed
          </div>
          <div className="space-y-1.5 opacity-60">
            {closed.map((f) => (
              <FocusRow key={f.id} goalId={goalId} focus={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FocusRow({ goalId, focus }: { goalId: number; focus: Focus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isActive = focus.status === "active";
  const isLlm = focus.source === "llm";

  async function closeFocus() {
    // Use the dedicated close endpoint so an LLM verdict gets generated and
    // appended to the goal journal as a tagged entry. The endpoint always
    // closes the focus first, so even if the LLM call fails the focus state
    // ends up correct.
    setBusy(true);
    try {
      const res = await fetch(`/api/goals/${goalId}/focuses/${focus.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      setBusy(false);
    }
  }

  async function reopenFocus() {
    setBusy(true);
    try {
      const res = await fetch(`/api/goals/${goalId}/focuses/${focus.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3 py-1.5">
      {isLlm && (
        <span className="text-[0.625rem] font-mono uppercase text-muted px-1.5 py-0.5 border border-border rounded mt-0.5">
          AI
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[0.875rem]">{focus.name}</div>
        {focus.technicalNotes && (
          <div className="text-[0.75rem] text-muted mt-0.5 whitespace-pre-wrap">
            {focus.technicalNotes}
          </div>
        )}
        <div className="font-mono text-[0.6875rem] text-muted mt-0.5">
          {focus.startDate}
          {focus.endDate ? ` → ${focus.endDate}` : ""}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        {isActive ? (
          <button
            type="button"
            onClick={closeFocus}
            disabled={busy}
            className="text-[0.6875rem] font-mono text-muted hover:text-foreground disabled:opacity-50 px-2 py-1"
            title="Close focus + generate journal verdict"
          >
            {busy ? "closing…" : "close"}
          </button>
        ) : (
          <button
            type="button"
            onClick={reopenFocus}
            disabled={busy}
            className="text-[0.6875rem] font-mono text-muted hover:text-foreground disabled:opacity-50 px-2 py-1"
            title="Reopen focus"
          >
            reopen
          </button>
        )}
      </div>
    </div>
  );
}

function AddFocusForm({ goalId }: { goalId: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals/${goalId}/focuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="+ add a focus (e.g. side control escapes)"
        className="flex-1 px-2 py-1 border border-border rounded text-[0.8125rem] bg-transparent placeholder:text-muted"
        disabled={busy}
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="text-[0.6875rem] font-mono text-muted hover:text-foreground disabled:opacity-50 px-2 py-1"
      >
        {busy ? "…" : "add"}
      </button>
      {error && (
        <span className="text-[0.75rem] text-red-400 ml-2">{error}</span>
      )}
    </form>
  );
}
