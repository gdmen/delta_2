/**
 * Shared types for the /api/import SSE pipeline. Imported by both the
 * server route (emit side) and the client component (parse side) so a
 * field added on one side errors loudly on the other instead of getting
 * silently `as`-cast away.
 *
 * Conceptually one progress run looks like:
 *   start    → phase(done:false) → phase-progress* → phase(done:true) → … → done
 */

/**
 * Canonical execution order — matches the server pipeline.
 *
 * Notably absent: `daily_summaries`. It's a derived cache, fully
 * recomputable from `metrics` rows. The bulk metrics import flushes
 * fresh summaries via flushBulkImportRecomputes after its row loop,
 * so re-importing exported summary values would just overwrite the
 * authoritative recomputed cache with potentially-stale data. Old
 * export ZIPs that still include daily_summaries.csv are silently
 * ignored — the file doesn't match any pipeline phase.
 */
export const IMPORT_TABLES = [
  "sports",
  "metric_types",
  "metric_type_aliases",
  "import_sources",
  "source_settings",
  "goals",
  "focuses",
  "goal_journal_entries",
  "dashboards",
  "dashboard_widgets",
  "metrics",
  "events",
  "event_metrics",
  "workout_sets",
  "event_duplicate_denylist",
  "coach_calls",
  "reconcile_log",
  "merge_log",
] as const;

export type ImportTable = (typeof IMPORT_TABLES)[number];

/** Result for a single table — matches the server's TableResult. */
export interface ImportTableResult {
  accepted: number;
  skipped: number;
  updated: number;
  errors: string[];
}

/**
 * Per-phase descriptor sent in the `start` frame so the client knows
 * which tables to expect and how many rows each one has.
 */
export interface ImportPhaseDescriptor {
  table: ImportTable;
  rowTotal: number;
}

export interface ImportStartFrame {
  totalPhases: number;
  /**
   * Sum of `rowTotal` across all phases. Lets the client render a
   * progress bar denominated in rows-of-work rather than equal-width
   * phase segments, so a 3-row phase doesn't claim the same width as
   * a 38K-row phase.
   */
  totalRows: number;
  phases: ImportPhaseDescriptor[];
}

export interface ImportPhaseFrame {
  /** 0-indexed position in the pipeline. */
  index: number;
  total: number;
  table: ImportTable;
  rowTotal: number;
  /** false on the "phase started" frame, true on the "phase completed" frame. */
  done: boolean;
  /** Only present when `done === true`. */
  result?: ImportTableResult;
}

export interface ImportPhaseProgressFrame {
  index: number;
  total: number;
  table: ImportTable;
  rowsDone: number;
  rowTotal: number;
}

export interface ImportDoneFrame {
  result: Partial<Record<ImportTable, ImportTableResult>>;
}

/**
 * Union of SSE event names. Used as the type parameter to
 * `makeSseStream<…>` on the server so the emit() callback is restricted
 * to known event names.
 */
export type ImportFrameEvent =
  | "start"
  | "phase"
  | "phase-progress"
  | "done";
