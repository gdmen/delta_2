/**
 * Generic CSV import mapping: the data model + pure functions that turn
 * a raw CSV row into zero-or-more typed domain records.
 *
 * Shapes are persisted JSON in import_sources.mapping. Keep this module
 * server-pure (no DB writes, no fetches) so the wizard's preview endpoint
 * can call it without side effects.
 */

// -----------------------------------------------------------------------------
// Mapping types
// -----------------------------------------------------------------------------

/**
 * Column reference. Either a named header ("column": "Date") or a 1-based
 * index fallback for CSVs with empty/duplicate headers ("index": 3).
 */
export type ColumnRef = { column: string } | { index: number };

/**
 * A value slot: take from a column, use a literal, or leave blank.
 *
 * Column slots may carry an `aliases` map that rewrites raw cell values to
 * canonical ones before the slot is consumed. Lets one mapping handle
 * heterogeneous CSVs - e.g. FitNotes where Exercise="Stationary Bike"
 * should become sport="biking" and Exercise="BJJ" should become
 * sport="bjj", from a single mapping, one column.
 *
 * Values not listed in `aliases` pass through unchanged.
 */
export type ValueSlot =
  | { source: "column"; ref: ColumnRef; aliases?: Record<string, string> }
  | { source: "literal"; value: string }
  | { source: "none" };

export type DateFormat =
  | "auto"        // ISO 8601 or anything new Date() can parse
  | "YYYY-MM-DD"
  | "MM/DD/YYYY"
  | "DD/MM/YYYY"
  | "MM-DD-YYYY"
  | "D-MMM-YY";   // "03-Oct-14"

/** Simple row predicate used to filter mixed-kind CSVs (e.g. FitNotes). */
export type RowFilter =
  | { column: string; op: "equals" | "notEquals"; value: string }
  | { column: string; op: "in" | "notIn"; values: string[] }
  | { column: string; op: "nonEmpty" };

/** Wide (fixed metric name) or long (metric name in a column) target entry. */
export type MetricTarget = {
  // Wide: { literal: "protein_g" } — the metric name is hard-coded.
  // Long: { column: "Measurement" } — name comes from the row.
  name: ValueSlot;
  value: ValueSlot;
  unit?: ValueSlot;
};

export type MetricsMapping = {
  kind: "metrics";
  recordedAt: { ref: ColumnRef; format: DateFormat };
  metrics: MetricTarget[];
  sourceId?: ValueSlot;
  rowFilter?: RowFilter;
};

export type EventsMapping = {
  kind: "events";
  startedAt: { ref: ColumnRef; format: DateFormat };
  sport: ValueSlot;
  type: ValueSlot;
  durationMinutes?: ValueSlot; // value may be raw minutes OR "HH:MM:SS" OR "7 hr 30 min"
  notes?: ValueSlot;
  sourceId?: ValueSlot;
  rowFilter?: RowFilter;
  // Additional per-event dimensions: distance, calories, avg HR, elevation,
  // etc. Same shape as a MetricsMapping entry - one metric name + value +
  // optional unit. Landing in the event_metrics sidecar, keyed by event_id.
  metrics?: MetricTarget[];
};

/**
 * How to interpret the Weight column. Some apps (e.g. TeamBuildr) store
 * weights in a single column with mixed units - big barbell compounds in
 * kg, cable/accessory work in lb, no per-row indicator. Rather than store
 * units per set, Delta normalizes everything to lb on write. The mapping
 * declares a default unit + an exception list of exercise names (in the
 * canonical form that lands in workout_sets.exercise_name) whose weights
 * are in the other unit.
 */
export type WeightUnitConfig = {
  default: "lb" | "kg";
  /** Exercises whose weights are in the non-default unit. Case-insensitive. */
  overrides?: string[];
};

