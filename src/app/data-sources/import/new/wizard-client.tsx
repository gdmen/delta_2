"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/file-drop-zone";
import { parseCsv } from "@/lib/csv";
import type { ColumnRef, ImportMapping } from "@/lib/import-mapping";
import {
  KindPicker,
  MappingEditor,
  defaultMappingForKind,
  useMetricTypeNames,
  useSportNames,
  type Kind,
} from "../_shared/mapping-editor";
import { ImportAssistantPanel } from "./assistant-panel";

interface PreviewResponse {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  autoMatch?: Record<string, ColumnRef | null>;
  parsed?: unknown[];
  parseErrors?: string[];
}

export function WizardClient() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [kind, setKind] = useState<Kind>("workout_sets");
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [distinctValuesByColumn, setDistinctValuesByColumn] = useState<Record<string, string[]>>({});
  const [name, setName] = useState("");
  const [parsed, setParsed] = useState<unknown[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const metricNames = useMetricTypeNames();
  const sportNames = useSportNames();

  async function handleFile(file: File, currentKind: Kind) {
    setCsvFile(file);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", currentKind);
    const res = await fetch("/api/import-sources/preview", { method: "POST", body: fd });
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to preview CSV");
      return;
    }
    const json = (await res.json()) as PreviewResponse;
    setPreview(json);
    setMapping(defaultMappingForKind(currentKind, json.autoMatch ?? {}));

    // Parse the file once on the client to derive distinct values per
    // column. Powers the WeightUnitEditor's exercise-name checkbox grid
    // (and any future "pick from CSV" affordances).
    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      const dv: Record<string, Set<string>> = {};
      for (const h of headers) dv[h] = new Set();
      for (const row of rows) {
        for (let i = 0; i < headers.length; i++) {
          const v = (row[i] ?? "").trim();
          if (v) dv[headers[i]].add(v);
        }
      }
      const out: Record<string, string[]> = {};
      for (const [k, set] of Object.entries(dv)) out[k] = [...set];
      setDistinctValuesByColumn(out);
    } catch {
      setDistinctValuesByColumn({});
    }
  }

  async function handleKindChange(next: Kind) {
    setKind(next);
    if (csvFile) {
      const fd = new FormData();
      fd.append("file", csvFile);
      fd.append("kind", next);
      const res = await fetch("/api/import-sources/preview", { method: "POST", body: fd });
      const json = (await res.json()) as PreviewResponse;
      setPreview(json);
      setMapping(defaultMappingForKind(next, json.autoMatch ?? {}));
    }
  }

  const previewWithMapping = useCallback(
    async (m: ImportMapping) => {
      if (!csvFile) return;
      const fd = new FormData();
      fd.append("file", csvFile);
      fd.append("mapping", JSON.stringify(m));
      const res = await fetch("/api/import-sources/preview", { method: "POST", body: fd });
      if (!res.ok) return;
      const json = (await res.json()) as PreviewResponse;
      setParsed(json.parsed ?? null);
      setParseErrors(json.parseErrors ?? []);
    },
    [csvFile]
  );

  function updateMapping(m: ImportMapping) {
    setMapping(m);
    void previewWithMapping(m);
  }

  async function save() {
    if (!mapping || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/import-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, mapping }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to save");
        setSaving(false);
        return;
      }
      if (csvFile) {
        const fd = new FormData();
        fd.append("file", csvFile);
        await fetch(`/api/import-sources/${json.id}/import`, { method: "POST", body: fd });
      }
      router.push(`/data-sources/import/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  // -- Step 1: no file yet ----------------------------------------------------

  if (!csvFile || !preview || !mapping) {
    return (
      <div className="space-y-6">
        <KindPicker kind={kind} onChange={setKind} />
        <FileDropZone
          accept=".csv"
          primaryLabel={
            <>
              Click to choose a CSV <span className="text-muted font-normal">or drag it here</span>
            </>
          }
          hint="Your rows are imported on save; the mapping is saved for reuse"
          onFiles={(files) => {
            const f = files instanceof FileList ? files[0] : files[0];
            if (f) void handleFile(f, kind);
          }}
          error={error}
        />
      </div>
    );
  }

  // -- Step 2: mapping editor + chat assistant --------------------------------

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 space-y-8">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">File</span>
          <span className="text-[0.875rem]">{csvFile.name}</span>
          <span className="font-mono text-[0.6875rem] text-muted">{preview.totalRows} rows</span>
          <button
            onClick={() => {
              setCsvFile(null);
              setPreview(null);
              setMapping(null);
              setParsed(null);
            }}
            className="text-[0.75rem] text-muted hover:text-foreground"
          >
            Change file
          </button>
        </div>

        <KindPicker kind={kind} onChange={handleKindChange} />

        <MappingEditor
          kind={kind}
          mapping={mapping}
          headers={preview.headers}
          onChange={updateMapping}
          metricNameSuggestions={metricNames}
          sportSuggestions={sportNames}
          distinctValuesByColumn={distinctValuesByColumn}
        />

        <section>
          <h3 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted mb-3">
            Preview - first 5 parsed rows
          </h3>
          {parsed === null ? (
            <p className="text-[0.8125rem] text-muted">Adjust mapping to see parsed output.</p>
          ) : parsed.length === 0 ? (
            <p className="text-[0.8125rem] text-accent-red">No rows parsed successfully.</p>
          ) : (
            <pre className="text-[0.75rem] font-mono bg-surface rounded p-3 overflow-x-auto max-h-80">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          )}
          {parseErrors.length > 0 && (
            <div className="mt-3 text-[0.75rem] text-accent-red space-y-1">
              {parseErrors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </section>

        <section className="border-t border-border pt-6">
          <label className="block text-[0.8125rem] font-semibold mb-2">Save as</label>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. TeamBuildr"
              className="flex-1 min-w-[200px] px-3 py-2 border border-border rounded text-[0.875rem]"
            />
            <button
              onClick={save}
              disabled={!name.trim() || saving}
              className="px-5 py-2 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving & importing..." : "Save & import"}
            </button>
          </div>
          {error && (
            <div className="mt-3 p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
              {error}
            </div>
          )}
        </section>
      </div>

      <ImportAssistantPanel
        headers={preview.headers}
        sampleRows={preview.sampleRows}
        totalRows={preview.totalRows}
        kind={kind}
        currentMapping={mapping}
        metricTypes={metricNames}
        sports={sportNames}
        onApplyMapping={(m) => {
          // Trust the model to return a valid mapping. Keeping kind in sync
          // with the applied mapping's kind saves the user a click if
          // Claude decided a different kind fits better.
          if (m.kind && m.kind !== kind) setKind(m.kind);
          updateMapping(m);
        }}
      />
    </div>
  );
}
