"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ColumnRef,
  DateFormat,
  ImportMapping,
  RowFilter,
  ValueSlot,
} from "@/lib/import-mapping";

// -----------------------------------------------------------------------------
// Types + helpers (shared between the create wizard and the edit page)
// -----------------------------------------------------------------------------

export type Kind = "metrics" | "events" | "workout_sets";

export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "auto", label: "Auto (ISO 8601)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (e.g. 2025-01-15)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "MM-DD-YYYY", label: "MM-DD-YYYY" },
  { value: "D-MMM-YY", label: "D-MMM-YY (e.g. 03-Oct-14)" },
];

/** Turns empty headers into col_1, col_2 labels for the dropdown. */
export function headerLabel(header: string, index: number): string {
  return header.trim() ? header : `col_${index + 1}`;
}

export function headerOptionValue(index: number): string {
  return `__idx:${index + 1}`;
}

export function parseColumnRef(value: string, headers: string[]): ColumnRef | null {
  if (!value) return null;
  if (value.startsWith("__idx:")) {
    const n = parseInt(value.slice(6), 10);
    if (!isFinite(n) || n < 1) return null;
    const header = headers[n - 1] ?? "";
    if (header.trim() && headers.filter((h) => h === header).length === 1) {
      return { column: header };
    }
    return { index: n };
  }
  return null;
}

export function stringifyRef(ref: ColumnRef | null | undefined, headers: string[]): string {
  if (!ref) return "";
  if ("column" in ref) {
    const i = headers.indexOf(ref.column);
    if (i < 0) return "";
    return headerOptionValue(i);
  }
  return headerOptionValue(ref.index);
}

export function defaultMappingForKind(
  kind: Kind,
  autoMatch: Record<string, ColumnRef | null>
): ImportMapping {
  const slotFromAutoMatch = (key: string): ValueSlot => {
    const ref = autoMatch[key];
    return ref ? { source: "column", ref } : { source: "none" };
  };
  const dateRef = autoMatch.startedAt ?? autoMatch.recordedAt ?? { column: "" };

  if (kind === "metrics") {
    return {
      kind: "metrics",
      recordedAt: { ref: dateRef, format: "auto" },
      metrics: [
        {
          name: autoMatch.metric ? { source: "column", ref: autoMatch.metric } : { source: "literal", value: "" },
          value: slotFromAutoMatch("value"),
          unit: slotFromAutoMatch("unit"),
        },
      ],
      sourceId: slotFromAutoMatch("sourceId"),
    };
  }
  if (kind === "events") {
    return {
      kind: "events",
      startedAt: { ref: dateRef, format: "auto" },
      sport: slotFromAutoMatch("sport"),
      type: slotFromAutoMatch("type"),
      durationMinutes: slotFromAutoMatch("duration"),
      notes: slotFromAutoMatch("notes"),
      sourceId: slotFromAutoMatch("sourceId"),
    };
  }
  return {
    kind: "workout_sets",
    startedAt: { ref: dateRef, format: "auto" },
    sport: { source: "literal", value: "powerlifting" },
    eventType: { source: "literal", value: "strength" },
    eventSourceId: slotFromAutoMatch("eventSourceId"),
    exerciseName: slotFromAutoMatch("exerciseName"),
    setNumber: slotFromAutoMatch("setNumber"),
    reps: slotFromAutoMatch("reps"),
    weight: slotFromAutoMatch("weight"),
    rpe: slotFromAutoMatch("rpe"),
    notes: slotFromAutoMatch("notes"),
  };
}

// -----------------------------------------------------------------------------
// KindPicker
// -----------------------------------------------------------------------------