export type WorkoutSetsMapping = {
  kind: "workout_sets";
  startedAt: { ref: ColumnRef; format: DateFormat };
  sport: ValueSlot;
  eventType: ValueSlot; // e.g. "strength"
  eventSourceId?: ValueSlot; // groups sets by source id (TeamBuildr's WorkoutId)
  exerciseName: ValueSlot;
  setNumber?: ValueSlot; // defaults to row order within (startedAt, eventSourceId)
  reps: ValueSlot;
  weight: ValueSlot;
  weightUnit?: WeightUnitConfig;
  rpe?: ValueSlot;
  notes?: ValueSlot;
  rowFilter?: RowFilter;
};

export type ImportMapping = MetricsMapping | EventsMapping | WorkoutSetsMapping;

/**
 * Every column name this mapping reads from. Covers top-level ValueSlots,
 * the date-ref columns, nested per-metric targets (both the metrics-kind
 * array and the events-kind `metrics` sidecar), and the rowFilter column.
 * Used to (a) populate dropdown options when we don't have a live CSV header
 * list, and (b) compute which uploaded CSV columns the mapping is ignoring.
 */
export function collectReferencedColumns(m: ImportMapping): Set<string> {
  const acc = new Set<string>();
  const addSlot = (s: ValueSlot | undefined) => {
    if (!s || s.source !== "column") return;
    if ("column" in s.ref && s.ref.column) acc.add(s.ref.column);
  };
  const addRef = (r: { ref: ColumnRef } | undefined) => {
    if (r && "column" in r.ref && r.ref.column) acc.add(r.ref.column);
  };
  const addMetricTargets = (targets: MetricTarget[] | undefined) => {
    for (const t of targets ?? []) {
      addSlot(t.name);
      addSlot(t.value);
      addSlot(t.unit);
    }
  };

  if (m.kind === "metrics") {
    addRef(m.recordedAt);
    addMetricTargets(m.metrics);
    addSlot(m.sourceId);
  } else if (m.kind === "events") {
    addRef(m.startedAt);
    addSlot(m.sport);
    addSlot(m.type);
    addSlot(m.durationMinutes);
    addSlot(m.notes);
    addSlot(m.sourceId);
    addMetricTargets(m.metrics);
  } else {
    addRef(m.startedAt);
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
  return acc;
}

// -----------------------------------------------------------------------------
// Output shapes (kind-discriminated records fed to the importer)
// -----------------------------------------------------------------------------

export type OutMetric = {
  kind: "metric";
  metric: string;
  value: number;
  unit?: string | null;
  recordedAt: string;
  sourceId?: string | null;
};

export type OutEvent = {
  kind: "event";
  startedAt: string;
  sport: string;
  type: string;
  durationMinutes?: number | null;
  notes?: string | null;
  sourceId?: string | null;
  /** Per-event numeric dimensions (distance, calories, avg HR, etc.). */
  metrics?: { metric: string; value: number; unit?: string | null }[];
};

export type OutWorkoutSet = {
  kind: "workout_set";
  startedAt: string;
  sport: string;
  eventType: string;
  eventSourceId?: string | null;
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number;
  rpe?: number | null;
  notes?: string | null;
};

export type OutRow = OutMetric | OutEvent | OutWorkoutSet;

// -----------------------------------------------------------------------------
// Helpers: read value from a CSV row given a ref / slot
// -----------------------------------------------------------------------------

export function lookup(headers: string[], row: string[], ref: ColumnRef | null | undefined): string {
  // Defensive: malformed mappings (e.g. a Claude-proposed mapping missing
  // a required field) can pass undefined refs through. Treat as empty.
  if (!ref || typeof ref !== "object") return "";
  if ("column" in ref) {
    const i = headers.indexOf(ref.column);
    return i >= 0 ? row[i] ?? "" : "";
  }
  if ("index" in ref && typeof ref.index === "number") {
    const i = ref.index - 1;
    return i >= 0 && i < row.length ? row[i] ?? "" : "";
  }
  return "";
}

export function readSlot(
  headers: string[],
  row: string[],
  slot: ValueSlot | undefined
): string {
  if (!slot || slot.source === "none") return "";
  if (slot.source === "literal") return slot.value ?? "";
  if (slot.source !== "column") return "";
  const raw = lookup(headers, row, slot.ref).trim();
  if (slot.aliases && Object.prototype.hasOwnProperty.call(slot.aliases, raw)) {
    return slot.aliases[raw];
  }
  return raw;
}

// -----------------------------------------------------------------------------
// Parsers
// -----------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date string per the selected format. Returns ISO 8601 in UTC.
 *
 * The `tz` argument controls how naive inputs (a date without time, or a
 * date+time without explicit offset) are anchored: midnight or the
 * stated wall-clock time is interpreted in `tz`, then converted to UTC.
 * Without this, a "2026-05-07" sleep entry from a PT user landed as
 * 00:00Z, which is 17:00 the previous day in PT — a one-day misfile on
 * every date-only row. Pass the user's IANA timezone (from
 * `loadUserTimezone()`); when undefined the function falls back to UTC
 * for backwards-compat.
 */
