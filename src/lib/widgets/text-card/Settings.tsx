"use client";

import { useState } from "react";
import type { TextCardConfig } from "./schema";

/**
 * Simple textarea editor for the markdown body. ZodForm's auto-generator
 * uses a single-line `<input type="text">` for string fields, which is
 * wrong for paragraph content — hence the custom override.
 */
export function TextCardSettings({
  config,
  onChange,
}: {
  config: TextCardConfig;
  onChange: (next: TextCardConfig) => void;
}) {
  const [body, setBody] = useState(config.body);

  return (
    <div>
      <label className="block text-[0.8125rem] font-medium mb-1">Markdown body</label>
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          onChange({ body: e.target.value });
        }}
        rows={12}
        spellCheck
        className="w-full px-3 py-2 border border-border rounded text-[0.875rem] font-mono focus:outline-none focus:border-foreground bg-background"
        placeholder="# Notes&#10;&#10;Write anything. Markdown is supported."
      />
      <p className="mt-1 text-[0.75rem] text-muted">
        HTML tags are stripped at render. Markdown-only formatting. Capped
        at 4KB by the config size limit (~600 words).
      </p>
    </div>
  );
}
