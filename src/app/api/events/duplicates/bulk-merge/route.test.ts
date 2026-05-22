import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { sports, events } from "@/db/schema";
import { POST } from "./route";

/**
 * Bulk-merge for one source/sport group on /data/duplicates. Headline is
 * BM2: a session recorded 3 times within the group clusters into ONE
 * composite (naive pair-by-pair would 409 on the second merge). Runs
 * against per-test pglite (default user id=1).
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

async function seedSport(name: string): Promise<number> {
  const [s] = await ctx
    .getDb()
    .insert(sports)
    .values({ userId: 1, name, color: "#000" })
    .returning({ id: sports.id });
  return s.id;
}

async function seedEvent(
  sportId: number,
  source: string,
  startedAt: string,
  durationMinutes: number,
): Promise<number> {
  const [e] = await ctx
    .getDb()
    .insert(events)
    .values({ userId: 1, sportId, type: "Ride", startedAt, source, durationMinutes, status: "visible" })
    .returning({ id: events.id });
  return e.id;
}

async function allEvents() {
  return ctx.getDb().select().from(events);
}

describe("POST /api/events/duplicates/bulk-merge", () => {
  it("BM1: a 2-event pair merges into one composite with the chosen sport + max duration", async () => {
    const stravaRide = await seedSport("strava:Ride");
    const whoopRide = await seedSport("whoop:Ride");
    const cleanRide = await seedSport("Ride");
    const a = await seedEvent(stravaRide, "strava", "2026-05-17T18:00:00.000Z", 99);
    const b = await seedEvent(whoopRide, "whoop", "2026-05-17T18:05:00.000Z", 120);

    const res = await POST(
      req({
        group: { sourceA: "strava", sportIdA: stravaRide, sourceB: "whoop", sportIdB: whoopRide },
        sportId: cleanRide,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, merged: 1, events: 2 });

    const rows = await allEvents();
    const composite = rows.find((e) => e.status === "composite");
    expect(composite?.sportId).toBe(cleanRide);
    expect(composite?.compositeMemberIds).toEqual([Math.min(a, b), Math.max(a, b)]);
    expect(composite?.durationMinutes).toBe(120); // max(99, 120)
    expect(rows.find((e) => e.id === a)?.status).toBe("hidden_by_composite");
    expect(rows.find((e) => e.id === b)?.status).toBe("hidden_by_composite");
  });

  it("BM2: a thrice-recorded session clusters into ONE composite, not two", async () => {
    const stravaRide = await seedSport("strava:Ride");
    const whoopRide = await seedSport("whoop:Ride");
    const cleanRide = await seedSport("Ride");
    // One strava ride near TWO whoop recordings → pairs s-w1 and s-w2 both
    // in the (strava:Ride + whoop:Ride) group, sharing the strava event.
    const s = await seedEvent(stravaRide, "strava", "2026-05-17T18:00:00.000Z", 90);
    const w1 = await seedEvent(whoopRide, "whoop", "2026-05-17T18:10:00.000Z", 30);
    const w2 = await seedEvent(whoopRide, "whoop", "2026-05-17T18:40:00.000Z", 85);

    const res = await POST(
      req({
        group: { sourceA: "strava", sportIdA: stravaRide, sourceB: "whoop", sportIdB: whoopRide },
        sportId: cleanRide,
      }),
    );
    expect(await res.json()).toEqual({ ok: true, merged: 1, events: 3 });

    const rows = await allEvents();
    const composites = rows.filter((e) => e.status === "composite");
    expect(composites).toHaveLength(1);
    expect(composites[0].compositeMemberIds.sort((x, y) => x - y)).toEqual(
      [s, w1, w2].sort((x, y) => x - y),
    );
    expect(composites[0].durationMinutes).toBe(90); // max(90, 30, 85)
    for (const id of [s, w1, w2]) {
      expect(rows.find((e) => e.id === id)?.status).toBe("hidden_by_composite");
    }
  });

  it("BM3: a group matching no pairs merges nothing", async () => {
    const stravaRide = await seedSport("strava:Ride");
    await seedEvent(stravaRide, "strava", "2026-05-17T18:00:00.000Z", 60);
    const res = await POST(
      req({
        group: { sourceA: "strava", sportIdA: stravaRide, sourceB: "whoop", sportIdB: 9999 },
        sportId: stravaRide,
      }),
    );
    expect(await res.json()).toEqual({ ok: true, merged: 0, events: 0 });
    expect((await allEvents()).filter((e) => e.status === "composite")).toHaveLength(0);
  });

  it("BM4: malformed body → 400", async () => {
    expect((await POST(req({ group: { sourceA: "x" }, sportId: 1 }))).status).toBe(400);
    expect((await POST(req({ group: { sourceA: "a", sportIdA: 1, sourceB: "b", sportIdB: 2 } }))).status).toBe(400);
  });

  it("BM5: unowned composite sport → 400, nothing merged", async () => {
    const stravaRide = await seedSport("strava:Ride");
    const whoopRide = await seedSport("whoop:Ride");
    await seedEvent(stravaRide, "strava", "2026-05-17T18:00:00.000Z", 99);
    await seedEvent(whoopRide, "whoop", "2026-05-17T18:05:00.000Z", 120);
    const res = await POST(
      req({
        group: { sourceA: "strava", sportIdA: stravaRide, sourceB: "whoop", sportIdB: whoopRide },
        sportId: 123456,
      }),
    );
    expect(res.status).toBe(400);
    expect((await allEvents()).filter((e) => e.status === "composite")).toHaveLength(0);
  });
});
