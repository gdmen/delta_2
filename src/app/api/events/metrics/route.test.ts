import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { users, sports, events, metricTypes, eventMetrics } from "@/db/schema";
import { GET } from "./route";

/**
 * Batch event-metrics endpoint that powers the composite-merge modal's
 * per-member metric display. Runs against per-test pglite (default user
 * id=1).
 */

const ctx = setupRouteTest();

function get(ids: string): NextRequest {
  return new NextRequest(`http://test/api/events/metrics?ids=${ids}`);
}

async function seedSport(name: string): Promise<number> {
  const [s] = await ctx
    .getDb()
    .insert(sports)
    .values({ userId: 1, name, color: "#000" })
    .returning({ id: sports.id });
  return s.id;
}

async function seedMetricType(name: string, unit: string): Promise<number> {
  const [mt] = await ctx
    .getDb()
    .insert(metricTypes)
    .values({ userId: 1, name, unit })
    .returning({ id: metricTypes.id });
  return mt.id;
}

async function seedEvent(sportId: number, userId = 1): Promise<number> {
  const [e] = await ctx
    .getDb()
    .insert(events)
    .values({
      userId,
      sportId,
      type: "Ride",
      startedAt: "2026-05-17T18:41:00.000Z",
      source: "strava",
      status: "visible",
    })
    .returning({ id: events.id });
  return e.id;
}

async function seedEventMetric(eventId: number, metricTypeId: number, value: number) {
  await ctx.getDb().insert(eventMetrics).values({ eventId, metricTypeId, value });
}

describe("GET /api/events/metrics", () => {
  it("groups metrics by event id, ordered by metric-type name", async () => {
    const sportId = await seedSport("Ride");
    const distance = await seedMetricType("distance", "km");
    const avgHr = await seedMetricType("avg_hr", "bpm");
    const e1 = await seedEvent(sportId);
    const e2 = await seedEvent(sportId);
    await seedEventMetric(e1, distance, 42.1);
    await seedEventMetric(e1, avgHr, 148);
    await seedEventMetric(e2, distance, 42.0);

    const res = await GET(get(`${e1},${e2}`));
    expect(res.status).toBe(200);
    const { metrics } = (await res.json()) as {
      metrics: Record<number, { name: string; unit: string | null; value: number }[]>;
    };

    // e1 has both, ordered alphabetically by name (avg_hr before distance).
    expect(metrics[e1].map((m) => m.name)).toEqual(["avg_hr", "distance"]);
    expect(metrics[e1]).toEqual([
      { name: "avg_hr", unit: "bpm", value: 148 },
      { name: "distance", unit: "km", value: 42.1 },
    ]);
    expect(metrics[e2]).toEqual([{ name: "distance", unit: "km", value: 42.0 }]);
  });

  it("excludes events the caller doesn't own", async () => {
    await ctx
      .getDb()
      .insert(users)
      .values({ id: 2, displayName: "other" })
      .onConflictDoNothing();
    const sportId = await seedSport("Ride");
    const distance = await seedMetricType("distance", "km");
    const mine = await seedEvent(sportId, 1);
    const theirs = await seedEvent(sportId, 2);
    await seedEventMetric(mine, distance, 10);
    await seedEventMetric(theirs, distance, 99);

    const res = await GET(get(`${mine},${theirs}`));
    const { metrics } = (await res.json()) as { metrics: Record<number, unknown[]> };
    expect(metrics[mine]).toHaveLength(1);
    expect(metrics[theirs]).toBeUndefined();
  });

  it("400 when ids param is missing or empty", async () => {
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(new NextRequest("http://test/api/events/metrics"))).status).toBe(400);
  });
});
