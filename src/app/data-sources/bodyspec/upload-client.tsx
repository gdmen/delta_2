"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { FileDropZone } from "@/components/file-drop-zone";

interface Extracted {
  scan_date: string | null;
  height_in: number | null;
  // Total composition + supplemental (13)
  body_weight_lb: number | null;
  body_fat_pct: number | null;
  lean_mass_lb: number | null;
  fat_mass_lb: number | null;
  bone_mineral_content_lb: number | null;
  bone_mineral_density: number | null;
  visceral_fat_lb: number | null;
  vat_volume_in3: number | null;
  t_score: number | null;
  z_score: number | null;
  rmr_kcal: number | null;
  ag_ratio: number | null;

  // Regional 5x5 (25)
  arms_fat_pct: number | null;
  arms_total_mass_lb: number | null;
  arms_fat_mass_lb: number | null;
  arms_lean_mass_lb: number | null;
  arms_bmc_lb: number | null;
  legs_fat_pct: number | null;
  legs_total_mass_lb: number | null;
  legs_fat_mass_lb: number | null;
  legs_lean_mass_lb: number | null;
  legs_bmc_lb: number | null;
  trunk_fat_pct: number | null;
  trunk_total_mass_lb: number | null;
  trunk_fat_mass_lb: number | null;
  trunk_lean_mass_lb: number | null;
  trunk_bmc_lb: number | null;
  android_fat_pct: number | null;
  android_total_mass_lb: number | null;
  android_fat_mass_lb: number | null;
  android_lean_mass_lb: number | null;
  android_bmc_lb: number | null;
  gynoid_fat_pct: number | null;
  gynoid_total_mass_lb: number | null;
  gynoid_fat_mass_lb: number | null;
  gynoid_lean_mass_lb: number | null;
  gynoid_bmc_lb: number | null;

  // Bone density per region (7)
  head_bmd: number | null;
  arms_bmd: number | null;
  legs_bmd: number | null;
  trunk_bmd: number | null;
  ribs_bmd: number | null;
  spine_bmd: number | null;
  pelvis_bmd: number | null;

