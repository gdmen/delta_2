import { db } from "@/db";
import { metrics, events, workoutSets, dailySummaries } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export interface IngestResult {
  accepted: number;
  skipped: number;
  errors: string[];
}

export interface MetricInput {
  metricTypeId: number;
  value: number;
  recordedAt: string;
  source: string;
  sourceId?: string | null;
}

export interface EventInput {
  sportId: number;
  type: string;
  durationMinutes?: number | null;
  notes?: string | null;
  startedAt: string;
  source: string;
  sourceId?: string | null;
}

export interface WorkoutSetInput {
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number;
  rpe?: number | null;
  notes?: string | null;
}

export async function upsertMetric(input: MetricInput): Promise<"accepted" | "skipped"> {
  if (input.sourceId) {
    const existing = await db.select({ id: metrics.id })
      .from(metrics)
      .where(eq(metrics.sourceId, input.sourceId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(metrics)
        .set({ value: input.value, recordedAt: input.recordedAt })
        .where(eq(metrics.sourceId, input.sourceId));
      return "skipped";
    }
  }

  await db.insert(metrics).values({
    metricTypeId: input.metricTypeId,
    value: input.value,
    recordedAt: input.recordedAt,
    source: input.source,
    sourceId: input.sourceId,
  });

  await invalidateDailySummary(input.metricTypeId, input.recordedAt);
  return "accepted";
}

export async function upsertEvent(input: EventInput): Promise<{ status: "accepted" | "skipped"; eventId: number }> {
  if (input.sourceId) {
    const existing = await db.select({ id: events.id })
      .from(events)
      .where(eq(events.sourceId, input.sourceId))
      .limit(1);

    if (existing.length > 0) {
      return { status: "skipped", eventId: existing[0].id };
    }
  }

  const result = await db.insert(events).values({
    sportId: input.sportId,
    type: input.type,
    durationMinutes: input.durationMinutes,
    notes: input.notes,
    startedAt: input.startedAt,
    source: input.source,
    sourceId: input.sourceId,
  }).returning({ id: events.id });

  return { status: "accepted", eventId: result[0].id };
}

export async function insertWorkoutSets(eventId: number, sets: WorkoutSetInput[]): Promise<number> {
  if (sets.length === 0) return 0;

  const rows = sets.map((s) => ({
    eventId,
    exerciseName: s.exerciseName,
    setNumber: s.setNumber,
    reps: s.reps,
    weight: s.weight,
    rpe: s.rpe,
    notes: s.notes,
  }));

  await db.insert(workoutSets).values(rows);
  return rows.length;
}

/**
 * Upsert a single workout set by (eventId, exerciseName, setNumber).
 * Used by the CSV importer so re-importing the same file doesn't duplicate
 * rows. There's no unique index on that tuple, so we look up first and
 * update-or-insert application-side.
 */
export async function upsertWorkoutSet(
  eventId: number,
  input: WorkoutSetInput
): Promise<"accepted" | "updated"> {
  const existing = await db
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.eventId, eventId),
        eq(workoutSets.exerciseName, input.exerciseName),
        eq(workoutSets.setNumber, input.setNumber)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(workoutSets)
      .set({
        reps: input.reps,
        weight: input.weight,
        rpe: input.rpe,
        notes: input.notes,
      })
      .where(eq(workoutSets.id, existing[0].id));
    return "updated";
  }

  await db.insert(workoutSets).values({
    eventId,
    exerciseName: input.exerciseName,
    setNumber: input.setNumber,
    reps: input.reps,
    weight: input.weight,
    rpe: input.rpe,
    notes: input.notes,
  });
  return "accepted";
}

export async function batchUpsertMetrics(inputs: MetricInput[]): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, skipped: 0, errors: [] };

  for (const input of inputs) {
    try {
      const status = await upsertMetric(input);
      if (status === "accepted") result.accepted++;
      else result.skipped++;
    } catch (err) {
      result.errors.push(`Failed metric ${input.metricTypeId} at ${input.recordedAt}: ${err}`);
    }
  }

  return result;
}

async function invalidateDailySummary(metricTypeId: number, recordedAt: string) {
  const date = recordedAt.slice(0, 10);
  const now = new Date().toISOString();

  await db.insert(dailySummaries).values({
    date,
    metricTypeId,
    count: 0,
    lastIngestAt: now,
  }).onConflictDoUpdate({
    target: [dailySummaries.date, dailySummaries.metricTypeId],
    set: { lastIngestAt: now },
  });
}