export function parseDate(
  raw: string,
  format: DateFormat,
  tz?: string,
): string | null {
  const s = raw.trim();
  if (!s) return null;

  let y: number, m: number, d: number;

  if (format === "auto") {
    // If the input already carries an explicit offset (Z or ±HH:MM),
    // honor it — Date.parse pins the instant correctly. Otherwise
    // treat the parsed wall clock as `tz`-local.
    const hasExplicitOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    if (hasExplicitOffset || !tz) {
      return new Date(t).toISOString();
    }
    // Re-parse the components and rebuild as `tz`-local. Date.parse on
    // a naive string treats it as UTC for ISO-8601 dates, so we extract
    // the wall-clock parts from the input string instead of the parsed
    // Date (which would be UTC-shifted already).
    const isoMatch = s.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (isoMatch) {
      const [, ys, ms, ds, hs, mins, ss] = isoMatch;
      return zonedWallClockToUtcIso(
        +ys, +ms, +ds, +(hs ?? 0), +(mins ?? 0), +(ss ?? 0), tz,
      );
    }
    // Slash / dash formats with auto fall through to default behavior;
    // ECMA Date.parse on these is implementation-defined.
    return new Date(t).toISOString();
  }

  if (format === "YYYY-MM-DD") {
    const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m1) return null;
    [, y, m, d] = [0, +m1[1], +m1[2], +m1[3]];
  } else if (format === "MM/DD/YYYY") {
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m1) return null;
    m = +m1[1]; d = +m1[2]; y = +m1[3];
  } else if (format === "DD/MM/YYYY") {
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m1) return null;
    d = +m1[1]; m = +m1[2]; y = +m1[3];
  } else if (format === "MM-DD-YYYY") {
    const m1 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (!m1) return null;
    m = +m1[1]; d = +m1[2]; y = +m1[3];
  } else if (format === "D-MMM-YY") {
    const m1 = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
    if (!m1) return null;
    d = +m1[1];
    m = MONTHS[m1[2].toLowerCase()] ?? 0;
    if (!m) return null;
    const yy = +m1[3];
    // Two-digit years: 00-79 -> 2000s, 80-99 -> 1900s (covers imports from
    // legacy apps without going wrong until 2080).
    y = yy < 80 ? 2000 + yy : 1900 + yy;
  } else {
    return null;
  }

  if (!y || !m || !d) return null;
  if (tz) {
    return zonedWallClockToUtcIso(y, m, d, 0, 0, 0, tz);
  }
  const iso = `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}T00:00:00.000Z`;
  return iso;
}

/**
 * Convert a wall-clock time in IANA `tz` to a UTC ISO-8601 string.
 *
 * JS Date constructors only know "UTC" and "system local"; to express
 * "2026-05-07 00:00 in America/Los_Angeles" we anchor against UTC,
 * format that anchor in `tz` to recover its wall-clock representation
 * there, and use the difference as the offset. Standard one-step trick;
 * survives DST since the offset is computed for the specific instant.
 */
function zonedWallClockToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): string {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(naiveUtc))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  // Some locales render midnight as "24" — normalize.
  const h = parts.hour === "24" ? 0 : +parts.hour;
  const wallClockAsUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    h, +parts.minute, +parts.second,
  );
  const offsetMs = wallClockAsUtc - naiveUtc;
  return new Date(naiveUtc - offsetMs).toISOString();
}