  // Muscle balance (8)
  right_arm_lean_mass_lb: number | null;
  right_arm_fat_mass_lb: number | null;
  left_arm_lean_mass_lb: number | null;
  left_arm_fat_mass_lb: number | null;
  right_leg_lean_mass_lb: number | null;
  right_leg_fat_mass_lb: number | null;
  left_leg_lean_mass_lb: number | null;
  left_leg_fat_mass_lb: number | null;
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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerError, setPickerError] = useState<string | null>(null);

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
  }

  // -- Render branches -------------------------------------------------------

  // No queue yet: show uploader.
  if (queue.length === 0) {
    return (
      <div className="max-w-[820px]">
        <PageHeader />
        <FileDropZone
          accept="application/pdf"
          multiple
          primaryLabel={
            <>
              Click to choose PDFs <span className="text-muted font-normal">or drag them here</span>
            </>
          }
          hint={`Up to ${MAX_FILES} BodySpec DEXA scans · each up to 10 MB`}
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

  // Review the active item. No max-width - the two-column review layout
  // (form + PDF preview) benefits from every pixel on wide screens.
  const active = queue[activeIndex];

  return (
    <div>
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
            </div>

            {/* Sections collapse to keep the form scannable; Total
                composition is open by default since those are the
                always-watched values. Empty/cleared fields skip on save. */}
            <SectionGroup label="Total composition" open>
              <NumField label="Body Weight" unit="lb" value={active.extracted.body_weight_lb} onChange={(v) => updateActiveField("body_weight_lb", v)} />
              <NumField label="Body Fat" unit="%" value={active.extracted.body_fat_pct} onChange={(v) => updateActiveField("body_fat_pct", v)} />
              <NumField label="Lean Mass" unit="lb" value={active.extracted.lean_mass_lb} onChange={(v) => updateActiveField("lean_mass_lb", v)} />
              <NumField label="Fat Mass" unit="lb" value={active.extracted.fat_mass_lb} onChange={(v) => updateActiveField("fat_mass_lb", v)} />
              <NumField label="Bone Mineral Density" unit="g/cm²" value={active.extracted.bone_mineral_density} onChange={(v) => updateActiveField("bone_mineral_density", v)} />
              <NumField label="Bone Mineral Content" unit="lb" value={active.extracted.bone_mineral_content_lb} onChange={(v) => updateActiveField("bone_mineral_content_lb", v)} />
              <NumField label="Visceral Fat" unit="lb" value={active.extracted.visceral_fat_lb} onChange={(v) => updateActiveField("visceral_fat_lb", v)} />
            </SectionGroup>

            <SectionGroup label="Supplemental">
              <NumField label="RMR" unit="kcal/day" value={active.extracted.rmr_kcal} onChange={(v) => updateActiveField("rmr_kcal", v)} />
              <NumField label="A/G Ratio" unit="" value={active.extracted.ag_ratio} onChange={(v) => updateActiveField("ag_ratio", v)} />
              <NumField label="VAT Volume" unit="in³" value={active.extracted.vat_volume_in3} onChange={(v) => updateActiveField("vat_volume_in3", v)} />
              <NumField label="Total T-Score" unit="" value={active.extracted.t_score} onChange={(v) => updateActiveField("t_score", v)} />
              <NumField label="Total Z-Score" unit="" value={active.extracted.z_score} onChange={(v) => updateActiveField("z_score", v)} />
              <NumField label="Height" unit="in" value={active.extracted.height_in} onChange={(v) => updateActiveField("height_in", v)} />
            </SectionGroup>

            <SectionGroup label="Regional — Arms">
              <NumField label="Fat" unit="%" value={active.extracted.arms_fat_pct} onChange={(v) => updateActiveField("arms_fat_pct", v)} />
              <NumField label="Total Mass" unit="lb" value={active.extracted.arms_total_mass_lb} onChange={(v) => updateActiveField("arms_total_mass_lb", v)} />
              <NumField label="Fat Mass" unit="lb" value={active.extracted.arms_fat_mass_lb} onChange={(v) => updateActiveField("arms_fat_mass_lb", v)} />
              <NumField label="Lean Mass" unit="lb" value={active.extracted.arms_lean_mass_lb} onChange={(v) => updateActiveField("arms_lean_mass_lb", v)} />
              <NumField label="BMC" unit="lb" value={active.extracted.arms_bmc_lb} onChange={(v) => updateActiveField("arms_bmc_lb", v)} />
            </SectionGroup>

            <SectionGroup label="Regional — Legs">
              <NumField label="Fat" unit="%" value={active.extracted.legs_fat_pct} onChange={(v) => updateActiveField("legs_fat_pct", v)} />
              <NumField label="Total Mass" unit="lb" value={active.extracted.legs_total_mass_lb} onChange={(v) => updateActiveField("legs_total_mass_lb", v)} />
              <NumField label="Fat Mass" unit="lb" value={active.extracted.legs_fat_mass_lb} onChange={(v) => updateActiveField("legs_fat_mass_lb", v)} />
              <NumField label="Lean Mass" unit="lb" value={active.extracted.legs_lean_mass_lb} onChange={(v) => updateActiveField("legs_lean_mass_lb", v)} />
              <NumField label="BMC" unit="lb" value={active.extracted.legs_bmc_lb} onChange={(v) => updateActiveField("legs_bmc_lb", v)} />
            </SectionGroup>

            <SectionGroup label="Regional — Trunk">
              <NumField label="Fat" unit="%" value={active.extracted.trunk_fat_pct} onChange={(v) => updateActiveField("trunk_fat_pct", v)} />
              <NumField label="Total Mass" unit="lb" value={active.extracted.trunk_total_mass_lb} onChange={(v) => updateActiveField("trunk_total_mass_lb", v)} />
              <NumField label="Fat Mass" unit="lb" value={active.extracted.trunk_fat_mass_lb} onChange={(v) => updateActiveField("trunk_fat_mass_lb", v)} />
              <NumField label="Lean Mass" unit="lb" value={active.extracted.trunk_lean_mass_lb} onChange={(v) => updateActiveField("trunk_lean_mass_lb", v)} />
              <NumField label="BMC" unit="lb" value={active.extracted.trunk_bmc_lb} onChange={(v) => updateActiveField("trunk_bmc_lb", v)} />
            </SectionGroup>

            <SectionGroup label="Regional — Android">
              <NumField label="Fat" unit="%" value={active.extracted.android_fat_pct} onChange={(v) => updateActiveField("android_fat_pct", v)} />
              <NumField label="Total Mass" unit="lb" value={active.extracted.android_total_mass_lb} onChange={(v) => updateActiveField("android_total_mass_lb", v)} />
              <NumField label="Fat Mass" unit="lb" value={active.extracted.android_fat_mass_lb} onChange={(v) => updateActiveField("android_fat_mass_lb", v)} />
              <NumField label="Lean Mass" unit="lb" value={active.extracted.android_lean_mass_lb} onChange={(v) => updateActiveField("android_lean_mass_lb", v)} />
              <NumField label="BMC" unit="lb" value={active.extracted.android_bmc_lb} onChange={(v) => updateActiveField("android_bmc_lb", v)} />
            </SectionGroup>

            <SectionGroup label="Regional — Gynoid">
              <NumField label="Fat" unit="%" value={active.extracted.gynoid_fat_pct} onChange={(v) => updateActiveField("gynoid_fat_pct", v)} />
              <NumField label="Total Mass" unit="lb" value={active.extracted.gynoid_total_mass_lb} onChange={(v) => updateActiveField("gynoid_total_mass_lb", v)} />
              <NumField label="Fat Mass" unit="lb" value={active.extracted.gynoid_fat_mass_lb} onChange={(v) => updateActiveField("gynoid_fat_mass_lb", v)} />
              <NumField label="Lean Mass" unit="lb" value={active.extracted.gynoid_lean_mass_lb} onChange={(v) => updateActiveField("gynoid_lean_mass_lb", v)} />
              <NumField label="BMC" unit="lb" value={active.extracted.gynoid_bmc_lb} onChange={(v) => updateActiveField("gynoid_bmc_lb", v)} />
            </SectionGroup>

            <SectionGroup label="Bone density per region">
              <NumField label="Head" unit="g/cm²" value={active.extracted.head_bmd} onChange={(v) => updateActiveField("head_bmd", v)} />
              <NumField label="Arms" unit="g/cm²" value={active.extracted.arms_bmd} onChange={(v) => updateActiveField("arms_bmd", v)} />
              <NumField label="Legs" unit="g/cm²" value={active.extracted.legs_bmd} onChange={(v) => updateActiveField("legs_bmd", v)} />
              <NumField label="Trunk" unit="g/cm²" value={active.extracted.trunk_bmd} onChange={(v) => updateActiveField("trunk_bmd", v)} />
              <NumField label="Ribs" unit="g/cm²" value={active.extracted.ribs_bmd} onChange={(v) => updateActiveField("ribs_bmd", v)} />
              <NumField label="Spine" unit="g/cm²" value={active.extracted.spine_bmd} onChange={(v) => updateActiveField("spine_bmd", v)} />
              <NumField label="Pelvis" unit="g/cm²" value={active.extracted.pelvis_bmd} onChange={(v) => updateActiveField("pelvis_bmd", v)} />
            </SectionGroup>

            <SectionGroup label="Muscle balance — left/right">
              <NumField label="Right Arm Lean" unit="lb" value={active.extracted.right_arm_lean_mass_lb} onChange={(v) => updateActiveField("right_arm_lean_mass_lb", v)} />
              <NumField label="Right Arm Fat" unit="lb" value={active.extracted.right_arm_fat_mass_lb} onChange={(v) => updateActiveField("right_arm_fat_mass_lb", v)} />
              <NumField label="Left Arm Lean" unit="lb" value={active.extracted.left_arm_lean_mass_lb} onChange={(v) => updateActiveField("left_arm_lean_mass_lb", v)} />
              <NumField label="Left Arm Fat" unit="lb" value={active.extracted.left_arm_fat_mass_lb} onChange={(v) => updateActiveField("left_arm_fat_mass_lb", v)} />
              <NumField label="Right Leg Lean" unit="lb" value={active.extracted.right_leg_lean_mass_lb} onChange={(v) => updateActiveField("right_leg_lean_mass_lb", v)} />
              <NumField label="Right Leg Fat" unit="lb" value={active.extracted.right_leg_fat_mass_lb} onChange={(v) => updateActiveField("right_leg_fat_mass_lb", v)} />
              <NumField label="Left Leg Lean" unit="lb" value={active.extracted.left_leg_lean_mass_lb} onChange={(v) => updateActiveField("left_leg_lean_mass_lb", v)} />
              <NumField label="Left Leg Fat" unit="lb" value={active.extracted.left_leg_fat_mass_lb} onChange={(v) => updateActiveField("left_leg_fat_mass_lb", v)} />
            </SectionGroup>

            <div className="mb-6" />


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

function SectionGroup({
  label,
  open,
  children,
}: {
  label: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="mb-3 border border-border rounded"
      {...(open ? { open: true } : {})}
    >
      <summary className="cursor-pointer px-3 py-2 text-[0.75rem] font-mono uppercase tracking-wider text-muted hover:text-foreground select-none">
        {label}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>
    </details>
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
