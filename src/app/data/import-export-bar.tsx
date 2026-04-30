"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface TableResult {
  accepted: number;
  skipped: number;
  updated: number;
  errors: string[];
}

type TableName =
  | "sports"
  | "metric_types"
  | "metric_type_aliases"
  | "import_sources"
  | "source_settings"
  | "goals"
  | "focuses"
  | "goal_journal_entries"
  | "metrics"
  | "events"
  | "event_metrics"
  | "workout_sets";
type ImportResponse = Partial<Record<TableName, TableResult>> & {
  error?: string;
};

interface WipeResponse {
  ok?: boolean;
  deletedCounts?: Record<string, number>;
  note?: string;
  error?: string;
}

// Inlined by Next.js's compiler for client components, so this gate
// works without prop drilling. The matching server endpoint also
// refuses in production — defence in depth.
const IS_DEV = process.env.NODE_ENV !== "production";

export function ImportExportBar() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [wiping, setWiping] = useState(false);
  const [wipeResult, setWipeResult] = useState<WipeResponse | null>(null);

  async function handleFile(file: File) {
    setState("uploading");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = (await res.json()) as ImportResponse;
      setResult(json);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    }
    setState("idle");
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

function ImportResult({ result }: { result: ImportResponse }) {
  if (result.error) {
    return (
      <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
        {result.error}
      </div>
    );
  }

  const tables: Array<[TableName, TableResult | undefined]> = [
    ["sports", result.sports],
    ["metric_types", result.metric_types],
    ["metric_type_aliases", result.metric_type_aliases],
    ["import_sources", result.import_sources],
    ["source_settings", result.source_settings],
    ["goals", result.goals],
    ["focuses", result.focuses],
    ["goal_journal_entries", result.goal_journal_entries],
    ["metrics", result.metrics],
    ["events", result.events],
    ["event_metrics", result.event_metrics],
    ["workout_sets", result.workout_sets],
  ];

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