/**
 * Parse a duration string to minutes. Handles:
 *   - plain number ("15" -> 15)
 *   - HH:MM:SS ("2:30:00" -> 150)
 *   - "X hr Y min" ("07 hr 30 min" -> 450)
 *   - "X min" ("15 min" -> 15)
 */
export function parseDuration(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // HH:MM:SS
  const hms = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (hms) {
    const h = +hms[1], mi = +hms[2], se = +hms[3];
    return Math.round(h * 60 + mi + se / 60);
  }

  // MM:SS
  const ms = s.match(/^(\d+):(\d{1,2})$/);
  if (ms) {
    return Math.round(+ms[1] + +ms[2] / 60);
  }

  // "X hr Y min" or "X hours Y minutes"
  const hr = s.match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours|h)\b/i);
  const mn = s.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|m)\b/i);
  if (hr || mn) {
    return Math.round((+(hr?.[1] ?? 0)) * 60 + (+(mn?.[1] ?? 0)));
  }

  // Plain number -> minutes
  const n = Number(s);
  if (Number.isFinite(n)) return Math.round(n);

  return null;
}

/** Conversion factor — kept full-precision so kg <-> lb round-trips losslessly. */
export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB; // 2.20462262...

/**
 * Normalize a raw weight value to lb using the mapping's weight-unit
 * config. Stored at full float precision; per-unit display rounding
 * happens at render time. When `cfg` is absent we assume lb for
 * backwards-compat.
 */
export function normalizeWeightToLb(
  raw: number,
  exerciseName: string,
  cfg: WeightUnitConfig | undefined
): number {
  if (!cfg) return raw;
  const lower = exerciseName.trim().toLowerCase();
  // Match the raw exercise name against each override entry, accepting
  // both the raw form ("21s") and the source-prefixed form
  // ("teambuildr:21s") that lands in metric_types after the orphan-first
  // resolver path. Stripping a leading `<word>:` from the override
  // covers UI-populated lists that pulled the canonical metric_type
  // names — without it, a row tagged "21s" in the CSV silently fell
  // through to the default unit and got converted (kg→lb), turning
  // 25 lb into ~55 lb.
  const isOverride = (cfg.overrides ?? []).some((e) => {
    const o = e.trim().toLowerCase();
    if (o === lower) return true;
    const colonIdx = o.indexOf(":");
    if (colonIdx > 0 && o.slice(colonIdx + 1) === lower) return true;
    return false;
  });
  const unit = isOverride ? (cfg.default === "lb" ? "kg" : "lb") : cfg.default;
  if (unit === "kg") return raw * LB_PER_KG;
  return raw;
}

