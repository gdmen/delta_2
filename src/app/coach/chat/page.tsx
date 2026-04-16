"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ToolInvocation {
  name: string;
  input: Record<string, unknown>;
  result: { ok: boolean } & Record<string, unknown>;
}

interface AssistantResponse {
  reply: string;
  toolInvocations: ToolInvocation[];
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastToolInvocations, setLastToolInvocations] = useState<ToolInvocation[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = (await res.json()) as AssistantResponse & { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Chat request failed");
      } else {
        setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
        setLastToolInvocations(data.toolInvocations ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const creationInvocations = lastToolInvocations.filter(
    (t) => t.name === "create_focus" || t.name === "create_goal"
  );

  return (
    <div className="max-w-[820px] flex flex-col h-[calc(100vh-4rem)] md:h-[calc(100vh-4rem)]">
      <div className="mb-4 pb-3 border-b border-border">
        <h1 className="text-2xl font-semibold">Coach Chat</h1>
        <p className="text-[0.8125rem] text-muted mt-1">
          Talk through your goals and focuses. The coach can create them for you once you&apos;ve agreed on the details.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="text-[0.875rem] text-muted py-6">
            <p className="mb-3">Start by telling the coach what you want to work on. Examples:</p>
            <ul className="space-y-1.5 pl-4 list-disc marker:text-border">
              <li>&quot;I want to hit 500 deadlift by April 2027.&quot;</li>
              <li>&quot;Help me plan a focus for cross-face defense in BJJ.&quot;</li>
              <li>&quot;What should I be working on this training block?&quot;</li>
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-[0.8125rem] text-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
            Thinking...
          </div>
        )}

        {creationInvocations.length > 0 && !sending && (
          <div className="text-[0.75rem] font-mono text-accent-green">
            {creationInvocations.map((t, i) => (
              <div key={i}>
                ✓ {t.name === "create_focus" ? "Created focus" : "Created goal"}: {JSON.stringify(t.result.data ?? {})}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-[0.8125rem] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded p-3">
            {error}
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSend} className="mt-4 pt-4 border-t border-border flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the coach anything..."
          disabled={sending}
          className="flex-1 px-3 py-2.5 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="px-5 py-2.5 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-lg text-[0.875rem] leading-[1.6] whitespace-pre-wrap ${
          isUser
            ? "bg-foreground text-background"
            : "bg-surface text-foreground"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
