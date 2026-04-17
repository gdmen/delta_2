"use client";

import { useRef, useState } from "react";

interface TableResult {
  accepted: number;
  skipped: number;
  updated: number;
  errors: string[];
}

type ImportResponse = Partial<Record<"metrics" | "events" | "workout_sets", TableResult>> & {
  error?: string;
};

export function ImportExportBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const [result, setResult] = useState<ImportResponse | null>(null);

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
      </div>

      {result && <ImportResult result={result} />}

      <p className="text-[0.75rem] text-muted">
        Export bundles <code className="font-mono">metrics.csv</code>,{" "}
        <code className="font-mono">events.csv</code>, and{" "}
        <code className="font-mono">workout_sets.csv</code>. Import accepts the same shapes in a
        ZIP or any individual CSV. Re-importing the same file is a no-op.
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

  const tables: Array<["metrics" | "events" | "workout_sets", TableResult | undefined]> = [
    ["metrics", result.metrics],
    ["events", result.events],
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
