"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseSseFrames } from "@/lib/sse-stream";
import { ProgressBar } from "@/components/progress-bar";
import {
  IMPORT_TABLES,
  type ImportDoneFrame,
  type ImportPhaseFrame,
  type ImportPhaseProgressFrame,
  type ImportStartFrame,
  type ImportTable,
  type ImportTableResult,
} from "@/lib/import/sse-frames";

// Re-exports for the local file's existing usage. IMPORT_TABLES doubles
// as the display order in the result panel — single source of truth
// with the server's PIPELINE_ORDER.
type TableName = ImportTable;
type TableResult = ImportTableResult;
const TABLE_ORDER = IMPORT_TABLES;

type ImportResponse = Partial<Record<TableName, TableResult>> & {
  error?: string;
};

interface WipeResponse {
  ok?: boolean;
  deletedCounts?: Record<string, number>;
  note?: string;
  error?: string;
}

interface PhaseInfo {
  /** 0-indexed position in the pipeline. */
  index: number;
  total: number;
  table: TableName;
  /** Rows imported in the current phase. */
  rowsDone: number;
  /** Total rows in the current phase. */
  rowTotal: number;
  /** Cumulative rows across all phases so far (including current). */
  cumulativeRowsDone: number;
  /** Sum of rowTotal across every phase in this upload. */
  totalRows: number;
}

// Inlined by Next.js's compiler for client components, so this gate
// works without prop drilling. The matching server endpoint also
// refuses in production — defence in depth.
const IS_DEV = process.env.NODE_ENV !== "production";

export function ImportExportBar() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const [phase, setPhase] = useState<PhaseInfo | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [wiping, setWiping] = useState(false);
  const [wipeResult, setWipeResult] = useState<WipeResponse | null>(null);

  async function handleFile(file: File) {
    setState("uploading");
    setResult(null);
    setPhase(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });

      // Auth + setup errors come back as JSON (pre-stream). Everything
      // else is SSE. Branch on Content-Type so we can show the inline
      // error banner for the JSON path without trying to parse it as
      // SSE.
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.startsWith("text/event-stream")) {
        const json = (await res.json()) as ImportResponse;
        setResult(json);
        setState("idle");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      if (!res.body) {
        setResult({ error: "Empty response body" });
        setState("idle");
        return;
      }

      // Frames typed via the shared ImportXFrame interfaces; the `as`
      // casts are bounded by the event-name switch, so a server-side
      // shape change shows up as a type error in this file too.
      //
      // We track `priorPhasesRows` (sum of rowTotal for completed
      // phases) locally so the bar can be denominated in total rows
      // across the whole upload — gives a smooth, predictable rate
      // through long phases instead of equal-width-per-phase jumps.
      let totalPhases = 0;
      let totalRows = 0;
      let priorPhasesRows = 0;
      const accumulated: ImportResponse = {};
      for await (const frame of parseSseFrames(res.body)) {
        if (frame.event === "start") {
          const data = frame.data as ImportStartFrame;
          totalPhases = data.totalPhases;
          totalRows = data.totalRows;
        } else if (frame.event === "phase") {
          const data = frame.data as ImportPhaseFrame;
          const rowsDone = data.done ? data.rowTotal : 0;
          setPhase({
            index: data.index,
            total: data.total,
            table: data.table,
            rowsDone,
            rowTotal: data.rowTotal,
            cumulativeRowsDone: priorPhasesRows + rowsDone,
            totalRows,
          });
          if (data.done) {
            priorPhasesRows += data.rowTotal;
            if (data.result) accumulated[data.table] = data.result;
          }
        } else if (frame.event === "phase-progress") {
          const data = frame.data as ImportPhaseProgressFrame;
          setPhase({
            index: data.index,
            total: data.total,
            table: data.table,
            rowsDone: data.rowsDone,
            rowTotal: data.rowTotal,
            cumulativeRowsDone: priorPhasesRows + data.rowsDone,
            totalRows,
          });
        } else if (frame.event === "done") {
          setResult((frame.data as ImportDoneFrame).result);
        } else if (frame.event === "error") {
          const data = frame.data as { message: string };
          setResult({ error: data.message });
        }
      }
      // Stream ended without a done frame — fall back to whatever we
      // accumulated. Should rarely happen; the server's makeSseStream
      // catches all errors.
      if (!result && totalPhases > 0) {
        setResult(accumulated);
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    }
    setState("idle");
    setPhase(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleWipe() {
    const confirmed = window.confirm(
      "Wipe ALL local data?\n\nDeletes every row from sports, metric_types, " +
        "metrics, events, workout_sets, goals, focuses, journal entries, " +
        "and the LLM call log. Ingest API keys (Strava / Apple Health) are " +
        "preserved.\n\nThis cannot be undone. Proceed?",
    );
    if (!confirmed) return;
    setWiping(true);
    setWipeResult(null);
    try {
      const res = await fetch("/api/dev/wipe-data", { method: "POST" });
      const json = (await res.json()) as WipeResponse;
      if (!res.ok) {
        setWipeResult({ error: json.error ?? `HTTP ${res.status}` });
      } else {
        setWipeResult(json);
        // Refresh the page so all the now-empty tables re-query.
        router.refresh();
      }
    } catch (err) {
      setWipeResult({ error: err instanceof Error ? err.message : String(err) });
    }
    setWiping(false);
  }

  return (
    <div className="mb-8 flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <a
          href="/api/export"
          className="px-4 py-2 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface"
        >
          Export all data (ZIP)
        </a>
        <a
          href="/api/export?manual=true"
          className="px-4 py-2 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface"
          title="Metrics + events you typed in by hand, plus goals, focuses, dashboards. Re-importable after a wipe to restore the manually-entered slice."
        >
          Export manual only (ZIP)
        </a>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={state === "uploading"}
          className="px-4 py-2 border border-border rounded text-[0.8125rem] font-medium hover:bg-surface disabled:opacity-50"
        >
          {state === "uploading" ? "Importing…" : "Import CSV / ZIP"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.zip"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        {IS_DEV && (
          <button
            type="button"
            onClick={handleWipe}
            disabled={wiping}
            className="ml-auto px-4 py-2 border border-accent-red/40 text-accent-red rounded text-[0.8125rem] font-medium hover:bg-accent-red/10 disabled:opacity-50"
            title="Development only — refuses in production"
          >
            {wiping ? "Wiping…" : "DEV: Wipe local data"}
          </button>
        )}
      </div>

      {state === "uploading" && phase && <ImportProgress phase={phase} />}

      {result && <ImportResult result={result} />}

      {wipeResult && <WipeResult result={wipeResult} />}

      <p className="text-[0.75rem] text-muted">
        Export bundles everything needed to recreate the app from scratch:
        foundational catalog (<code className="font-mono">sports</code>,{" "}
        <code className="font-mono">metric_types</code>,{" "}
        <code className="font-mono">metric_type_aliases</code>,{" "}
        <code className="font-mono">import_sources</code>,{" "}
        <code className="font-mono">source_settings</code>), targets
        (<code className="font-mono">goals</code>,{" "}
        <code className="font-mono">focuses</code>,{" "}
        <code className="font-mono">goal_journal_entries</code>), and measured data
        (<code className="font-mono">metrics</code>,{" "}
        <code className="font-mono">events</code>,{" "}
        <code className="font-mono">event_metrics</code>,{" "}
        <code className="font-mono">workout_sets</code>). Import accepts the
        same shapes in a ZIP or any individual CSV. Re-importing the same
        file is a no-op. Strava/Apple Health tokens must be re-connected
        after a wipe+restore.
      </p>
    </div>
  );
}

