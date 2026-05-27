import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { events, sports, workoutSets, eventMetrics, metricTypes } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { EventEditor } from "./editor";
import { CompositeView } from "./composite-view";
import { PromoteToCompositeButton } from "./promote-to-composite";
import { EventJournal } from "./event-journal";
import { loadEventJournal } from "./journal-data";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";
import { buildTypeSuggestionsBySportId } from "@/lib/duplicates/type-catalog";

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
      status: events.status,
      compositeMemberIds: events.compositeMemberIds,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .where(and(userScope(user.id).events, eq(events.id, id)))
    .limit(1);
  if (rows.length === 0) notFound();
  const event = rows[0];

  // Composite events render through a different layout: no editor,
  // member breakdown, unmerge button. Children (workout_sets,
  // event_metrics) are fetched across the member ids in the composite
  // view itself.
  // Shared by EventEditor (Type input datalist) and the promote-to-
  // composite modal below. Computed once before the composite-vs-regular
  // branch so the CompositeView can reuse it too.
  const typeSuggestionsBySportId = await buildTypeSuggestionsBySportId(user.id);

  if (event.status === "composite") {
    return (
      <CompositeView
        event={event}
        userId={user.id}
        typeSuggestionsBySportId={typeSuggestionsBySportId}
      />
    );
  }

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
    // Sort exercise-first so all sets of one lift stay contiguous, then
    // set # within each exercise. Tie-break on id so the order is fully
    // deterministic when two rows somehow share (exercise, set #).
    .orderBy(asc(metricTypes.name), asc(workoutSets.setNumber), asc(workoutSets.id));

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

  const journalEntries = await loadEventJournal(id, user.id);

  // For hidden_by_composite members, look up the parent composite so
  // the banner can link out. Composite ownership is guaranteed
  // (composite_member_ids only points at events owned by the same
  // user), but we still scope through userScope as defense-in-depth.
  let parentComposite: { id: number; sportName: string; type: string } | null = null;
  if (event.status === "hidden_by_composite") {
    const parents = await db
      .select({
        id: events.id,
        sportName: sports.name,
        type: events.type,
      })
      .from(events)
      .innerJoin(sports, eq(events.sportId, sports.id))
      .where(
        and(
          userScope(user.id).events,
          eq(events.status, "composite"),
          sql`${event.id} = ANY(${events.compositeMemberIds})`,
        ),
      )
      .limit(1);
    parentComposite = parents[0] ?? null;
  }

  return (
    <div className="max-w-[940px]">
      {parentComposite && (
        <div className="mb-4 px-3 py-2 bg-surface border border-border rounded text-[0.8125rem]">
          This event is part of a <span className="font-mono uppercase tracking-wider">composite</span>{" "}
          and is hidden from default views. Edits still save.{" "}
          <Link
            href={`/data/events/${parentComposite.id}`}
            className="underline hover:text-foreground"
          >
            Open composite #{parentComposite.id} ({parentComposite.sportName} · {parentComposite.type}) →
          </Link>
        </div>
      )}
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
        typeSuggestionsBySportId={typeSuggestionsBySportId}
      />

      <EventJournal eventId={event.id} initialEntries={journalEntries} />

      {/* Single-event promote action — only on regular visible events.
          Composites render through the CompositeView branch above;
          hidden_by_composite rows surface their parent composite for
          editing instead. */}
      {event.status === "visible" && (
        <div className="mt-8 pt-6 border-t border-border">
          <PromoteToCompositeButton
            member={{
              id: event.id,
              source: event.source,
              sportId: event.sportId,
              sportName: event.sportName,
              type: event.type,
              startedAt: event.startedAt,
              durationMinutes: event.durationMinutes,
            }}
            sportOptions={sportsList}
            typeSuggestionsBySportId={typeSuggestionsBySportId}
          />
          <p className="mt-2 text-[0.75rem] text-muted">
            Wraps this event in a composite with a sport you choose.
            Useful for retagging generic source types (Strava{" "}
            <code>Workout</code>, Apple Health <code>Other</code>) as
            the actual activity.
          </p>
        </div>
      )}
    </div>
  );
}
