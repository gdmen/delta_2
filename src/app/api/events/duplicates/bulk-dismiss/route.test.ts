import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { activities, events, eventDuplicateDenylist } from "@/db/schema";
import { groupCandidates, findDuplicateCandidates } from "@/lib/duplicates/detector";
import { POST } from "./route";

/**
 * Behavior coverage for the batched multi-group dismiss (#35). The
 * headline case is B1: the group's canonical A/B (alphabetical) is the
 * REVERSE of the raw pair's A/B (id order), so a forward-only match
 * would dismiss nothing — the loop's both-orientations check must catch
 * it. Runs against per-test pglite (default user id=1).
 */

const ctx = setupRouteTest();

function req(body?: unknown): NextRequest {
  const init: { method: string; headers?: Record<string, string>; body?: string } = {
    method: "POST",
  };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new NextRequest("http://test/", init as ConstructorParameters<typeof NextRequest>[1]);
}

async function seedActivity(name: string): Promise<number> {
  const [s] = await ctx
    .getDb()
    .insert(activities)
    .values({ userId: 1, name, color: "#000" })
    .returning({ id: activities.id });
  return s.id;
}

async function seedEvent(activityId: number, source: string, startedAt: string): Promise<number> {
  const [e] = await ctx
    .getDb()
    .insert(events)
    .values({ userId: 1, activityId, type: "x", startedAt, source, status: "visible" })
    .returning({ id: events.id });
  return e.id;
}

