import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { activities, events } from "@/db/schema";
import { POST } from "./route";

/**
 * Contract coverage for the composite-merge route. The headline is M1:
 * two SAME-source events merge into a composite. `source` is the sync
 * layer, not the device — a Garmin and a Whoop both syncing one ride to
 * Strava arrive as two source='strava' events for one real session, so
 * same-source merge must succeed (it used to 409). Runs against per-test
 * pglite (default user id=1).
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

async function seedEvent(
  activityId: number,
  source: string,
  startedAt: string,
  status: "visible" | "hidden_by_composite" | "composite" = "visible",
): Promise<number> {
  const [e] = await ctx
    .getDb()
    .insert(events)
    .values({ userId: 1, activityId, type: "Ride", startedAt, source, status })
    .returning({ id: events.id });
  return e.id;
}

describe("POST /api/events/merge — composite merge", () => {
  it("M1: two SAME-source events merge into a composite (same-source allowed)", async () => {
    const activityId = await seedActivity("Ride");
    // Two strava events 30s apart: a Garmin + a Whoop recording of one ride.
    const a = await seedEvent(activityId, "strava", "2026-05-14T12:00:00.000Z");
    const b = await seedEvent(activityId, "strava", "2026-05-14T12:00:30.000Z");

    const res = await POST(req({ memberIds: [a, b], activityId }));
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect(typeof id).toBe("number");

    const all = await ctx.getDb().select().from(events);
    const composite = all.find((e) => e.id === id);
    expect(composite?.status).toBe("composite");
    expect(composite?.source).toBe("composite");
    expect(composite?.compositeMemberIds).toEqual([Math.min(a, b), Math.max(a, b)]);

    // Members flip to hidden_by_composite (kept, not deleted).
    expect(all.find((e) => e.id === a)?.status).toBe("hidden_by_composite");
    expect(all.find((e) => e.id === b)?.status).toBe("hidden_by_composite");
  });

  it("M2: cross-source merge still works", async () => {
    const activityId = await seedActivity("Ride");
    const a = await seedEvent(activityId, "strava", "2026-05-14T12:00:00.000Z");
    const b = await seedEvent(activityId, "apple_health", "2026-05-14T12:05:00.000Z");

    const res = await POST(req({ memberIds: [a, b], activityId }));
    expect(res.status).toBe(200);
  });

  it("M3: a non-visible member is still rejected (guard intact)", async () => {
    const activityId = await seedActivity("Ride");
    const a = await seedEvent(activityId, "strava", "2026-05-14T12:00:00.000Z");
    const hidden = await seedEvent(
      activityId,
      "strava",
      "2026-05-14T12:00:30.000Z",
      "hidden_by_composite",
    );

    const res = await POST(req({ memberIds: [a, hidden], activityId }));
    expect(res.status).toBe(409);
  });
});
