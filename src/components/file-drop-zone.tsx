"use client";

import { useRef, useState } from "react";

/**
 * Large click-or-drag file picker used anywhere we upload real data
 * (BodySpec DEXA PDFs, custom CSV imports, etc). Replaces the browser's
 * default file input with something that looks intentional.
 */
export function FileDropZone({
  accept,
  multiple = false,
  primaryLabel,
  hint,
  disabled = false,
  onFiles,
  error,
}: {
  /** MIME or extension list, e.g. "application/pdf" or ".csv". */
  accept: string;
  multiple?: boolean;
  /** Main label shown in the drop zone. Caller controls wording. */
  primaryLabel: React.ReactNode;
  /** Muted one-line hint under the label (limits, file-type notes). */
  hint?: React.ReactNode;
  disabled?: boolean;
  onFiles: (files: FileList | File[]) => void;
  /** Optional inline error shown below the drop zone. */
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          // Reset so the same file can be re-selected.
          if (inputRef.current) inputRef.current.value = "";
        }}
        className="sr-only"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
        }}
        className={`block w-full py-10 px-6 border-2 border-dashed rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          dragging
            ? "border-foreground bg-surface"
            : "border-border hover:border-foreground hover:bg-surface/40"
        }`}
      >
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
            <path d="M12 3v13M12 3l-5 5M12 3l5 5M4 17v3h16v-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-[0.9375rem] font-medium">{primaryLabel}</div>
          {hint && <div className="text-[0.75rem] text-muted font-mono">{hint}</div>}
        </div>
      </button>
      {error && (
        <p className="mt-3 text-[0.8125rem] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded p-3">
          {error}
        </p>
      )}
    </div>
  );
}
