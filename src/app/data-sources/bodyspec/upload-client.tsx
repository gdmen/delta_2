"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

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

interface SaveResult {
  saved: string[];
  skipped: string[];
  errors: string[];
}

type ItemStatus =
  | "pending"    // not yet extracted
  | "extracting" // in-flight extract request
  | "ready"      // extraction done, awaiting user review
  | "saving"     // save in flight
  | "saved"      // user saved, data is in DB
  | "skipped"    // user skipped without saving
  | "error";     // extraction or save failed

interface QueueItem {
  id: string;
  file: File;
  fileName: string;
  pdfUrl: string;
  status: ItemStatus;
  extracted: Extracted | null;
  error: string | null;
  saveResult: SaveResult | null;
}

const MAX_FILES = 20;

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function BodySpecUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Revoke blob URLs on unmount.
  useEffect(() => {
    return () => {
      queue.forEach((item) => URL.revokeObjectURL(item.pdfUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run extraction for one item. Uses functional setState so concurrent calls
  // (from the lookahead prefetch) don't clobber each other.
  const extractItem = useCallback(async (id: string, file: File) => {
    setQueue((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status: "extracting", error: null } : it))
    );

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/ingest/bodyspec-dexa/extract", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setQueue((prev) =>
          prev.map((it) =>
            it.id === id ? { ...it, status: "error", error: json.error ?? "Extraction failed" } : it
          )
        );
        return;
      }
      setQueue((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, status: "ready", extracted: json.extracted as Extracted } : it
        )
      );
    } catch (err) {
      setQueue((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, status: "error", error: err instanceof Error ? err.message : String(err) }
            : it
        )
      );
    }
  }, []);

  // Lookahead: when active moves, make sure the current and next items are
  // being (or have been) extracted. O(1) work per activeIndex change.
  useEffect(() => {
    if (queue.length === 0) return;
    const ensure = (i: number) => {
      if (i >= 0 && i < queue.length && queue[i].status === "pending") {
        void extractItem(queue[i].id, queue[i].file);
      }
    };
    ensure(activeIndex);
    ensure(activeIndex + 1);
  }, [activeIndex, queue, extractItem]);

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const pdfs = arr.filter((f) => f.type === "application/pdf");
    const rejected = arr.length - pdfs.length;

    if (pdfs.length === 0) {
      setPickerError("No PDFs selected. Please choose BodySpec DEXA scan PDFs.");
      return;
    }
    if (pdfs.length > MAX_FILES) {
      setPickerError(`Too many files. Maximum ${MAX_FILES} at a time.`);
      return;
    }

    setPickerError(
      rejected > 0 ? `${rejected} file${rejected > 1 ? "s" : ""} skipped (not PDF).` : null
    );

    const items: QueueItem[] = pdfs.map((file) => ({
      id: makeId(),
      file,
      fileName: file.name,
      pdfUrl: URL.createObjectURL(file),
      status: "pending",
      extracted: null,
      error: null,
      saveResult: null,
    }));

    setQueue(items);
    setActiveIndex(0);
  }

  function updateActiveField<K extends keyof Extracted>(key: K, value: Extracted[K]) {
    setQueue((prev) =>
      prev.map((it, i) =>
        i === activeIndex && it.extracted
          ? { ...it, extracted: { ...it.extracted, [key]: value } }
          : it
      )
    );
  }

  async function saveActive() {
    const item = queue[activeIndex];
    if (!item || !item.extracted || !item.extracted.scan_date) return;

    setQueue((prev) => prev.map((it, i) => (i === activeIndex ? { ...it, status: "saving" } : it)));

    try {
      const res = await fetch("/api/ingest/bodyspec-dexa/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.extracted),
      });
      const json = await res.json();
      if (!res.ok) {
        setQueue((prev) =>
          prev.map((it, i) =>
            i === activeIndex ? { ...it, status: "error", error: json.error ?? "Save failed" } : it
          )
        );
        return;
      }
      setQueue((prev) =>
        prev.map((it, i) =>
          i === activeIndex
            ? {
                ...it,
                status: "saved",
                saveResult: { saved: json.saved, skipped: json.skipped, errors: json.errors },
              }
            : it
        )
      );
      advance();
    } catch (err) {
      setQueue((prev) =>
        prev.map((it, i) =>
          i === activeIndex
            ? { ...it, status: "error", error: err instanceof Error ? err.message : String(err) }
            : it
        )
      );
    }
  }

  function skipActive() {
    setQueue((prev) =>
      prev.map((it, i) => (i === activeIndex ? { ...it, status: "skipped" } : it))
    );
    advance();
  }

  function advance() {
    setActiveIndex((prev) => prev + 1);
  }

  function reset() {
    queue.forEach((it) => URL.revokeObjectURL(it.pdfUrl));
    setQueue([]);
    setActiveIndex(0);
    setPickerError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // -- Render branches -------------------------------------------------------

  // No queue yet: show uploader.
  if (queue.length === 0) {
    return (
      <div className="max-w-[820px]">
        <PageHeader />
        <Uploader
          fileInputRef={fileInputRef}
          dragging={dragging}
          setDragging={setDragging}
          onFiles={handleFiles}
          error={pickerError}
        />
      </div>
    );
  }

  // Queue exhausted: show summary.
  if (activeIndex >= queue.length) {
    const savedCount = queue.filter((it) => it.status === "saved").length;
    const skippedCount = queue.filter((it) => it.status === "skipped").length;
    const errorCount = queue.filter((it) => it.status === "error").length;
    return (
      <div className="max-w-[820px]">
        <PageHeader />
        <div className="mb-6 p-4 bg-accent-green/10 border border-accent-green/20 rounded">
          <div className="text-[0.8125rem] font-semibold text-accent-green mb-2">
            ✓ Done - processed {queue.length} scan{queue.length === 1 ? "" : "s"}
          </div>
          <div className="text-[0.8125rem] text-text-secondary space-y-1 font-mono">
            <div>saved:   {savedCount}</div>
            <div>skipped: {skippedCount}</div>
            {errorCount > 0 && <div className="text-accent-red">errors:  {errorCount}</div>}
          </div>
        </div>

        <div className="mb-6">
          <div className="text-[0.6875rem] font-mono text-muted uppercase tracking-wider mb-2">Details</div>
          <div className="space-y-1">
            {queue.map((it) => (
              <div key={it.id} className="flex items-center gap-3 text-[0.8125rem] font-mono py-1 border-b border-surface last:border-b-0">
                <StatusDot status={it.status} />
                <span className="flex-1 truncate">{it.fileName}</span>
                <span className="text-muted">{it.status}</span>
                {it.error && <span className="text-accent-red text-[0.6875rem]">{it.error}</span>}
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={reset}
          className="px-5 py-2 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90"
        >
          Upload more scans
        </button>
      </div>
    );
  }

  // Review the active item.
  const active = queue[activeIndex];

  return (
    <div className="max-w-[1400px]">
      <PageHeader />

      {/* Queue progress strip */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[0.8125rem] text-text-secondary">
            Scan <span className="font-mono font-semibold">{activeIndex + 1}</span> of{" "}
            <span className="font-mono">{queue.length}</span>
            <span className="text-muted"> · {active.fileName}</span>
          </div>
          <button onClick={reset} className="text-[0.75rem] text-muted hover:text-foreground">
            Cancel batch
          </button>
        </div>
        <div className="flex gap-1">
          {queue.map((it, i) => (
            <div
              key={it.id}
              className={`flex-1 h-[4px] rounded-full transition-colors ${
                i === activeIndex
                  ? "bg-foreground"
                  : it.status === "saved"
                  ? "bg-accent-green"
                  : it.status === "skipped"
                  ? "bg-muted"
                  : it.status === "error"
                  ? "bg-accent-red"
                  : "bg-surface"
              }`}
              title={`${it.fileName} - ${it.status}`}
            />
          ))}
        </div>
      </div>

      {active.status === "extracting" || active.status === "pending" ? (
        <div className="flex items-center gap-2 text-[0.875rem] text-muted py-6">
          <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
          Extracting data from {active.fileName}...
        </div>
      ) : active.status === "error" ? (
        <div>
          <div className="mb-4 p-3 text-[0.8125rem] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded">
            <div className="font-semibold mb-1">Extraction failed</div>
            {active.error}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => extractItem(active.id, active.file)}
              className="px-4 py-2 border border-border rounded text-[0.8125rem] hover:bg-surface"
            >
              Retry
            </button>
            <button
              onClick={skipActive}
              className="px-4 py-2 text-[0.8125rem] text-muted hover:text-foreground"
            >
              Skip and move on
            </button>
          </div>
        </div>
      ) : (active.status === "ready" || active.status === "saving") && active.extracted ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Review form */}
          <div>
            <div className="mb-4 text-[0.8125rem] text-muted">
              Verify each value against the PDF. Edit anything the LLM got wrong before saving. →
            </div>

            <div className="space-y-4 mb-6">
              <Field label="Scan Date" unit="YYYY-MM-DD">
                <input
                  type="date"
                  value={active.extracted.scan_date ?? ""}
                  onChange={(e) => updateActiveField("scan_date", e.target.value)}
                  className="font-mono text-[0.9375rem] px-3 py-2 border border-border rounded focus:outline-none focus:border-foreground"
                />
              </Field>
              <NumField label="Body Weight" unit="lb" value={active.extracted.body_weight_lb} onChange={(v) => updateActiveField("body_weight_lb", v)} />
              <NumField label="Body Fat" unit="%" value={active.extracted.body_fat_pct} onChange={(v) => updateActiveField("body_fat_pct", v)} />
              <NumField label="Lean Mass" unit="lb" value={active.extracted.lean_mass_lb} onChange={(v) => updateActiveField("lean_mass_lb", v)} />
              <NumField label="Fat Mass" unit="lb" value={active.extracted.fat_mass_lb} onChange={(v) => updateActiveField("fat_mass_lb", v)} />
              <NumField label="Bone Mineral Density" unit="g/cm²" value={active.extracted.bone_mineral_density} onChange={(v) => updateActiveField("bone_mineral_density", v)} />
              <NumField label="Visceral Fat" unit="lb" value={active.extracted.visceral_fat_lb} onChange={(v) => updateActiveField("visceral_fat_lb", v)} />
            </div>

            {active.extracted.notes && (
              <div className="mb-6 p-3 bg-surface rounded text-[0.8125rem] text-text-secondary">
                <div className="text-[0.6875rem] text-muted uppercase tracking-wider font-semibold mb-1">Notes from report</div>
                {active.extracted.notes}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={saveActive}
                disabled={active.status === "saving" || !active.extracted.scan_date}
                className="px-5 py-2 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
              >
                {active.status === "saving"
                  ? "Saving..."
                  : activeIndex === queue.length - 1
                  ? "Save & finish"
                  : "Save & next"}
              </button>
              <button
                onClick={skipActive}
                disabled={active.status === "saving"}
                className="px-4 py-2 border border-border rounded text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
              >
                Skip this one
              </button>
            </div>
          </div>

          {/* PDF preview - desktop only */}
          <div className="hidden lg:block lg:sticky lg:top-8 lg:self-start">
            <div className="mb-2 text-[0.6875rem] font-mono text-muted uppercase tracking-wider">Source PDF</div>
            <object
              data={active.pdfUrl}
              type="application/pdf"
              className="w-full h-[80vh] border border-border rounded"
            >
              <p className="p-4 text-[0.8125rem] text-muted">
                Your browser can&apos;t embed PDFs.{" "}
                <a href={active.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-foreground underline">
                  Open {active.fileName} in a new tab
                </a>
                .
              </p>
            </object>
          </div>
        </div>
      ) : (
        // saved / skipped - transitional state, advance() should have moved us; but handle gracefully.
        <div className="text-[0.875rem] text-muted py-6">Loading next scan...</div>
      )}
    </div>
  );
}

// -- Subcomponents -----------------------------------------------------------

function PageHeader() {
  return (
    <p className="text-[0.8125rem] text-muted mb-6">
      <Wordmark /> extracts the key numbers from each report. You review and edit each value before saving -
      LLMs hallucinate, so always verify against the PDF.
    </p>
  );
}

function Uploader({
  fileInputRef,
  dragging,
  setDragging,
  onFiles,
  error,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onFiles: (files: FileList | File[]) => void;
  error: string | null;
}) {
  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
        }}
        className="sr-only"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
        }}
        className={`block w-full py-10 px-6 border-2 border-dashed rounded-lg transition-colors ${
          dragging
            ? "border-foreground bg-surface"
            : "border-border hover:border-foreground hover:bg-surface/40"
        }`}
      >
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
            <path d="M12 3v13M12 3l-5 5M12 3l5 5M4 17v3h16v-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-[0.9375rem] font-medium">
            Click to choose PDFs <span className="text-muted font-normal">or drag them here</span>
          </div>
          <div className="text-[0.75rem] text-muted font-mono">
            Up to {MAX_FILES} BodySpec DEXA scans · each up to 10 MB
          </div>
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

function StatusDot({ status }: { status: ItemStatus }) {
  const color = {
    pending: "bg-surface",
    extracting: "bg-muted animate-pulse",
    ready: "bg-foreground",
    saving: "bg-foreground animate-pulse",
    saved: "bg-accent-green",
    skipped: "bg-muted",
    error: "bg-accent-red",
  }[status];
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
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
        placeholder="-"
        onChange={(e) => {
          const str = e.target.value;
          onChange(str === "" ? null : parseFloat(str));
        }}
        className="font-mono text-[0.9375rem] px-3 py-2 border border-border rounded w-full max-w-[200px] focus:outline-none focus:border-foreground"
      />
    </Field>
  );
}