/**
 * Progress bar + status line. The bar is denominated in cumulative
 * rows-of-work across the whole upload (not 1/N per phase), so it
 * fills at a roughly constant rate — a 3-row sports phase doesn't
 * claim the same width as a 38K-row metrics phase. Status line
 * carries per-phase context.
 */
function ImportProgress({ phase }: { phase: PhaseInfo }) {
  // All moving signal stays in one eye-line so the bar feels alive at
  // any viewport width. Earlier flex-justify-between layout pinned the
  // row count to the far right and looked stuck on wide screens.
  return (
    <div className="p-3 bg-surface border border-border rounded space-y-2">
      <ProgressBar
        value={phase.cumulativeRowsDone}
        max={Math.max(1, phase.totalRows)}
      />
      {/* Counter matches the bar's denominator (cumulative rows across
          the upload), not per-phase. Otherwise the numerator jumps
          0 → N → 0 → M on every phase transition while the bar moves
          smoothly — two pieces of signal denominated differently feels
          jerky. */}
      <div className="font-mono text-[0.75rem] text-muted">
        Importing <span className="text-foreground">{phase.table}</span>
        {" "}({phase.index + 1} of {phase.total})
        {phase.totalRows > 0 && (
          <>
            {" · "}
            <span className="tabular-nums">
              {phase.cumulativeRowsDone.toLocaleString()} / {phase.totalRows.toLocaleString()} rows
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function ImportResult({ result }: { result: ImportResponse }) {
  if (result.error) {
    return (
      <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
        {result.error}
      </div>
    );
  }

  const tables = TABLE_ORDER.map(
    (name) => [name, result[name]] as const,
  ).filter(([, r]) => r !== undefined);

  return (
    <div className="p-3 bg-surface border border-border rounded text-[0.8125rem] font-mono space-y-1">
      {tables.map(([name, r]) =>
        r ? (
          <div key={name}>
            <span className="font-semibold">{name}</span>:{" "}
            <span className="text-accent-green">accepted {r.accepted}</span>
            {" · "}
            <span className="text-text-secondary">skipped {r.skipped}</span>
            {r.updated > 0 && (
              <>
                {" · "}
                <span className="text-text-secondary">updated {r.updated}</span>
              </>
            )}
            {r.errors.length > 0 && (
              <>
                {" · "}
                <span className="text-accent-red">errors {r.errors.length}</span>
              </>
            )}
          </div>
        ) : null
      )}
      {tables.flatMap(([, r]) => r?.errors ?? []).slice(0, 5).map((e, i) => (
        <div key={i} className="text-accent-red break-words">
          {e}
        </div>
      ))}
    </div>
  );
}

function WipeResult({ result }: { result: WipeResponse }) {
  if (result.error) {
    return (
      <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
        Wipe failed: {result.error}
      </div>
    );
  }
  const counts = result.deletedCounts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return (
    <div className="p-3 bg-accent-orange/10 border border-accent-orange/20 rounded text-[0.8125rem] font-mono">
      <div className="font-semibold mb-1">
        Wiped {total.toLocaleString()} rows across {Object.keys(counts).length}{" "}
        tables.
      </div>
      <div className="text-text-secondary">
        {Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([t, n]) => `${t} ${n}`)
          .join(" · ") || "(everything was already empty)"}
      </div>
      {result.note && (
        <div className="text-[0.6875rem] text-muted mt-1">{result.note}</div>
      )}
    </div>
  );
}
