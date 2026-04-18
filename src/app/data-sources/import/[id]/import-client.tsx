"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/file-drop-zone";

interface TableResult {
  accepted: number;
  skipped: number;
  updated: number;
  errors: string[];
}

export function ImportClient({ sourceId, sourceName }: { sourceId: number; sourceName: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const [result, setResult] = useState<{ kind?: string; result?: TableResult; error?: string } | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const file = files instanceof FileList ? files[0] : files[0];
    if (!file) return;
    setState("uploading");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/import-sources/${sourceId}/import`, { method: "POST", body: fd });
      const json = await res.json();
      setResult(json);
      if (res.ok) router.refresh();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    }
    setState("idle");
  }

  return (
    <div className="space-y-4">
      <FileDropZone
        accept=".csv"
        primaryLabel={
          state === "uploading" ? (
            "Importing..."
          ) : (
            <>
              Click to choose a {sourceName} CSV <span className="text-muted font-normal">or drag it here</span>
            </>
          )
        }
        hint="Uses the saved mapping; re-uploading the same file is a safe no-op"
        disabled={state === "uploading"}
        onFiles={handleFiles}
        error={result?.error ?? null}
      />

      {result?.result && (
        <div className="p-3 bg-surface border border-border rounded text-[0.8125rem] font-mono space-y-1">
          <div>
            <span className="font-semibold">{result.kind}</span>:{" "}
            <span className="text-accent-green">accepted {result.result.accepted}</span>
            {" · "}
            <span className="text-text-secondary">skipped {result.result.skipped}</span>
            {result.result.updated > 0 && (
              <>
                {" · "}
                <span className="text-text-secondary">updated {result.result.updated}</span>
              </>
            )}
            {result.result.errors.length > 0 && (
              <>
                {" · "}
                <span className="text-accent-red">errors {result.result.errors.length}</span>
              </>
            )}
          </div>
          {result.result.errors.slice(0, 5).map((e, i) => (
            <div key={i} className="text-accent-red break-words">{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