/** Strip commas, $, and whitespace before Number(). Returns null if not finite. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/[,$\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// -----------------------------------------------------------------------------
// Row filter
// -----------------------------------------------------------------------------

export function rowPasses(headers: string[], row: string[], filter: RowFilter | undefined): boolean {
  if (!filter) return true;
  const idx = headers.indexOf(filter.column);
  if (idx < 0) return true; // missing column: don't filter
  const cell = (row[idx] ?? "").trim();
  switch (filter.op) {
    case "equals": return cell === filter.value;
    case "notEquals": return cell !== filter.value;
    case "in": return filter.values.includes(cell);
    case "notIn": return !filter.values.includes(cell);
    case "nonEmpty": return cell !== "";
  }
}

// -----------------------------------------------------------------------------
// applyMapping: turn one CSV row into zero-or-more typed output rows
// -----------------------------------------------------------------------------

export function applyMapping(
  mapping: ImportMapping,
  headers: string[],
  row: string[],
  /** 0-based row index; used as a stable set-number fallback. */
  rowIdx: number,
  /** User's IANA timezone for naive-date interpretation. Optional;
   * undefined falls back to UTC midnight (legacy behavior). */
  tz?: string,
): { out: OutRow[]; error?: string } {
  if (!rowPasses(headers, row, mapping.rowFilter)) return { out: [] };

  try {
    switch (mapping.kind) {
      case "metrics": return applyMetrics(mapping, headers, row, tz);
      case "events":  return applyEvent(mapping, headers, row, tz);
      case "workout_sets": return applyWorkoutSet(mapping, headers, row, rowIdx, tz);
    }
  } catch (err) {
    return { out: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function applyMetrics(
  m: MetricsMapping,
  headers: string[],
  row: string[],
  tz?: string,
): { out: OutRow[]; error?: string } {
  if (!m.recordedAt?.ref) return { out: [], error: "mapping missing recordedAt column" };
  const recordedAt = parseDate(lookup(headers, row, m.recordedAt.ref), m.recordedAt.format ?? "auto", tz);
  if (!recordedAt) return { out: [], error: "could not parse date" };

  const sourceIdBase = readSlot(headers, row, m.sourceId);
  const out: OutRow[] = [];

  for (const target of m.metrics) {
    const metricName = readSlot(headers, row, target.name);
    if (!metricName) continue;

    const valueStr = readSlot(headers, row, target.value);
    const value = parseNumber(valueStr);
    if (value === null) continue;

    const unit = target.unit ? readSlot(headers, row, target.unit) || null : null;

    out.push({
      kind: "metric",
      metric: metricName,
      value,
      unit,
      recordedAt,
      sourceId: sourceIdBase ? `${sourceIdBase}-${metricName}` : null,
    });
  }

  return { out };
}

function applyEvent(
  m: EventsMapping,
  headers: string[],
  row: string[],
  tz?: string,
): { out: OutRow[]; error?: string } {
  if (!m.startedAt?.ref) return { out: [], error: "mapping missing startedAt column" };
  const startedAt = parseDate(lookup(headers, row, m.startedAt.ref), m.startedAt.format ?? "auto", tz);
  if (!startedAt) return { out: [], error: "could not parse date" };

  const sport = readSlot(headers, row, m.sport);
  const type = readSlot(headers, row, m.type);
  if (!sport || !type) return { out: [], error: "missing sport/type" };

  const duration = m.durationMinutes
    ? parseDuration(readSlot(headers, row, m.durationMinutes))
    : null;
  const notes = m.notes ? readSlot(headers, row, m.notes) || null : null;
  const sourceId = m.sourceId ? readSlot(headers, row, m.sourceId) || null : null;

  // Attached per-event metrics (distance, calories, avg HR, etc.). Mirrors
  // the metrics-kind MetricTarget pipeline - skip entries whose value cell
  // is blank/non-numeric so a single row that has distance but no HR works.
  const attachedMetrics: NonNullable<OutEvent["metrics"]> = [];
  for (const target of m.metrics ?? []) {
    const metricName = readSlot(headers, row, target.name);
    if (!metricName) continue;
    const valueStr = readSlot(headers, row, target.value);
    const value = parseNumber(valueStr);
    if (value === null) continue;
    const unit = target.unit ? readSlot(headers, row, target.unit) || null : null;
    attachedMetrics.push({ metric: metricName, value, unit });
  }

  return {
    out: [
      {
        kind: "event",
        startedAt,
        sport,
        type,
        durationMinutes: duration,
        notes,
        sourceId,
        metrics: attachedMetrics.length > 0 ? attachedMetrics : undefined,
      },
    ],
  };
}

function applyWorkoutSet(
  m: WorkoutSetsMapping,
  headers: string[],
  row: string[],
  rowIdx: number,
  tz?: string,
): { out: OutRow[]; error?: string } {
  if (!m.startedAt?.ref) return { out: [], error: "mapping missing startedAt column" };
  const startedAt = parseDate(lookup(headers, row, m.startedAt.ref), m.startedAt.format ?? "auto", tz);
  if (!startedAt) return { out: [], error: "could not parse date" };

  const sport = readSlot(headers, row, m.sport);
  const eventType = readSlot(headers, row, m.eventType);
  const exerciseName = readSlot(headers, row, m.exerciseName);
  if (!sport || !eventType || !exerciseName) {
    return { out: [], error: "missing sport/event_type/exercise_name" };
  }

  const reps = parseNumber(readSlot(headers, row, m.reps));
  const rawWeight = parseNumber(readSlot(headers, row, m.weight));
  if (reps === null || rawWeight === null) {
    return { out: [], error: "non-numeric reps/weight" };
  }
  // Normalize to lb using the mapping's weight-unit config.
  const weight = normalizeWeightToLb(rawWeight, exerciseName, m.weightUnit);

  const setNumStr = m.setNumber ? readSlot(headers, row, m.setNumber) : "";
  const parsedSet = setNumStr ? parseNumber(setNumStr) : null;
  // Fall back to rowIdx+1 so sets retain order even when the CSV doesn't number them.
  const setNumber = parsedSet ?? rowIdx + 1;

  const rpe = m.rpe ? parseNumber(readSlot(headers, row, m.rpe)) : null;
  const notes = m.notes ? readSlot(headers, row, m.notes) || null : null;
  const eventSourceId = m.eventSourceId ? readSlot(headers, row, m.eventSourceId) || null : null;

  return {
    out: [
      {
        kind: "workout_set",
        startedAt,
        sport,
        eventType,
        eventSourceId,
        exerciseName,
        setNumber,
        reps,
        weight,
        rpe,
        notes,
      },
    ],
  };
}

/**
 * Heuristic for the workout-sets "Session ID" field: does the chosen
 * grouping column look like it identifies an EXERCISE (or row) rather than
 * a whole session? If a column has many more distinct values than there are
 * distinct dates, grouping events on it will split each day's workout into
 * lots of one-exercise events (the TeamBuildr WorkoutId trap). The wizard
 * uses this to warn the user to leave the field blank (→ group by date).
 *
 * ~1 id/day = one session per day (fine). The 1.5× cushion tolerates the
 * occasional two-a-day without nagging; 3.5×, like TeamBuildr, trips it.
 * Pure + exported for unit tests.
 */
export function sessionIdLooksTooGranular(
  distinctIds: number,
  distinctDates: number,
): boolean {
  if (distinctIds <= 0 || distinctDates <= 0) return false;
  return distinctIds > distinctDates * 1.5;
}

// -----------------------------------------------------------------------------
// Header auto-match (wizard pre-fill)
// -----------------------------------------------------------------------------

/**
 * Given CSV headers and a kind, return best-guess ValueSlot assignments
 * for obvious field -> header matches. Used to pre-fill the wizard UI.
 */
export function autoMatchHeaders(kind: ImportMapping["kind"], headers: string[]): Record<string, ColumnRef | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const pick = (...patterns: string[]): ColumnRef | null => {
    const n = headers.map(norm);
    for (const p of patterns) {
      const pn = norm(p);
      const i = n.findIndex((h) => h.includes(pn));
      if (i >= 0) return { column: headers[i] };
    }
    return null;
  };

  if (kind === "metrics") {
    return {
      recordedAt: pick("date", "timestamp", "datetime"),
      metric: pick("measurement", "metric", "name"),
      value: pick("value", "result", "qty"),
      unit: pick("unit", "units"),
      sourceId: pick("id", "uuid"),
    };
  }
  if (kind === "events") {
    return {
      startedAt: pick("date", "started", "timestamp"),
      sport: pick("sport", "activity", "category"),
      type: pick("type", "kind"),
      duration: pick("duration", "time", "elapsed"),
      notes: pick("notes", "comment", "description"),
      sourceId: pick("id", "workoutid", "sessionid"),
    };
  }
  // workout_sets
  return {
    startedAt: pick("completeddate", "date", "assigneddate"),
    // Deliberately NOT auto-matching "workoutid": in several exporters
    // (TeamBuildr) that id is per-EXERCISE, not per-session, so grouping on
    // it splits one day's workout into one event per exercise. Only match a
    // clear session id; otherwise leave blank → group by date. See the
    // eventSourceId help text in mapping-editor + sessionIdLooksTooGranular.
    eventSourceId: pick("sessionid"),
    exerciseName: pick("exercise", "movement", "lift"),
    setNumber: pick("setnumber", "set"),
    reps: pick("reps", "repetitions"),
    weight: pick("weight", "load", "result"),
    rpe: pick("rpe"),
    notes: pick("notes", "comment"),
  };
}
