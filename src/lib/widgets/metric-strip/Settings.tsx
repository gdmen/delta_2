"use client";

import { useState } from "react";
import type { MetricStripConfig } from "./schema";
import { metricStripSchema } from "./schema";

/**
 * PR3-era custom settings for metric_strip: raw JSON textarea. The schema
 * is array-of-objects (one cell per row), which doesn't fit ZodForm's
 * flat-object renderer. A real array editor (add/remove cells, drag to
 * reorder) lives in a future PR; for now JSON is honest and unbroken.
 *
 * On parse / schema failure, we set local error state and skip the
 * onChange call — preview keeps showing the last-good draft. The
 * `onValidityChange` callback flips the parent's gate so Save can't
 * commit while the textarea is broken.
 */
export function MetricStripSettings({
  config,
  onChange,
  onValidityChange,
}: {
  config: MetricStripConfig;
  onChange: (next: MetricStripConfig) => void;
  /** Optional gate so the SettingsDrawer disables Save on bad JSON. */
  onValidityChange?: (valid: boolean) => void;
}) {
  // The drawer remounts this component when reopening, so initial-from-config
  // happens once via the lazy useState — no effect-driven sync needed.
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
    const result = metricStripSchema.safeParse(parsed);
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
        Cells (JSON)
      </label>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full px-3 py-2 border border-border rounded text-[0.75rem] font-mono focus:outline-none focus:border-foreground bg-background"
      />
      <p className="mt-1 text-[0.75rem] text-muted">
        Each cell: <code className="font-mono">{"{ label, metric, mode, format, unit?, delta? }"}</code>.
        See the seed in <code className="font-mono">drizzle/0012_*.sql</code> for examples.
        A richer cell editor is in a future PR.
      </p>
      {error && (
        <p className="mt-1 text-[0.75rem] text-accent-red">{error}</p>
      )}
    </div>
  );
}
