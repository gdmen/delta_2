"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatShort, utcIsoToLocalInput } from "@/lib/format";

export interface MergeMember {
  id: number;
  source: string;
  sportId: number;
  sportName: string;
  type: string;
  startedAt: string;
  durationMinutes: number | null;
}

export interface SportOption {
  id: number;
  name: string;
}

/**
 * Inline modal for "wrap N events into a composite".
 *
 *  - N=1: promote — retag a single event with a corrected canonical
 *    sport while keeping the source row's data accessible via the
 *    composite. Title reads "Promote to composite event".
 *  - N≥2: merge — fold multiple cross-source rows for the same physical
 *    session into one composite. Title reads "Merge into composite
 *    event".
 *
 * Either way: user picks the sport (defaults to the least
 * source-prefixed sport name across members), tweaks type / started_at
 * / duration / notes, and confirms. Sends POST /api/events/merge with
 * `memberIds: number[]`. No two members may share a source.
 */
export function CompositeMergeModal({
  members,
  sportOptions,
  typeSuggestionsBySportId,
  onClose,
  onSuccess,
}: {
  /** One or more members. Order is preserved in the rendered list. */
  members: MergeMember[];
  sportOptions: SportOption[];
  /**
   * Existing `events.type` values seen for each sport_id, used to
   * populate the type input's datalist. Free-text — the input doesn't
   * restrict to these. Omit for no suggestions.
   */
  typeSuggestionsBySportId?: Record<number, string[]>;
  onClose: () => void;
  /** Optional callback fired with the new composite's id after success. */
  onSuccess?: (compositeId: number) => void;
}) {
  const router = useRouter();
  const isPromote = members.length === 1;

  const [sportId, setSportId] = useState<number>(pickDefaultSport(members));
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

  const typeSuggestions =
    typeSuggestionsBySportId?.[sportId]?.filter((t) => t.trim().length > 0) ?? [];

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
        sportId,
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
            <MemberRow key={m.id} m={m} />
          ))}
        </div>

        <div>
          <label className="block text-[0.75rem] text-muted uppercase tracking-wider mb-1">
            Composite sport
          </label>
          <select
            value={sportId}
            onChange={(e) => setSportId(Number(e.target.value))}
            disabled={submitting}
            className="w-full px-2 py-1.5 border border-border rounded text-[0.875rem] bg-background"
          >
            {sportOptions.map((s) => (
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
              existing types for this sport: {typeSuggestions.join(", ")}
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

function MemberRow({ m }: { m: MergeMember }) {
  const time = formatShort(m.startedAt);
  return (
    <div className="border border-border rounded px-3 py-2 flex justify-between gap-3 font-mono text-[0.75rem]">
      <span className="text-muted uppercase tracking-wider truncate">
        {m.source}
      </span>
      <span className="truncate">
        {m.sportName} · {m.type}
      </span>
      <span className="text-muted whitespace-nowrap">
        {time}
        {m.durationMinutes ? ` · ${m.durationMinutes}m` : ""}
      </span>
    </div>
  );
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

function pickDefaultSport(members: MergeMember[]): number {
  // Prefer the first non-source-prefixed sport ("powerlifting" over
  // "strava:WeightTraining"). If all are prefixed (or none are),
  // fall back to the first member's sport.
  const unprefixed = members.find((m) => !m.sportName.includes(":"));
  return unprefixed?.sportId ?? members[0].sportId;
}