export function KindPicker({
  kind,
  onChange,
  disabled = false,
}: {
  kind: Kind;
  onChange: (k: Kind) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[0.8125rem] font-semibold mb-2">Data kind</label>
      <div className="flex gap-0 border border-border rounded overflow-hidden w-fit">
        {(["metrics", "events", "workout_sets"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onChange(k)}
            className={`px-4 py-2 text-[0.8125rem] disabled:opacity-60 disabled:cursor-not-allowed ${
              kind === k ? "bg-foreground text-background" : "bg-surface text-text-secondary hover:bg-border"
            }`}
          >
            {k === "workout_sets" ? "Workout Sets" : k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[0.75rem] text-muted">
        {kind === "metrics" && "One row = one or more timestamped numeric measurements."}
        {kind === "events" && "One row = one session (run, ride, class, etc.) with sport + type + duration."}
        {kind === "workout_sets" && "One row = one set of a lifting exercise (reps + weight)."}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// MappingEditor (routes to kind-specific editor)
// -----------------------------------------------------------------------------

/**
 * `metricNameSuggestions` populates an autocomplete datalist for literal
 * metric-name inputs. Pass the existing metric_types list so users pick
 * canonical names (e.g. "bodyweight") instead of inventing variants
 * ("body_weight") that silently create orphan metric types.
 */
export function MappingEditor({
  kind,
  mapping,
  headers,
  onChange,
  metricNameSuggestions = [],
  sportSuggestions = [],
}: {
  kind: Kind;
  mapping: ImportMapping;
  headers: string[];
  onChange: (m: ImportMapping) => void;
  metricNameSuggestions?: string[];
  sportSuggestions?: string[];
}) {
  if (kind === "metrics" && mapping.kind === "metrics") {
    return (
      <MetricsEditor
        mapping={mapping}
        headers={headers}
        onChange={onChange}
        metricNameSuggestions={metricNameSuggestions}
      />
    );
  }
  if (kind === "events" && mapping.kind === "events") {
    return (
      <EventsEditor
        mapping={mapping}
        headers={headers}
        onChange={onChange}
        sportSuggestions={sportSuggestions}
        metricNameSuggestions={metricNameSuggestions}
      />
    );
  }
  if (kind === "workout_sets" && mapping.kind === "workout_sets") {
    return (
      <WorkoutSetsEditor
        mapping={mapping}
        headers={headers}
        onChange={onChange}
        sportSuggestions={sportSuggestions}
      />
    );
  }
  return null;
}

function MetricsEditor({
  mapping,
  headers,
  onChange,
  metricNameSuggestions,
}: {
  mapping: Extract<ImportMapping, { kind: "metrics" }>;
  headers: string[];
  onChange: (m: ImportMapping) => void;
  metricNameSuggestions: string[];
}) {
  return (
    <div className="space-y-5">
      <Field label="Date column" required>
        <DateRefPicker
          refValue={mapping.recordedAt.ref}
          format={mapping.recordedAt.format}
          headers={headers}
          onChange={(ref, format) => onChange({ ...mapping, recordedAt: { ref, format } })}
        />
      </Field>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <label className="text-[0.8125rem] font-semibold">Metrics to extract</label>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...mapping,
                metrics: [
                  ...mapping.metrics,
                  { name: { source: "literal", value: "" }, value: { source: "none" } },
                ],
              })
            }
            className="text-[0.75rem] text-foreground underline"
          >
            + Add metric
          </button>
        </div>
        <div className="space-y-3">
          {mapping.metrics.map((m, i) => (
            <div key={i} className="border border-border rounded p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
                  Metric {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...mapping,
                      metrics: mapping.metrics.filter((_, j) => j !== i),
                    })
                  }
                  className="text-[0.75rem] text-muted hover:text-accent-red"
                >
                  Remove
                </button>
              </div>
              <Field label="Metric name">
                <SlotPicker
                  slot={m.name}
                  headers={headers}
                  literalPlaceholder="e.g. bodyweight, hrv_ms"
                  literalSuggestions={metricNameSuggestions}
                  onChange={(name) =>
                    onChange({
                      ...mapping,
                      metrics: mapping.metrics.map((x, j) => (j === i ? { ...x, name } : x)),
                    })
                  }
                />
              </Field>
              <Field label="Value">
                <SlotPicker
                  slot={m.value}
                  headers={headers}
                  onChange={(value) =>
                    onChange({
                      ...mapping,
                      metrics: mapping.metrics.map((x, j) => (j === i ? { ...x, value } : x)),
                    })
                  }
                />
              </Field>
              <Field label="Unit (optional)">
                <SlotPicker
                  slot={m.unit ?? { source: "none" }}
                  headers={headers}
                  literalPlaceholder="e.g. g, lb, bpm"
                  onChange={(unit) =>
                    onChange({
                      ...mapping,
                      metrics: mapping.metrics.map((x, j) => (j === i ? { ...x, unit } : x)),
                    })
                  }
                />
              </Field>
            </div>
          ))}
        </div>
      </div>

      <Field label="Source ID column (optional)">
        <SlotPicker
          slot={mapping.sourceId ?? { source: "none" }}
          headers={headers}
          onChange={(sourceId) => onChange({ ...mapping, sourceId })}
        />
      </Field>

      <RowFilterEditor
        filter={mapping.rowFilter}
        headers={headers}
        onChange={(rowFilter) => onChange({ ...mapping, rowFilter })}
      />
    </div>
  );
}

