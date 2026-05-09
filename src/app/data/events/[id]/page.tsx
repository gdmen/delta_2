import { notFound } from "next/navigation";
import { db } from "@/db";
import { events, sports, workoutSets, eventMetrics, metricTypes } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { EventEditor } from "./editor";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUserOrSignin();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const rows = await db
    .select({
      id: events.id,
      sportId: events.sportId,
      sportName: sports.name,
      type: events.type,
      durationMinutes: events.durationMinutes,
      notes: events.notes,
      startedAt: events.startedAt,
      source: events.source,
      sourceId: events.sourceId,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(and(userScope(user.id).events, eq(events.id, id)))
    .limit(1);
  if (rows.length === 0) notFound();
  const event = rows[0];

  const sportsList = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(userScope(user.id).sports)
    .orderBy(asc(sports.name));

  // workout_sets + event_metrics are INHERIT — restrict by joining
  // through this user's events. Even though `event` is already this
  // user's, defense-in-depth on every read.
  const ownedEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(userScope(user.id).events);

  // Join metric_types to get the human-readable exercise name. The editor
  // keeps exerciseName in its form state; writes go back through the
  // resolver on PATCH.
  const sets = await db
    .select({
      id: workoutSets.id,
      eventId: workoutSets.eventId,
      exerciseName: metricTypes.name,
      setNumber: workoutSets.setNumber,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      rpe: workoutSets.rpe,
      notes: workoutSets.notes,
    })
    .from(workoutSets)
    .innerJoin(metricTypes, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    .where(
      and(
        eq(workoutSets.eventId, id),
        inArray(workoutSets.eventId, ownedEventIds),
      ),
    )
    .orderBy(asc(workoutSets.setNumber));

  const emRows = await db
    .select({
      metricTypeId: eventMetrics.metricTypeId,
      value: eventMetrics.value,
      name: metricTypes.name,
      unit: metricTypes.unit,
    })
    .from(eventMetrics)
    .innerJoin(metricTypes, eq(eventMetrics.metricTypeId, metricTypes.id))
    .where(
      and(
        eq(eventMetrics.eventId, id),
        inArray(eventMetrics.eventId, ownedEventIds),
      ),
    )
    .orderBy(asc(metricTypes.name));

  const metricTypesList = await db
    .select({ id: metricTypes.id, name: metricTypes.name, unit: metricTypes.unit })
    .from(metricTypes)
    .where(userScope(user.id).metricTypes)
    .orderBy(asc(metricTypes.name));

  return (
    <div className="max-w-[940px]">
      <h1 className="text-2xl font-semibold mb-2">
        Event #{event.id}{" "}
        <span className="text-muted text-[0.875rem] font-mono">
          {event.sportName} · {event.type}
        </span>
      </h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        {event.source === "manual"
          ? "Manual entry."
          : `Imported from ${event.source}. Edits may be overwritten on next sync.`}
      </p>

      <EventEditor
        event={event}
        sports={sportsList}
        initialSets={sets}
        initialEventMetrics={emRows}
        metricTypes={metricTypesList}
      />
    </div>
  );
}
