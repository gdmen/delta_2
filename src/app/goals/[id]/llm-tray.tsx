"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface LlmFocus {
  id: number;
  name: string;
  evidence: string | null; // JSON blob from focuses.evidence
}

interface ParsedEvidence {
  rationale?: string;
  signal_refs?: string[];
  metric_trends?: string[];
  workout_ids?: number[];
}

/**
 * LLM-suggested focuses for a goal. Sits above the manual FocusesTray on
 * the omnibus page. Three actions per row: PROMOTE (flip source to manual,
 * survives next refresh), DISMISS (soft-delete, won't be re-proposed), and
 * COLLAPSE (toggle the evidence panel).
 *
 * Loading state: while a refresh is in flight, the pre-aggregate signals
 * block is shown inline as the placeholder. This makes the 3-8s wait
 * informative — you see WHY the LLM is going to think what it thinks,
 * which builds trust in the eventual suggestion quality.
 *
 * Stale-on-load: on mount, if `lastSuggestedAt` is null or > 7 days old,
 * fire a background refresh with `?if_stale=true`. The endpoint no-ops
 * server-side if it isn't actually stale; client just trusts the response.
 */
export function LlmTray({
  goalId,
  initialSuggestions,
  signalsBlock,
  lastSuggestedAt,
}: {
  goalId: number;
  initialSuggestions: LlmFocus[];
  signalsBlock: string; // pre-rendered markdown shown during loading
  lastSuggestedAt: string | null; // ISO timestamp or null
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // `mounted` gates anything that depends on a live `Date.now()` from
  // bleeding into the SSR'd HTML. The relative time label ("3d ago") would
  // otherwise differ by ~1s between server render and client hydration.
  const [mounted, setMounted] = useState(false);
  const staleFireRef = useRef(false);

  // Fire stale-on-load once. Even if the page rerenders, the ref stops a
  // second fire within the same mount. Also flips `mounted` so the
  // relative time label can render with a live Date.now().
  useEffect(() => {
    setMounted(true);
    if (staleFireRef.current) return;
    staleFireRef.current = true;
    const stale =
      !lastSuggestedAt ||
      Date.now() - new Date(lastSuggestedAt).getTime() > 7 * 24 * 60 * 60 * 1000;
    if (!stale) return;
    void refresh({ ifStale: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(opts: { ifStale?: boolean } = {}) {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const url = `/api/goals/${goalId}/suggest-focuses${opts.ifStale ? "?if_stale=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        // Typed error surface from the endpoint — pick a user-readable msg.
        const code = json.error ?? "internal";
        const msg =
          code === "rate_limit"
            ? "Rate limited. Try again in a minute."
            : code === "llm_unavailable"
              ? "LLM unavailable. Try again in a moment."
              : code === "malformed_llm_output"
                ? "LLM returned unexpected output. Try refreshing."
                : code === "missing_api_key"
                  ? "Anthropic API key not configured."
                  : json.message ?? "Refresh failed.";
        throw new Error(msg);
      }
      // Skipped (already fresh) is a normal response; don't refresh router.
      if (json.skipped) {
        setRefreshing(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function patchFocus(
    focusId: number,
    body: { source?: "manual"; dismissedAt?: string },
  ) {
    try {
      const res = await fetch(`/api/goals/${goalId}/focuses/${focusId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Relative time uses Date.now(), which differs between server SSR and
  // client hydration. Pre-mount, render a stable placeholder; post-mount,
  // render the live label.
  const lastAtLabel = mounted
    ? lastSuggestedAt
      ? formatRelative(lastSuggestedAt)
      : "never"
    : "…";

  return (
    <div className="mb-4 pb-4 border-b border-surface">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[0.6875rem] font-mono text-muted uppercase tracking-wider">
          Suggested by data{" "}
          {initialSuggestions.length > 0 && (
            <span className="text-text-secondary">({initialSuggestions.length})</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={refreshing}
          className="text-[0.75rem] font-mono text-muted hover:text-foreground disabled:opacity-50"
          title={`Last suggested: ${lastAtLabel}`}
        >
          {refreshing ? "thinking…" : "↻ refresh"}
        </button>
      </div>

      {refreshing ? (
        <div className="my-3">
          <p className="text-[0.6875rem] font-mono text-muted mb-1">
            checking your data:
          </p>
          <pre className="text-[0.6875rem] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed bg-surface/30 px-3 py-2 rounded border border-surface max-h-60 overflow-y-auto">
            {signalsBlock}
          </pre>
        </div>
      ) : initialSuggestions.length === 0 ? (
        <p className="text-[0.8125rem] text-muted py-1">
          No suggestions yet. {lastSuggestedAt ? `(last: ${lastAtLabel})` : ""} Click refresh.
        </p>
      ) : (
        <div className="space-y-2">
          {initialSuggestions.map((s) => {
            const evidence = parseEvidence(s.evidence);
            const isExpanded = expanded.has(s.id);
            return (
              <div key={s.id} className="py-1.5">
                <div className="flex items-start gap-3">
                  <span className="text-[0.625rem] font-mono uppercase text-muted px-1.5 py-0.5 border border-border rounded mt-0.5 flex-shrink-0">
                    AI
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(s.id)}
                      className="text-[0.875rem] text-left hover:text-text-secondary"
                    >
                      {s.name}
                    </button>
                    {isExpanded && evidence && (
                      <div className="mt-2 text-[0.75rem] text-text-secondary space-y-1">
                        {evidence.rationale && (
                          <p className="leading-snug">{evidence.rationale}</p>
                        )}
                        {evidence.signal_refs && evidence.signal_refs.length > 0 && (
                          <p className="font-mono text-[0.6875rem] text-muted">
                            signals: {evidence.signal_refs.join(", ")}
                          </p>
                        )}
                        {evidence.metric_trends && evidence.metric_trends.length > 0 && (
                          <ul className="text-[0.6875rem] font-mono text-muted ml-3 list-disc">
                            {evidence.metric_trends.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        patchFocus(s.id, { source: "manual" })
                      }
                      className="text-[0.6875rem] font-mono text-muted hover:text-foreground px-2 py-1"
                      title="Promote to manual focus"
                    >
                      promote
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchFocus(s.id, {
                          dismissedAt: new Date().toISOString(),
                        })
                      }
                      className="text-[0.6875rem] font-mono text-muted hover:text-foreground px-2 py-1"
                      title="Dismiss (won't be re-suggested)"
                    >
                      dismiss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mt-2 text-[0.75rem] text-red-400">{error}</div>
      )}
    </div>
  );
}

function parseEvidence(raw: string | null): ParsedEvidence | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedEvidence;
  } catch {
    return null;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