function EventsEditor({
  mapping,
  headers,
  onChange,
  sportSuggestions,
  metricNameSuggestions,
}: {
  mapping: Extract<ImportMapping, { kind: "events" }>;
  headers: string[];
  onChange: (m: ImportMapping) => void;
  sportSuggestions: string[];
  metricNameSuggestions: string[];
}) {
  const attachedMetrics = mapping.metrics ?? [];

  return (
    <div className="space-y-5">
      <Field label="Started-at column" required>
        <DateRefPicker
          refValue={mapping.startedAt.ref}
          format={mapping.startedAt.format}
          headers={headers}
          onChange={(ref, format) => onChange({ ...mapping, startedAt: { ref, format } })}
        />
      </Field>
      <Field label="Sport" required>
        <SlotPicker
          slot={mapping.sport}
          headers={headers}
          literalPlaceholder="e.g. running (matches sports.name)"
          literalSuggestions={sportSuggestions}
          onChange={(sport) => onChange({ ...mapping, sport })}
        />
      </Field>
      <Field label="Type" required>
        <SlotPicker
          slot={mapping.type}
          headers={headers}
          literalPlaceholder="e.g. run, ride, class"
          onChange={(type) => onChange({ ...mapping, type })}
        />
      </Field>
      <Field label="Duration (min, HH:MM:SS, or '7 hr 30 min')">
        <SlotPicker
          slot={mapping.durationMinutes ?? { source: "none" }}
          headers={headers}
          onChange={(durationMinutes) => onChange({ ...mapping, durationMinutes })}
        />
      </Field>
      <Field label="Notes (optional)">
        <SlotPicker
          slot={mapping.notes ?? { source: "none" }}
          headers={headers}
          onChange={(notes) => onChange({ ...mapping, notes })}
        />
      </Field>
      <Field label="Source ID column (optional)">
        <SlotPicker
          slot={mapping.sourceId ?? { source: "none" }}
          headers={headers}
          onChange={(sourceId) => onChange({ ...mapping, sourceId })}
        />
      </Field>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <label className="text-[0.8125rem] font-semibold">
            Attached metrics <span className="text-muted font-normal">(distance, calories, avg HR, etc.)</span>
          </label>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...mapping,
                metrics: [
                  ...attachedMetrics,
                  { name: { source: "literal", value: "" }, value: { source: "none" } },
                ],
              })
            }
            className="text-[0.75rem] text-foreground underline"
          >
            + Add metric
          </button>
        </div>
        <div className="space-y-3">
          {attachedMetrics.map((m, i) => (
            <div key={i} className="border border-border rounded p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
                  Metric {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...mapping,
                      metrics: attachedMetrics.filter((_, j) => j !== i),
                    })
                  }
                  className="text-[0.75rem] text-muted hover:text-accent-red"
                >
                  Remove
                </button>
              </div>
              <Field label="Metric name">
                <SlotPicker
                  slot={m.name}
                  headers={headers}
                  literalPlaceholder="e.g. distance_mi, active_energy_kcal"
                  literalSuggestions={metricNameSuggestions}
                  onChange={(name) =>
                    onChange({
                      ...mapping,
                      metrics: attachedMetrics.map((x, j) => (j === i ? { ...x, name } : x)),
                    })
                  }
                />
              </Field>
              <Field label="Value">
                <SlotPicker
                  slot={m.value}
                  headers={headers}
                  onChange={(value) =>
                    onChange({
                      ...mapping,
                      metrics: attachedMetrics.map((x, j) => (j === i ? { ...x, value } : x)),
                    })
                  }
                />
              </Field>
              <Field label="Unit (optional)">
                <SlotPicker
                  slot={m.unit ?? { source: "none" }}
                  headers={headers}
                  literalPlaceholder="e.g. mi, km, kcal, bpm"
                  onChange={(unit) =>
                    onChange({
                      ...mapping,
                      metrics: attachedMetrics.map((x, j) => (j === i ? { ...x, unit } : x)),
                    })
                  }
                />
              </Field>
            </div>
          ))}
        </div>
      </div>

      <RowFilterEditor
        filter={mapping.rowFilter}
        headers={headers}
        onChange={(rowFilter) => onChange({ ...mapping, rowFilter })}
      />
    </div>
  );
}