describe("bulk-dismiss — batched multi-group (#35)", () => {
  it("B1: flipped orientation — group A/B is the reverse of pair A/B, still dismissed", async () => {
    // Smaller id = alphabetically-LATER activity, so groupCandidates flips
    // A/B relative to the raw pair's id ordering.
    const ride = await seedActivity("Ride"); // sorts after "Cycling"
    const cycling = await seedActivity("Cycling");
    // X inserted first → smaller id. X is strava/Ride.
    const x = await seedEvent(ride, "strava", "2026-05-14T12:00:00.000Z");
    // Y larger id. Y is apple_health/Cycling. 30 min later → within 60.
    const y = await seedEvent(cycling, "apple_health", "2026-05-14T12:30:00.000Z");

    // Sanity: the raw pair orders by id (x<y), the group orders alpha.
    const pairs = await findDuplicateCandidates(1, { recent: false }, ctx.getDb());
    expect(pairs).toHaveLength(1);
    const group = groupCandidates(pairs)[0];
    // Confirm the flip: pair's A is strava/Ride, but group's A is the
    // alphabetically-first = apple_health/Cycling.
    expect(pairs[0].aId).toBe(x);
    expect(pairs[0].aSource).toBe("strava");
    expect(group.sourceA).toBe("apple_health");
    expect(group.sourceB).toBe("strava");

    const res = await POST(
      req({
        groups: [
          {
            sourceA: group.sourceA,
            activityIdA: group.activityIdA,
            sourceB: group.sourceB,
            activityIdB: group.activityIdB,
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).dismissed).toBe(1);

    // Denylist row stored with eventAId < eventBId.
    const rows = await ctx.getDb().select().from(eventDuplicateDenylist);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventAId).toBe(Math.min(x, y));
    expect(rows[0].eventBId).toBe(Math.max(x, y));
  });

  it("B2: multiple groups in one call dismiss all their pairs", async () => {
    const ride = await seedActivity("Ride");
    const cycling = await seedActivity("Cycling");
    const lift = await seedActivity("Lifting");
    const run = await seedActivity("Running");
    // Group 1: strava/Ride + apple_health/Cycling
    const x1 = await seedEvent(ride, "strava", "2026-05-14T12:00:00.000Z");
    const y1 = await seedEvent(cycling, "apple_health", "2026-05-14T12:10:00.000Z");
    // Group 2: teambuildr/Lifting + strava/Running
    const x2 = await seedEvent(lift, "teambuildr", "2026-05-15T09:00:00.000Z");
    const y2 = await seedEvent(run, "strava", "2026-05-15T09:20:00.000Z");

    const groups = groupCandidates(
      await findDuplicateCandidates(1, { recent: false }, ctx.getDb()),
    );
    expect(groups).toHaveLength(2);

    const res = await POST(
      req({
        groups: groups.map((g) => ({
          sourceA: g.sourceA,
          activityIdA: g.activityIdA,
          sourceB: g.sourceB,
          activityIdB: g.activityIdB,
        })),
      }),
    );
    expect((await res.json()).dismissed).toBe(2);
    const rows = await ctx.getDb().select().from(eventDuplicateDenylist);
    expect(rows).toHaveLength(2);
    // Sanity both pairs present.
    void [x1, y1, x2, y2];
  });

  it("B3: selecting one group leaves the other's pairs intact", async () => {
    const ride = await seedActivity("Ride");
    const cycling = await seedActivity("Cycling");
    const lift = await seedActivity("Lifting");
    const run = await seedActivity("Running");
    await seedEvent(ride, "strava", "2026-05-14T12:00:00.000Z");
    await seedEvent(cycling, "apple_health", "2026-05-14T12:10:00.000Z");
    await seedEvent(lift, "teambuildr", "2026-05-15T09:00:00.000Z");
    await seedEvent(run, "strava", "2026-05-15T09:20:00.000Z");

    const groups = groupCandidates(
      await findDuplicateCandidates(1, { recent: false }, ctx.getDb()),
    );
    const one = groups[0];
    const res = await POST(
      req({
        groups: [
          { sourceA: one.sourceA, activityIdA: one.activityIdA, sourceB: one.sourceB, activityIdB: one.activityIdB },
        ],
      }),
    );
    expect((await res.json()).dismissed).toBe(1);
    // The other group's pair still surfaces in the detector (not denylisted).
    const remaining = await findDuplicateCandidates(1, { recent: false }, ctx.getDb());
    expect(remaining).toHaveLength(1);
  });

  it("B4: idempotent — re-dismissing the same group inserts no dupes", async () => {
    const ride = await seedActivity("Ride");
    const cycling = await seedActivity("Cycling");
    await seedEvent(ride, "strava", "2026-05-14T12:00:00.000Z");
    await seedEvent(cycling, "apple_health", "2026-05-14T12:10:00.000Z");
    const groups = groupCandidates(
      await findDuplicateCandidates(1, { recent: false }, ctx.getDb()),
    );
    const tuple = {
      sourceA: groups[0].sourceA, activityIdA: groups[0].activityIdA,
      sourceB: groups[0].sourceB, activityIdB: groups[0].activityIdB,
    };
    await POST(req({ groups: [tuple] }));
    const res2 = await POST(req({ groups: [tuple] }));
    // Second pass: the pair is already denylisted so the detector no
    // longer returns it → 0 to dismiss.
    expect((await res2.json()).dismissed).toBe(0);
    expect(await ctx.getDb().select().from(eventDuplicateDenylist)).toHaveLength(1);
  });

  it("B5: empty groups array → 400", async () => {
    expect((await POST(req({ groups: [] }))).status).toBe(400);
  });

  it("B6: malformed tuple → 400", async () => {
    expect((await POST(req({ groups: [{ sourceA: "x" }] }))).status).toBe(400);
  });

  it("B7: tuple matching no pair → dismissed 0, no rows", async () => {
    const ride = await seedActivity("Ride");
    const cycling = await seedActivity("Cycling");
    await seedEvent(ride, "strava", "2026-05-14T12:00:00.000Z");
    await seedEvent(cycling, "apple_health", "2026-05-14T12:10:00.000Z");
    const res = await POST(
      req({ groups: [{ sourceA: "nope", activityIdA: 9999, sourceB: "nada", activityIdB: 8888 }] }),
    );
    expect((await res.json()).dismissed).toBe(0);
    expect(await ctx.getDb().select().from(eventDuplicateDenylist)).toHaveLength(0);
  });
});
