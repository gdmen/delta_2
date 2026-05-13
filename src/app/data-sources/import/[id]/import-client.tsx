"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/file-drop-zone";
import { ProgressBar } from "@/components/progress-bar";
import { parseSseFrames } from "@/lib/sse-stream";

interface TableResult {
  accepted: number;
  skipped: number;
  updated: number;
  errors: string[];
}

interface DoneEvent {
  kind: string;
  result: TableResult;
  reconcile?: unknown;
}

export function ImportClient({ sourceId, sourceName }: { sourceId: number; sourceName: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [rowsProcessed, setRowsProcessed] = useState(0);
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const file = files instanceof FileList ? files[0] : files[0];
    if (!file) return;
    setState("uploading");
    setTotalRows(null);
    setRowsProcessed(0);
    setDone(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/import-sources/${sourceId}/import`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok || !res.body) {
        // Setup error: server returns plain JSON before opening the
        // SSE stream (auth, missing source, wrong file type).
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${res.status}`);
        setState("idle");
        return;
      }
      // Stream of SSE frames: start -> progress* -> done | error.
      for await (const frame of parseSseFrames(res.body)) {
        if (frame.event === "start") {
          setTotalRows((frame.data as { totalRows: number }).totalRows);
        } else if (frame.event === "progress") {
          setRowsProcessed((frame.data as { rowsProcessed: number }).rowsProcessed);
        } else if (frame.event === "done") {
          setDone(frame.data as DoneEvent);
        } else if (frame.event === "error") {
          setError((frame.data as { message: string }).message);
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setState("idle");
  }

  const uploading = state === "uploading";
  // While we're streaming, prefer rowsProcessed; clamp at totalRows so
  // the bar visually stays at 100% after the last progress event.
  const pct = totalRows && totalRows > 0
    ? Math.min(100, Math.round((rowsProcessed / totalRows) * 100))
    : 0;

  return (
    <div className="space-y-4">
      <FileDropZone
        accept=".csv"
        primaryLabel={
          uploading ? (
            "Importing..."
          ) : (
            <>
              Click to choose a {sourceName} CSV <span className="text-muted font-normal">or drag it here</span>
            </>
          )
        }
        hint="Uses the saved mapping; re-uploading the same file is a safe no-op"
        disabled={uploading}
        onFiles={handleFiles}
        error={error}
      />

      {/* Live progress while streaming. Sticks around after `done` so
          the user can see the final count without it being replaced
          immediately by the summary panel below. */}
      {(uploading || totalRows !== null) && (
        <div className="space-y-2">
          <ProgressBar value={rowsProcessed} max={totalRows ?? 1} />
          <div className="font-mono text-[0.75rem] text-muted flex justify-between">
            <span>
              {totalRows === null
                ? "Parsing CSV…"
                : `${rowsProcessed.toLocaleString()} of ${totalRows.toLocaleString()} rows`}
            </span>
            <span>{totalRows !== null && `${pct}%`}</span>
          </div>
        </div>
      )}

      {done && (
        <div className="p-3 bg-surface border border-border rounded text-[0.8125rem] font-mono space-y-1">
          <div>
            <span className="font-semibold">{done.kind}</span>:{" "}
            <span className="text-accent-green">accepted {done.result.accepted}</span>
            {" · "}
            <span className="text-text-secondary">skipped {done.result.skipped}</span>
            {done.result.updated > 0 && (
              <>
                {" · "}
                <span className="text-text-secondary">updated {done.result.updated}</span>
              </>
            )}
            {done.result.errors.length > 0 && (
              <>
                {" · "}
                <span className="text-accent-red">errors {done.result.errors.length}</span>
              </>
            )}
          </div>
          {done.result.errors.slice(0, 5).map((e, i) => (
            <div key={i} className="text-accent-red break-words">{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