function WorkoutSetsEditor({
  mapping,
  headers,
  onChange,
  sportSuggestions,
}: {
  mapping: Extract<ImportMapping, { kind: "workout_sets" }>;
  headers: string[];
  onChange: (m: ImportMapping) => void;
  sportSuggestions: string[];
}) {
  return (
    <div className="space-y-5">
      <Field label="Started-at column" required>
        <DateRefPicker
          refValue={mapping.startedAt.ref}
          format={mapping.startedAt.format}
          headers={headers}
          onChange={(ref, format) => onChange({ ...mapping, startedAt: { ref, format } })}
        />
      </Field>
      <Field label="Sport" required>
        <SlotPicker
          slot={mapping.sport}
          headers={headers}
          literalPlaceholder="e.g. powerlifting"
          literalSuggestions={sportSuggestions}
          onChange={(sport) => onChange({ ...mapping, sport })}
        />
      </Field>
      <Field label="Event type" required>
        <SlotPicker
          slot={mapping.eventType}
          headers={headers}
          literalPlaceholder="e.g. strength"
          onChange={(eventType) => onChange({ ...mapping, eventType })}
        />
      </Field>
      <Field label="Event source ID (groups sets into one workout - TeamBuildr's WorkoutId)">
        <SlotPicker
          slot={mapping.eventSourceId ?? { source: "none" }}
          headers={headers}
          onChange={(eventSourceId) => onChange({ ...mapping, eventSourceId })}
        />
      </Field>
      <Field label="Exercise name" required>
        <SlotPicker
          slot={mapping.exerciseName}
          headers={headers}
          onChange={(exerciseName) => onChange({ ...mapping, exerciseName })}
        />
      </Field>
      <Field label="Set number (optional - falls back to CSV row order)">
        <SlotPicker
          slot={mapping.setNumber ?? { source: "none" }}
          headers={headers}
          onChange={(setNumber) => onChange({ ...mapping, setNumber })}
        />
      </Field>
      <Field label="Reps" required>
        <SlotPicker slot={mapping.reps} headers={headers} onChange={(reps) => onChange({ ...mapping, reps })} />
      </Field>
      <Field label="Weight" required>
        <SlotPicker slot={mapping.weight} headers={headers} onChange={(weight) => onChange({ ...mapping, weight })} />
      </Field>
      <Field label="RPE (optional)">
        <SlotPicker
          slot={mapping.rpe ?? { source: "none" }}
          headers={headers}
          onChange={(rpe) => onChange({ ...mapping, rpe })}
        />
      </Field>
      <Field label="Notes (optional)">
        <SlotPicker
          slot={mapping.notes ?? { source: "none" }}
          headers={headers}
          onChange={(notes) => onChange({ ...mapping, notes })}
        />
      </Field>
      <RowFilterEditor
        filter={mapping.rowFilter}
        headers={headers}
        onChange={(rowFilter) => onChange({ ...mapping, rowFilter })}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Shared small controls
// -----------------------------------------------------------------------------

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[0.8125rem] text-text-secondary mb-1">
        {label}
        {required && <span className="text-accent-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export function SlotPicker({
  slot,
  headers,
  literalPlaceholder,
  literalSuggestions,
  valueSuggestions,
  onChange,
}: {
  slot: ValueSlot;
  headers: string[];
  literalPlaceholder?: string;
  /** Suggestions for the literal input AND for the alias "map to" column. */
  literalSuggestions?: string[];
  /** Suggestions for each alias's "map to" value. Falls back to literalSuggestions. */
  valueSuggestions?: string[];
  onChange: (slot: ValueSlot) => void;
}) {
  const datalistId = useRef(`dl-${Math.random().toString(36).slice(2, 9)}`).current;
  const [showAliases, setShowAliases] = useState(false);

  const hasAliases =
    slot.source === "column" && slot.aliases && Object.keys(slot.aliases).length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={slot.source}
          onChange={(e) => {
            const next = e.target.value as ValueSlot["source"];
            if (next === "column") onChange({ source: "column", ref: { column: headers[0] ?? "" } });
            else if (next === "literal") onChange({ source: "literal", value: "" });
            else onChange({ source: "none" });
          }}
          className="px-2 py-1.5 border border-border rounded text-[0.8125rem] bg-background"
        >
          <option value="none">-</option>
          <option value="column">from column</option>
          <option value="literal">literal</option>
        </select>
        {slot.source === "column" && (
          <>
            <select
              value={stringifyRef(slot.ref, headers)}
              onChange={(e) => {
                const ref = parseColumnRef(e.target.value, headers);
                if (ref) onChange({ ...slot, source: "column", ref });
              }}
              className="flex-1 min-w-[180px] px-2 py-1.5 border border-border rounded text-[0.8125rem] bg-background"
            >
              {headers.map((h, i) => (
                <option key={i} value={headerOptionValue(i)}>
                  {headerLabel(h, i)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowAliases((v) => !v)}
              className={`text-[0.75rem] underline ${hasAliases ? "text-foreground" : "text-muted"}`}
              title="Rewrite raw column values to canonical ones (e.g. 'Stationary Bike' -> 'biking')"
            >
              {showAliases ? "Hide aliases" : hasAliases ? `Aliases (${Object.keys(slot.aliases!).length})` : "+ Add aliases"}
            </button>
          </>
        )}
        {slot.source === "literal" && (
          <>
            <input
              type="text"
              value={slot.value}
              placeholder={literalPlaceholder ?? "literal value"}
              list={literalSuggestions && literalSuggestions.length > 0 ? datalistId : undefined}
              onChange={(e) => onChange({ source: "literal", value: e.target.value })}
              className="flex-1 min-w-[180px] px-2 py-1.5 border border-border rounded text-[0.8125rem]"
            />
            {literalSuggestions && literalSuggestions.length > 0 && (
              <datalist id={datalistId}>
                {literalSuggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </>
        )}
      </div>

      {slot.source === "column" && showAliases && (
        <AliasesEditor
          aliases={slot.aliases ?? {}}
          suggestions={valueSuggestions ?? literalSuggestions ?? []}
          onChange={(aliases) =>
            onChange({ ...slot, aliases: Object.keys(aliases).length > 0 ? aliases : undefined })
          }
        />
      )}
    </div>
  );
}

/**
 * Edit a column's raw->canonical value map. Used to let one mapping handle
 * CSVs where different rows need different canonical targets for the same
 * slot (e.g. Exercise column mapping to sport=biking vs sport=bjj).
 */
function AliasesEditor({
  aliases,
  suggestions,
  onChange,
}: {
  aliases: Record<string, string>;
  suggestions: string[];
  onChange: (next: Record<string, string>) => void;
}) {
  const datalistId = useRef(`dl-${Math.random().toString(36).slice(2, 9)}`).current;
  const [newRaw, setNewRaw] = useState("");
  const entries = Object.entries(aliases);

  return (
    <div className="ml-8 border border-border rounded p-3 space-y-2 bg-surface/40">
      <div className="text-[0.6875rem] font-mono uppercase tracking-wider text-muted">
        Raw value → canonical value
      </div>
      {entries.length === 0 && (
        <div className="text-[0.75rem] text-muted">
          No aliases yet. Unknown values pass through unchanged.
        </div>
      )}
      {entries.map(([raw, canonical]) => (
        <div key={raw} className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-[0.8125rem] bg-background px-2 py-1 rounded border border-border">
            {raw}
          </code>
          <span className="text-muted">→</span>
          <input
            type="text"
            value={canonical}
            list={suggestions.length > 0 ? datalistId : undefined}
            onChange={(e) => onChange({ ...aliases, [raw]: e.target.value })}
            className="flex-1 min-w-[160px] px-2 py-1 border border-border rounded text-[0.8125rem]"
          />
          <button
            type="button"
            onClick={() => {
              const next = { ...aliases };
              delete next[raw];
              onChange(next);
            }}
            className="text-[0.75rem] text-muted hover:text-accent-red"
          >
            remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
        <input
          type="text"
          value={newRaw}
          placeholder="New raw value..."
          onChange={(e) => setNewRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newRaw.trim()) {
              e.preventDefault();
              onChange({ ...aliases, [newRaw.trim()]: "" });
              setNewRaw("");
            }
          }}
          className="flex-1 min-w-[160px] px-2 py-1 border border-border rounded text-[0.8125rem]"
        />
        <button
          type="button"
          onClick={() => {
            if (!newRaw.trim()) return;
            onChange({ ...aliases, [newRaw.trim()]: "" });
            setNewRaw("");
          }}
          className="px-2 py-1 text-[0.75rem] text-foreground underline"
        >
          Add
        </button>
      </div>
      {suggestions.length > 0 && (
        <datalist id={datalistId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}

export function DateRefPicker({
  refValue,
  format,
  headers,
  onChange,
}: {
  refValue: ColumnRef;
  format: DateFormat;
  headers: string[];
  onChange: (ref: ColumnRef, format: DateFormat) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={stringifyRef(refValue, headers)}
        onChange={(e) => {
          const ref = parseColumnRef(e.target.value, headers);
          if (ref) onChange(ref, format);
        }}
        className="flex-1 min-w-[180px] px-2 py-1.5 border border-border rounded text-[0.8125rem] bg-background"
      >
        {headers.map((h, i) => (
          <option key={i} value={headerOptionValue(i)}>
            {headerLabel(h, i)}
          </option>
        ))}
      </select>
      <select
        value={format}
        onChange={(e) => onChange(refValue, e.target.value as DateFormat)}
        className="px-2 py-1.5 border border-border rounded text-[0.8125rem] bg-background"
      >
        {DATE_FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RowFilterEditor({
  filter,
  headers,
  onChange,
}: {
  filter: RowFilter | undefined;
  headers: string[];
  onChange: (f: RowFilter | undefined) => void;
}) {
  if (!filter) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onChange({ column: headers[0] ?? "", op: "equals", value: "" })}
          className="text-[0.75rem] text-foreground underline"
        >
          + Add row filter
        </button>
      </div>
    );
  }

  return (
    <div className="border border-border rounded p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">Row filter</span>
        <button type="button" onClick={() => onChange(undefined)} className="text-[0.75rem] text-muted hover:text-accent-red">
          Remove
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          value={filter.column}
          onChange={(e) => onChange({ ...filter, column: e.target.value })}
          className="px-2 py-1.5 border border-border rounded text-[0.8125rem] bg-background"
        >
          {headers.map((h, i) => (
            <option key={i} value={h}>
              {headerLabel(h, i)}
            </option>
          ))}
        </select>
        <select
          value={filter.op}
          onChange={(e) => {
            const op = e.target.value as RowFilter["op"];
            if (op === "nonEmpty") onChange({ column: filter.column, op: "nonEmpty" });
            else if (op === "in" || op === "notIn") {
              const values = "values" in filter ? filter.values : "value" in filter ? [filter.value] : [];
              onChange({ column: filter.column, op, values });
            } else {
              const value = "value" in filter ? filter.value : "values" in filter ? filter.values[0] ?? "" : "";
              onChange({ column: filter.column, op, value });
            }
          }}
          className="px-2 py-1.5 border border-border rounded text-[0.8125rem] bg-background"
        >
          <option value="equals">equals</option>
          <option value="notEquals">not equals</option>
          <option value="in">in (comma list)</option>
          <option value="notIn">not in (comma list)</option>
          <option value="nonEmpty">is non-empty</option>
        </select>
        {(filter.op === "equals" || filter.op === "notEquals") && (
          <input
            type="text"
            value={filter.value}
            onChange={(e) => onChange({ column: filter.column, op: filter.op, value: e.target.value })}
            className="flex-1 min-w-[120px] px-2 py-1.5 border border-border rounded text-[0.8125rem]"
          />
        )}
        {(filter.op === "in" || filter.op === "notIn") && (
          <input
            type="text"
            value={filter.values.join(", ")}
            placeholder="e.g. Cardio, Walking"
            onChange={(e) =>
              onChange({
                column: filter.column,
                op: filter.op as "in" | "notIn",
                values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
            className="flex-1 min-w-[120px] px-2 py-1.5 border border-border rounded text-[0.8125rem]"
          />
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// useMetricTypeNames: fetch existing metric_types.name list for suggestions
// -----------------------------------------------------------------------------

export function useMetricTypeNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/metric-types");
        if (!res.ok) return;
        const json = (await res.json()) as { name: string }[];
        if (!cancelled) setNames(json.map((x) => x.name));
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return names;
}

export function useSportNames(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sports");
        if (!res.ok) return;
        const json = (await res.json()) as { name: string }[];
        if (!cancelled) setNames(json.map((x) => x.name));
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return names;
}
