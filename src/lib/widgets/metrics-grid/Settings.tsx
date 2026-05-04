"use client";

import { useState } from "react";
import { metricsGridSchema, type MetricsGridConfig } from "./schema";

/**
 * Array-of-objects settings: JSON textarea with live validation. Same
 * pattern as metric_strip — a real per-cell editor (drag to reorder, add
 * via metric picker) is a future PR. JSON is honest and unbroken until then.
 */
export function MetricsGridSettings({
  config,
  onChange,
  onValidityChange,
}: {
  config: MetricsGridConfig;
  onChange: (next: MetricsGridConfig) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  function handleChange(value: string) {
    setText(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON.");
      onValidityChange?.(false);
      return;
    }
    const result = metricsGridSchema.safeParse(parsed);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Schema validation failed.");
      onValidityChange?.(false);
      return;
    }
    setError(null);
    onValidityChange?.(true);
    onChange(result.data);
  }

  return (
    <div>
      <label className="block text-[0.8125rem] font-medium mb-1">
        Grid (JSON)
      </label>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={16}
        spellCheck={false}
        className="w-full px-3 py-2 border border-border rounded text-[0.75rem] font-mono focus:outline-none focus:border-foreground bg-background"
      />
      <p className="mt-1 text-[0.75rem] text-muted">
        Shape: <code className="font-mono">{"{ title, columns: 1|2, metrics: [{ metric, title?, fallbackUnit, target?, windowDays? }, ...] }"}</code>.
        Up to 12 metrics. All charts share a time axis.
      </p>
      {error && (
        <p className="mt-1 text-[0.75rem] text-accent-red">{error}</p>
      )}
    </div>
  );
}
