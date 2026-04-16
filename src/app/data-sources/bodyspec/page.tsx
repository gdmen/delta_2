"use client";

import { useState, useRef } from "react";
import Link from "next/link";

interface Extracted {
  scan_date: string | null;
  body_weight_lb: number | null;
  body_fat_pct: number | null;
  lean_mass_lb: number | null;
  fat_mass_lb: number | null;
  bone_mineral_density: number | null;
  visceral_fat_lb: number | null;
  notes: string | null;
}

type Status = "idle" | "extracting" | "review" | "saving" | "saved" | "error";

export default function BodySpecUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [data, setData] = useState<Extracted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<{ saved: string[]; skipped: string[]; errors: string[] } | null>(null);

  async function handleFile(file: File) {
    setStatus("extracting");
    setError(null);
    setSaveResult(null);
    setFileName(file.name);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/ingest/bodyspec-dexa/extract", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Extraction failed");
        setStatus("error");
        return;
      }
      setData(json.extracted as Extracted);
      setStatus("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  function updateField<K extends keyof Extracted>(key: K, value: Extracted[K]) {
    if (!data) return;
    setData({ ...data, [key]: value });
  }

  async function handleSave() {
    if (!data || !data.scan_date) {
      setError("scan_date is required");
      return;
    }
    setStatus("saving");
    try {
      const res = await fetch("/api/ingest/bodyspec-dexa/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Save failed");
        setStatus("error");
        return;
      }
      setSaveResult({ saved: json.saved, skipped: json.skipped, errors: json.errors });
      setStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  function reset() {
    setStatus("idle");
    setFileName(null);
    setData(null);
    setError(null);
    setSaveResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Data Sources
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">BodySpec DEXA</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Upload one BodySpec DEXA scan PDF at a time. Claude Haiku extracts the key numbers from the report. You review
        and edit each value before saving — LLMs hallucinate, so always verify against the PDF.
      </p>

      {status === "idle" || status === "error" ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="block text-[0.875rem]"
          />
          {error && (
            <p className="mt-3 text-[0.8125rem] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded p-3">
              {error}
            </p>
          )}
        </div>
      ) : null}

      {status === "extracting" && (
        <div className="flex items-center gap-2 text-[0.875rem] text-muted py-6">
          <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
          Extracting data from {fileName}...
        </div>
      )}

      {status === "review" && data && (
        <div>
          <div className="mb-4 text-[0.8125rem] text-muted">
            Extracted from <span className="font-mono text-foreground">{fileName}</span>. Verify each value against the PDF.
          </div>

          <div className="space-y-4 mb-6">
            <Field label="Scan Date" unit="YYYY-MM-DD">
              <input
                type="date"
                value={data.scan_date ?? ""}
                onChange={(e) => updateField("scan_date", e.target.value)}
                className="font-mono text-[0.9375rem] px-3 py-2 border border-border rounded focus:outline-none focus:border-foreground"
              />
            </Field>
            <NumField label="Body Weight" unit="lb" value={data.body_weight_lb} onChange={(v) => updateField("body_weight_lb", v)} />
            <NumField label="Body Fat" unit="%" value={data.body_fat_pct} onChange={(v) => updateField("body_fat_pct", v)} />
            <NumField label="Lean Mass" unit="lb" value={data.lean_mass_lb} onChange={(v) => updateField("lean_mass_lb", v)} />
            <NumField label="Fat Mass" unit="lb" value={data.fat_mass_lb} onChange={(v) => updateField("fat_mass_lb", v)} />
            <NumField label="Bone Mineral Density" unit="g/cm²" value={data.bone_mineral_density} onChange={(v) => updateField("bone_mineral_density", v)} />
            <NumField label="Visceral Fat" unit="lb" value={data.visceral_fat_lb} onChange={(v) => updateField("visceral_fat_lb", v)} />
          </div>

          {data.notes && (
            <div className="mb-6 p-3 bg-surface rounded text-[0.8125rem] text-text-secondary">
              <div className="text-[0.6875rem] text-muted uppercase tracking-wider font-semibold mb-1">Notes from report</div>
              {data.notes}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={!data.scan_date}
              className="px-5 py-2 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
            >
              Save to Delta
            </button>
            <button onClick={reset} className="px-4 py-2 text-[0.875rem] text-muted hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === "saving" && (
        <div className="flex items-center gap-2 text-[0.875rem] text-muted py-6">
          <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
          Saving...
        </div>
      )}

      {status === "saved" && saveResult && (
        <div>
          <div className="mb-4 p-3 bg-accent-green/10 border border-accent-green/20 rounded">
            <div className="text-[0.8125rem] font-semibold text-accent-green mb-2">✓ Saved</div>
            <div className="text-[0.8125rem] text-text-secondary space-y-1">
              {saveResult.saved.length > 0 && (
                <div>
                  <span className="font-mono text-muted">saved:</span> {saveResult.saved.join(", ")}
                </div>
              )}
              {saveResult.skipped.length > 0 && (
                <div>
                  <span className="font-mono text-muted">skipped:</span> {saveResult.skipped.join(", ")}
                </div>
              )}
              {saveResult.errors.length > 0 && (
                <div className="text-accent-red">
                  <span className="font-mono">errors:</span> {saveResult.errors.join("; ")}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={reset}
            className="px-5 py-2 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90"
          >
            Upload another scan
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, unit, children }: { label: string; unit: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <label className="w-44 flex-shrink-0">
        <div className="text-[0.8125rem] font-medium">{label}</div>
        <div className="font-mono text-[0.6875rem] text-muted">{unit}</div>
      </label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <Field label={label} unit={unit}>
      <input
        type="number"
        step="any"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          const str = e.target.value;
          onChange(str === "" ? null : parseFloat(str));
        }}
        className="font-mono text-[0.9375rem] px-3 py-2 border border-border rounded w-full max-w-[200px] focus:outline-none focus:border-foreground"
      />
    </Field>
  );
}
