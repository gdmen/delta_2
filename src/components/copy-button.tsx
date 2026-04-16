"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API may be blocked — silently no-op */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="font-mono text-[0.6875rem] text-muted hover:text-foreground px-2 py-1 border border-border rounded"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}
