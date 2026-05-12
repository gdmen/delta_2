"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

/**
 * Plain markdown <textarea> for the per-goal journal. No slash commands, no
 * rich-text editor — explicitly minimum-viable per the design doc.
 *
 * Two stickiness touches that earned their keep in design review:
 *  1. Draft auto-persists to localStorage (debounced 500ms), restored on next
 *     visit, cleared on submit. Stops "navigated away mid-thought" data loss.
 *  2. Preview toggle (button next to submit) — useful for confirming code
 *     fences and lists render as expected before you commit.
 *
 * Cmd+Enter was dropped (outside-voice review flagged as editor-creep).
 */
export function JournalEntryForm({ goalId }: { goalId: number }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  // `mounted` gates everything that depends on client-only state
  // (localStorage drafts) from feeding into the first render. Without
  // this, restoring a draft in useEffect causes React 19 + Turbopack to
  // flag a hydration mismatch on `disabled={... !content.trim()}` because
  // the server renders with an empty content assumption and the client
  // commits with the draft already populated.
  const [mounted, setMounted] = useState(false);

  const draftKey = `goal-journal-draft-${goalId}`;
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Restore draft on mount. The setMounted flip is the canonical hydration
  // gate — server renders with mounted=false so the UI matches the empty
  // pre-restore state, then the client flips to true after reading
  // localStorage. Disabling the new react-hooks rule here intentionally;
  // see https://react.dev/reference/react/useEffect for the pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved && saved.trim()) {
        setContent(saved);
        setDraftRestored(true);
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — silent fallback.
    }
    // intentionally one-shot on mount per draftKey
  }, [draftKey]);

  // Debounced persist on every keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        if (content.trim()) {
          window.localStorage.setItem(draftKey, content);
        } else {
          window.localStorage.removeItem(draftKey);
        }
      } catch {
        // ignore
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, draftKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!content.trim()) {
      setError("Entry can't be empty");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/goals/${goalId}/journal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // Clear draft + reset state, then refresh the server component to show
      // the new entry at the top of the list.
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      setContent("");
      setPreviewing(false);
      setDraftRestored(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      {draftRestored && content.trim() && (
        <div className="mb-2 inline-block text-[0.6875rem] font-mono text-muted px-2 py-0.5 border border-border rounded">
          draft restored
        </div>
      )}

      {previewing ? (
        <div className="min-h-[6rem] px-3 py-2 border border-border rounded text-[0.875rem] bg-surface/30 prose prose-invert prose-sm max-w-none">
          {content.trim() ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : (
            <p className="text-muted">Nothing to preview.</p>
          )}
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write your first entry. Even short notes compound."
          rows={3}
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem] font-sans resize-y min-h-[6rem]"
          disabled={submitting}
        />
      )}

      {error && (
        <div className="mt-2 text-[0.8125rem] text-red-400">{error}</div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPreviewing(!previewing)}
          className="text-[0.75rem] font-mono text-muted hover:text-foreground"
          disabled={submitting}
        >
          {previewing ? "← edit" : "preview →"}
        </button>
        <button
          type="submit"
          // Pre-mount the disabled state ignores `content` to match the
          // server's first-render assumption (content=""). Post-mount it
          // tracks the real (possibly draft-restored) content. handleSubmit
          // also guards empty content as a belt-and-suspenders.
          disabled={submitting || (mounted && !content.trim())}
          className="px-3 py-1.5 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Add entry"}
        </button>
      </div>
    </form>
  );
}
