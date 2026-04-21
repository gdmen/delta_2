"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnRef, ImportMapping, ValueSlot } from "@/lib/import-mapping";
import {
  MappingEditor,
  useMetricTypeNames,
  useSportNames,
  type Kind,
} from "../../_shared/mapping-editor";

interface ExistingMetricType {
  id: number;
  name: string;
  count: number;
}

/** A candidate migration: move all rows from existing metric_type `from` into canonical `to`. */
interface MigrationRow {
  from: string;
  fromId: number;
  to: string;
  count: number;
}

/**
 * Edit an existing saved import source. On save:
 *   1. PATCHes the mapping record so future imports use the new mapping.
 *   2. Looks at the metric_types this source has ACTUALLY written to. Any
 *      that don't match a literal name in the new mapping are offered for
 *      migration into one of the new mapping's literal targets. Catches
 *      both column->literal changes (FitNotes "Bodyweight" column -> lit
 *      "bodyweight") and literal->literal changes ("body_weight" ->
 *      "bodyweight").
 */
export function EditClient({
  id,
  name,
  kind,
  initialMapping,
}: {
  id: number;
  name: string;
  kind: Kind;
  initialMapping: ImportMapping;
}) {
  const router = useRouter();
  const [mapping, setMapping] = useState<ImportMapping>(initialMapping);
  const [sourceName, setSourceName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingMetricType[]>([]);
  const [migration, setMigration] = useState<MigrationRow[] | null>(null);
  const [distinctExercises, setDistinctExercises] = useState<string[]>([]);

  const metricNames = useMetricTypeNames();
  const sportNames = useSportNames();
  const headers = collectKnownHeaders(mapping);

  // Load existing metric_types this source has written to (for migration detection).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/import-sources/${id}/existing-metric-types`);
        if (!res.ok) return;
        setExisting(await res.json());
      } catch {
        /* ignore */
      }
    })();
  }, [id]);

  // For workout_sets sources, load distinct exercise names so the
  // WeightUnitEditor can show them as checkboxes instead of an empty
  // textarea.
  useEffect(() => {
    if (kind !== "workout_sets") return;
    (async () => {
      try {
        const res = await fetch(`/api/import-sources/${id}/distinct-exercises`);
        if (!res.ok) return;
        setDistinctExercises(await res.json());
      } catch {
        /* ignore */
      }
    })();
  }, [id, kind]);

  function updateMapping(m: ImportMapping) {
    setMapping(m);
    setMigration(null);
  }

  function previewSave() {
    setError(null);
    const literalTargets = literalMetricNames(mapping);
    // Which existing types are not already in the new literal target list?
    const orphans = existing.filter((e) => !literalTargets.includes(e.name));
    if (literalTargets.length === 0 || orphans.length === 0) {
      // Nothing to migrate (either mapping uses column-based names, or
      // everything already matches). Just save.
      void commit(null);
      return;
    }

    // Default target = first literal; user can change per row.
    const defaultTarget = literalTargets[0];
    setMigration(
      orphans.map((o) => ({
        from: o.name,
        fromId: o.id,
        to: defaultTarget,
        count: o.count,
      }))
    );
  }

  async function commit(migrationsToApply: MigrationRow[] | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/import-sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sourceName.trim(), kind, mapping }),
      });
      if (!res.ok) {
        setError(((await res.json()).error as string) ?? "Save failed");
        setSaving(false);
        return;
      }

      if (migrationsToApply && migrationsToApply.length > 0) {
        await fetch(`/api/import-sources/${id}/migrate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renames: migrationsToApply.map((r) => ({ from: r.from, to: r.to })),
          }),
        });
      }

      router.push(`/data-sources/import/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <label className="block text-[0.8125rem] font-semibold mb-2">Name</label>
        <input
          type="text"
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded text-[0.875rem]"
        />
      </div>

      <MappingEditor
        kind={kind}
        mapping={mapping}
        headers={headers}
        onChange={updateMapping}
        metricNameSuggestions={metricNames}
        sportSuggestions={sportNames}
        distinctValuesByColumn={
          // For workout_sets sources, key the distinct list under whatever
          // column the mapping currently has exerciseName pointing at.
          kind === "workout_sets" && mapping.kind === "workout_sets" && mapping.exerciseName.source === "column"
            ? {
                ...("column" in mapping.exerciseName.ref
                  ? { [mapping.exerciseName.ref.column]: distinctExercises }
                  : {}),
              }
            : undefined
        }
      />

      {migration && migration.length > 0 && (
        <MigrationPanel
          literalTargets={literalMetricNames(mapping)}
          rows={migration}
          onChange={setMigration}
          onConfirm={() => commit(migration.filter((r) => r.to !== "__skip"))}
          onCancel={() => setMigration(null)}
          onSkipAll={() => commit(null)}
          saving={saving}
        />
      )}

      {!migration && (
        <section className="border-t border-border pt-6">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={previewSave}
              disabled={saving}
              className="px-5 py-2 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </section>
      )}

      {error && (
        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded text-[0.8125rem] text-accent-red">
          {error}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// MigrationPanel
// -----------------------------------------------------------------------------

function MigrationPanel({
  literalTargets,
  rows,
  onChange,
  onConfirm,
  onCancel,
  onSkipAll,
  saving,
}: {
  literalTargets: string[];
  rows: MigrationRow[];
  onChange: (r: MigrationRow[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onSkipAll: () => void;
  saving: boolean;
}) {
  return (
    <div className="p-4 border border-accent-orange/40 bg-accent-orange/10 rounded space-y-4">
      <div className="text-[0.8125rem] font-semibold">
        Existing data doesn&apos;t match the new mapping. Migrate?
      </div>
      <div className="text-[0.75rem] text-muted">
        Your new mapping writes to{" "}
        {literalTargets.map((t, i) => (
          <span key={t}>
            {i > 0 && ", "}
            <code className="font-mono bg-surface px-1 rounded">{t}</code>
          </span>
        ))}
        . These metric_types have existing rows from this source that don&apos;t match:
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.fromId} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <code className="font-mono bg-surface px-1 rounded">{r.from}</code>
            <span className="text-muted">({r.count} row{r.count === 1 ? "" : "s"})</span>
            <span className="text-muted">→</span>
            <select
              value={r.to}
              onChange={(e) =>
                onChange(rows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))
              }
              className="px-2 py-1 border border-border rounded text-[0.8125rem] bg-background"
            >
              {literalTargets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="__skip">(don&apos;t migrate)</option>
            </select>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button
          onClick={onConfirm}
          disabled={saving}
          className="px-4 py-2 bg-foreground text-background text-[0.8125rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save + migrate"}
        </button>
        <button
          onClick={onSkipAll}
          disabled={saving}
          className="px-4 py-2 border border-border text-[0.8125rem] font-medium rounded hover:bg-surface disabled:opacity-50"
        >
          Save without migrating
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 text-[0.8125rem] text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Collect column names this mapping references so editor dropdowns aren't empty. */
function collectKnownHeaders(m: ImportMapping): string[] {
  const acc = new Set<string>();
  const addSlot = (s: ValueSlot | undefined) => {
    if (!s || s.source !== "column") return;
    if ("column" in s.ref) acc.add(s.ref.column);
  };
  const addRef = (r: { ref: ColumnRef } | undefined) => {
    if (r && "column" in r.ref && r.ref.column) acc.add(r.ref.column);
  };

  if ("recordedAt" in m) addRef(m.recordedAt);
  if ("startedAt" in m) addRef(m.startedAt);
  if (m.kind === "metrics") {
    for (const mt of m.metrics) {
      addSlot(mt.name);
      addSlot(mt.value);
      addSlot(mt.unit);
    }
    addSlot(m.sourceId);
  } else if (m.kind === "events") {
    addSlot(m.sport);
    addSlot(m.type);
    addSlot(m.durationMinutes);
    addSlot(m.notes);
    addSlot(m.sourceId);
  } else {
    addSlot(m.sport);
    addSlot(m.eventType);
    addSlot(m.eventSourceId);
    addSlot(m.exerciseName);
    addSlot(m.setNumber);
    addSlot(m.reps);
    addSlot(m.weight);
    addSlot(m.rpe);
    addSlot(m.notes);
  }
  if (m.rowFilter && "column" in m.rowFilter) acc.add(m.rowFilter.column);
  return [...acc];
}

/** Literal metric names declared in the new mapping (metrics kind only). */
function literalMetricNames(m: ImportMapping): string[] {
  if (m.kind !== "metrics") return [];
  const names: string[] = [];
  for (const entry of m.metrics) {
    if (entry.name.source === "literal" && entry.name.value.trim()) {
      names.push(entry.name.value);
    }
  }
  return names;
}
