"use client";

import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/wordmark";
import type { ImportMapping } from "@/lib/import-mapping";
import type { Kind } from "../_shared/mapping-editor";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  proposedMapping?: ImportMapping;
}

/**
 * Side panel: chat with Delta about mapping a specific CSV onto the Delta
 * data model. Claude sees headers + sample rows + current mapping and
 * either asks clarifying questions or proposes a full mapping JSON the
 * user can one-click apply. Lives next to the wizard so users see the
 * preview update immediately on Apply.
 */
export function ImportAssistantPanel({
  headers,
  sampleRows,
  totalRows,
  kind,
  currentMapping,
  metricTypes,
  sports,
  onApplyMapping,
}: {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  kind: Kind;
  currentMapping: ImportMapping | null;
  metricTypes: string[];
  sports: string[];
  onApplyMapping: (m: ImportMapping) => void;
}) {
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, sending]);

  async function send(userText: string) {
    setError(null);
    const next: ChatMsg[] = [...msgs, { role: "user", content: userText }];
    setMsgs(next);
    setSending(true);
    try {
      const res = await fetch("/api/import-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: { headers, sampleRows, totalRows },
          kind,
          currentMapping,
          metricTypes,
          sports,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Chat failed");
      } else {
        setMsgs((prev) => [
          ...prev,
          {
            role: "assistant",
            content: json.reply,
            proposedMapping: json.proposedMapping,
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSending(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sticky top-4 self-start px-3 py-2 border border-border rounded text-[0.8125rem] hover:bg-surface"
      >
        Ask <Wordmark /> about this CSV →
      </button>
    );
  }

  return (
    <aside className="sticky top-4 self-start w-full lg:w-[380px] flex-shrink-0 border border-border rounded bg-background flex flex-col max-h-[calc(100vh-4rem)]">
      <div className="flex items-baseline justify-between px-4 py-2 border-b border-border">
        <span className="text-[0.8125rem] font-semibold">
          Ask <Wordmark /> about this CSV
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[0.75rem] text-muted hover:text-foreground"
        >
          Hide
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px]">
        {msgs.length === 0 && (
          <div className="text-[0.8125rem] text-muted">
            I&apos;ve got your headers + sample rows. Ask me to propose a mapping, or describe
            what this CSV is. I&apos;ll suggest a full mapping you can apply with one click.
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`text-[0.8125rem] ${
              m.role === "user" ? "text-foreground" : "text-text-secondary"
            }`}
          >
            <div className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-1">
              {m.role === "user" ? "you" : "delta"}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
            {m.proposedMapping && (
              <button
                type="button"
                onClick={() => onApplyMapping(m.proposedMapping!)}
                className="mt-2 px-3 py-1.5 bg-foreground text-background text-[0.75rem] font-medium rounded hover:opacity-90"
              >
                Apply this mapping
              </button>
            )}
          </div>
        ))}
        {sending && (
          <div className="text-[0.75rem] text-muted italic">thinking…</div>
        )}
        {error && (
          <div className="text-[0.75rem] text-accent-red">{error}</div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = input.trim();
          if (!t || sending) return;
          setInput("");
          void send(t);
        }}
        className="flex gap-2 px-3 py-2 border-t border-border"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. 'this is a Peloton history export'"
          className="flex-1 px-2 py-1.5 border border-border rounded text-[0.8125rem]"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="px-3 py-1.5 bg-foreground text-background text-[0.75rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
