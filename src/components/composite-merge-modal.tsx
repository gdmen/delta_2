"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatShort, utcIsoToLocalInput } from "@/lib/format";

export interface MergeMember {
  id: number;
  source: string;
  activityId: number;
  activityName: string;
  type: string;
  startedAt: string;
  durationMinutes: number | null;
}

/** One per-event metric (distance, avg HR, …) as returned by
 * GET /api/events/metrics. */
type EventMetric = { name: string; unit: string | null; value: number };

export interface ActivityOption {
  id: number;
  name: string;
}

/**
 * Inline modal for "wrap N events into a composite".
 *
 *  - N=1: promote — retag a single event with a corrected canonical
 *    activity while keeping the source row's data accessible via the
 *    composite. Title reads "Promote to composite event".
 *  - N≥2: merge — fold multiple rows for the same physical session into
 *    one composite. Title reads "Merge into composite event".
 *
 * Either way: user picks the activity (defaults to the least
 * source-prefixed activity name across members), tweaks type / started_at
 * / duration / notes, and confirms. Sends POST /api/events/merge with
 * `memberIds: number[]`. Members may share a source (two devices syncing
 * one session to the same integration is a valid composite).
 */
export function CompositeMergeModal({
  members,
  activityOptions,
  typeSuggestionsByActivityId,
  onClose,
  onSuccess,
}: {
  /** One or more members. Order is preserved in the rendered list. */
  members: MergeMember[];
  activityOptions: ActivityOption[];
  /**
   * Existing `events.type` values seen for each activity_id, used to
   * populate the type input's datalist. Free-text — the input doesn't
   * restrict to these. Omit for no suggestions.
   */
  typeSuggestionsByActivityId?: Record<number, string[]>;
  onClose: () => void;
  /** Optional callback fired with the new composite's id after success. */
  onSuccess?: (compositeId: number) => void;
}) {
  const router = useRouter();
  const isPromote = members.length === 1;

  const [activityId, setActivityId] = useState<number>(pickDefaultActivity(members));
  const [type, setType] = useState<string>(members[0].type);
  const [notes, setNotes] = useState("");
  // Defaults: earliest member's startedAt; duration is the max member
  // duration (closer to "this is what actually happened" than the
  // auto-computed span between earliest start and latest end, which
  // can be wildly inflated by clock skew between sources).
  const [startedAt, setStartedAt] = useState<string>(
    utcIsoToLocalInput(defaultStartedAt(members)),
  );
  const [durationMinutes, setDurationMinutes] = useState<string>(
    defaultDuration(members)?.toString() ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Member metrics (distance, avg HR, …), fetched on open so the user can
  // compare recordings before merging — e.g. which Strava ride carries the
  // real distance/duration. null = still loading.
  const [metricsByEvent, setMetricsByEvent] = useState<Record<
    number,
    EventMetric[]
  > | null>(null);
  const memberIdsKey = members.map((m) => m.id).join(",");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/metrics?ids=${memberIdsKey}`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((j: { metrics: Record<number, EventMetric[]> }) => {
        if (!cancelled) setMetricsByEvent(j.metrics ?? {});
      })
      .catch(() => {
        if (!cancelled) setMetricsByEvent({});
      });
    return () => {
      cancelled = true;
    };
  }, [memberIdsKey]);

  const typeSuggestions =
    typeSuggestionsByActivityId?.[activityId]?.filter((t) => t.trim().length > 0) ?? [];

  async function submit() {
    setSubmitting(true);
    setErr(null);
    const durTrimmed = durationMinutes.trim();
    const durNum = durTrimmed === "" ? null : Number(durTrimmed);
    if (durNum !== null && (!Number.isFinite(durNum) || durNum < 1)) {
      setErr("Duration must be a positive number of minutes");
      setSubmitting(false);
      return;
    }
    const startedAtIso = startedAt
      ? new Date(startedAt).toISOString()
      : undefined;
    if (startedAt && Number.isNaN(new Date(startedAt).getTime())) {
      setErr("Started at must be a valid date/time");
      setSubmitting(false);
      return;
    }
    const res = await fetch("/api/events/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberIds: members.map((m) => m.id),
        activityId,
        type: type.trim() || undefined,
        notes: notes.trim() || null,
        startedAt: startedAtIso,
        durationMinutes: durNum,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `HTTP ${res.status}`);
      setSubmitting(false);
      return;
    }
    const j = (await res.json()) as { id: number };
    onClose();
    if (onSuccess) {
      onSuccess(j.id);
    } else {
      router.refresh();
    }
  }

  const title = isPromote
    ? "Promote to composite event"
    : "Merge into composite event";
  const confirmLabel = submitting
    ? isPromote
      ? "Promoting…"
      : "Merging…"
    : isPromote
      ? "Promote"
      : `Merge ${members.length}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg max-w-lg w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[1rem] font-semibold">{title}</h2>

        <div className="space-y-2 text-[0.8125rem]">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              m={m}
              metrics={metricsByEvent?.[m.id]}
              loading={metricsByEvent === null}
            />
          ))}
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
            Composite activity
          </label>
          <select
            value={activityId}
            onChange={(e) => setActivityId(Number(e.target.value))}
            disabled={submitting}
            className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
          >
            {activityOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
            Composite type
          </label>
          <input
            type="text"
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={submitting}
            list="composite-type-suggestions"
            placeholder="e.g. open_mat, class, training"
            className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
          />
          {typeSuggestions.length > 0 && (
            <datalist id="composite-type-suggestions">
              {typeSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          )}
          {typeSuggestions.length > 0 && (
            <p className="mt-1 text-[0.6875rem] font-mono text-muted">
              existing types for this activity: {typeSuggestions.join(", ")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
              Started at
            </label>
            <input
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              disabled={submitting}
              className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono bg-background"
            />
          </div>
          <div>
            <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              step="any"
              min="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              disabled={submitting}
              placeholder="blank = null"
              className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] font-mono bg-background"
            />
          </div>
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
            Notes <span className="normal-case text-muted">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={3}
            className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background resize-none"
          />
        </div>

        {err && (
          <div className="text-[0.8125rem] text-accent-red">{err}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-[0.8125rem] text-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1.5 text-[0.8125rem] bg-foreground text-background rounded hover:opacity-90 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  m,
  metrics,
  loading,
}: {
  m: MergeMember;
  metrics?: EventMetric[];
  loading: boolean;
}) {
  const time = formatShort(m.startedAt);
  return (
    <div className="border border-border rounded px-3 py-2 font-mono text-[0.75rem] space-y-1">
      <div className="flex justify-between gap-3">
        <span className="text-muted uppercase tracking-wider truncate">
          {m.source}
        </span>
        <span className="truncate">
          {m.activityName} · {m.type}
        </span>
        <span className="text-muted whitespace-nowrap">
          {time}
          {m.durationMinutes ? ` · ${m.durationMinutes}m` : ""}
        </span>
      </div>
      {/* Per-event metrics so the user can compare recordings (which
          distance/HR/duration is real) before merging. */}
      {loading ? (
        <div className="text-[0.6875rem] text-muted/70">loading metrics…</div>
      ) : metrics && metrics.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6875rem] text-muted">
          {metrics.map((mm) => (
            <span key={mm.name}>
              {mm.name} {formatMetricValue(mm.value)}
              {mm.unit ? ` ${mm.unit}` : ""}
            </span>
          ))}
        </div>
      ) : metrics ? (
        <div className="text-[0.6875rem] text-muted/50">no metrics</div>
      ) : null}
    </div>
  );
}

function formatMetricValue(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

function defaultStartedAt(members: MergeMember[]): string {
  return members.reduce(
    (acc, m) => (m.startedAt < acc ? m.startedAt : acc),
    members[0].startedAt,
  );
}

function defaultDuration(members: MergeMember[]): number | null {
  // Single-member: keep the member's duration. N-member: max of all
  // member durations. That's almost always the "real" session length
  // — e.g. Strava reports 90min + Whoop reports 30min + Apple Health
  // reports 85min for one BJJ session = actual session ≈ 90min, not
  // the computed span which can be inflated by clock skew.
  if (members.length === 1) return members[0].durationMinutes;
  const max = members.reduce(
    (acc, m) => Math.max(acc, m.durationMinutes ?? 0),
    0,
  );
  return max > 0 ? max : null;
}

function pickDefaultActivity(members: MergeMember[]): number {
  // Prefer the first non-source-prefixed activity ("powerlifting" over
  // "strava:WeightTraining"). If all are prefixed (or none are),
  // fall back to the first member's activity.
  const unprefixed = members.find((m) => !m.activityName.includes(":"));
  return unprefixed?.activityId ?? members[0].activityId;
}
