import Link from "next/link";
import { db } from "@/db";
import {
  events,
  activities,
  workoutSets,
  eventMetrics,
  metricTypes,
} from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";
import { formatShort } from "@/lib/format";
import { EventEditor } from "./editor";
import { UnmergeButton } from "./unmerge-button";
import { EventJournal } from "./event-journal";
import { loadEventJournal } from "./journal-data";

interface CompositeEventRow {
  id: number;
  activityId: number;
  activityName: string;
  type: string;
  durationMinutes: number | null;
  notes: string | null;
  startedAt: string;
  source: string;
  sourceId: string | null;
  status: "visible" | "hidden_by_composite" | "composite";
  compositeMemberIds: number[];
}

/**
 * Server component rendering the composite-event view: top-line
 * summary, expandable Sources panel listing the member events, unioned
 * child rows (workout_sets + event_metrics) across all members, and
 * the Unmerge action.
 *
 * Children stay attached to the member rows in the DB; this view
 * fetches them via `WHERE event_id = ANY(composite_member_ids)`. That
 * keeps the merge / unmerge operations cheap (no re-parenting needed).
 */
export async function CompositeView({
  event,
  userId,
  typeSuggestionsByActivityId,
}: {
  event: CompositeEventRow;
  userId: number;
  typeSuggestionsByActivityId?: Record<number, string[]>;
}) {
  const memberIds = event.compositeMemberIds;

  // Members — full detail for the Sources panel.
  const members = memberIds.length
    ? await db
        .select({
          id: events.id,
          activityName: activities.name,
          type: events.type,
          startedAt: events.startedAt,
          durationMinutes: events.durationMinutes,
          source: events.source,
          notes: events.notes,
        })
        .from(events)
        .innerJoin(activities, eq(events.activityId, activities.id))
        .where(
          and(
            userScope(userId).events,
            inArray(events.id, memberIds),
          ),
        )
        .orderBy(asc(events.startedAt))
    : [];

  // Child rows: union across member ids. Owner-scoped via the inner
  // events.user_id join even though INHERIT.
  const ownedEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(userScope(userId).events);

  const sets = memberIds.length
    ? await db
        .select({
          id: workoutSets.id,
          eventId: workoutSets.eventId,
          eventSource: events.source,
          exerciseName: metricTypes.name,
          setNumber: workoutSets.setNumber,
          reps: workoutSets.reps,
          weight: workoutSets.weight,
          rpe: workoutSets.rpe,
          notes: workoutSets.notes,
        })
        .from(workoutSets)
        .innerJoin(events, eq(events.id, workoutSets.eventId))
        .innerJoin(metricTypes, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
        .where(
          and(
            inArray(workoutSets.eventId, memberIds),
            inArray(workoutSets.eventId, ownedEventIds),
          ),
        )
        // Per member event (startedAt), then exercise-first so all sets of
        // one lift stay contiguous, then set #. Tie-break on id.
        .orderBy(
          asc(events.startedAt),
          asc(metricTypes.name),
          asc(workoutSets.setNumber),
          asc(workoutSets.id),
        )
    : [];

  const ems = memberIds.length
    ? await db
        .select({
          eventId: eventMetrics.eventId,
          eventSource: events.source,
          name: metricTypes.name,
          unit: metricTypes.unit,
          value: eventMetrics.value,
        })
        .from(eventMetrics)
        .innerJoin(events, eq(events.id, eventMetrics.eventId))
        .innerJoin(metricTypes, eq(eventMetrics.metricTypeId, metricTypes.id))
        .where(
          and(
            inArray(eventMetrics.eventId, memberIds),
            inArray(eventMetrics.eventId, ownedEventIds),
          ),
        )
        .orderBy(asc(events.source), asc(metricTypes.name))
    : [];

  // Activities list for the editor's activity dropdown. The composite owns
  // its own activity/type/duration/started_at/notes; the EventEditor
  // (in headerOnly mode) PATCHes /api/events/<composite.id> directly.
  const activitiesList = await db
    .select({ id: activities.id, name: activities.name })
    .from(activities)
    .where(userScope(userId).activities)
    .orderBy(asc(activities.name));

  // Journal entries written on the composite itself. On unmerge these
  // get copied to the member events the user selects (see UnmergeButton).
  const journalEntries = await loadEventJournal(event.id, userId);

  return (
    <div className="max-w-[940px] space-y-8">
      <header>
        <div className="flex items-baseline gap-3 mb-1">
          <h1 className="text-2xl font-semibold">Event #{event.id}</h1>
          <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-accent-orange border border-accent-orange rounded px-2 py-0.5">
            composite
          </span>
        </div>
      </header>

      {/* Editable header — activity, type, started_at, duration, notes.
          Children sections and Delete button are suppressed via
          headerOnly; children belong to the member rows and the
          composite's tear-down lives in the Unmerge button below. */}
      <EventEditor
        event={event}
        activities={activitiesList}
        initialSets={[]}
        initialEventMetrics={[]}
        metricTypes={[]}
        headerOnly
        typeSuggestionsByActivityId={typeSuggestionsByActivityId}
      />

      <section>
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3 border-b border-border pb-2">
          Sources ({members.length})
        </h2>
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="border border-border rounded px-3 py-2 flex justify-between items-baseline gap-3 font-mono text-[0.75rem]"
            >
              <div className="flex gap-3 items-baseline min-w-0">
                <Link
                  href={`/data/events/${m.id}`}
                  className="text-muted uppercase tracking-wider hover:text-foreground whitespace-nowrap"
                  title="Open this source event"
                >
                  {m.source}
                </Link>
                <span className="truncate">
                  {m.activityName} · {m.type}
                </span>
              </div>
              <span className="text-muted whitespace-nowrap">
                {formatShort(m.startedAt)}
                {m.durationMinutes ? ` · ${m.durationMinutes}m` : ""}
              </span>
            </div>
          ))}
        </div>
      </section>

      {ems.length > 0 && (
        <section>
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3 border-b border-border pb-2">
            Event metrics (combined)
          </h2>
          <table className="w-full text-[0.8125rem]">
            <thead className="bg-surface text-[0.6875rem] uppercase tracking-wider text-muted">
              <tr>
                <th className="text-left font-mono font-semibold px-3 py-2">Source</th>
                <th className="text-left font-mono font-semibold px-3 py-2">Metric</th>
                <th className="text-right font-mono font-semibold px-3 py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {ems.map((em, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono text-[0.6875rem] text-muted uppercase tracking-wider">
                    {em.eventSource}
                  </td>
                  <td className="px-3 py-1.5">{em.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {em.value}
                    {em.unit ? ` ${em.unit}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sets.length > 0 && (
        <section>
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted mb-3 border-b border-border pb-2">
            Workout sets (combined)
          </h2>
          <table className="w-full text-[0.8125rem]">
            <thead className="bg-surface text-[0.6875rem] uppercase tracking-wider text-muted">
              <tr>
                <th className="text-left font-mono font-semibold px-3 py-2">Source</th>
                <th className="text-left font-mono font-semibold px-3 py-2">Exercise</th>
                <th className="text-right font-mono font-semibold px-3 py-2">Set</th>
                <th className="text-right font-mono font-semibold px-3 py-2">Reps</th>
                <th className="text-right font-mono font-semibold px-3 py-2">Weight</th>
                <th className="text-right font-mono font-semibold px-3 py-2">RPE</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono text-[0.6875rem] text-muted uppercase tracking-wider">
                    {s.eventSource}
                  </td>
                  <td className="px-3 py-1.5">{s.exerciseName}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {s.setNumber}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {s.reps}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {s.weight}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {s.rpe ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <EventJournal eventId={event.id} initialEntries={journalEntries} />

      <section className="pt-4 border-t border-border">
        <UnmergeButton
          compositeId={event.id}
          journalCount={journalEntries.length}
          members={members.map((m) => ({
            id: m.id,
            label: `${m.source} · ${m.activityName} · ${m.type}`,
          }))}
        />
      </section>
    </div>
  );
}
