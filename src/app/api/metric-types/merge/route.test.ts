import { describe, expect, it, vi } from "vitest";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { POST as mergePost } from "./route";
import { POST as undoPost } from "@/app/api/merges/[id]/undo/route";
import {
  metricTypes,
  metrics,
  metricTypeAliases,
  dailySummaries,
  mergeLog,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest } from "next/server";

/**
 * End-to-end coverage for the merge + undo route handlers (not just the
 * inner builder/applier — those have their own unit tests). This catches
 * regressions in the route-level glue: request validation, transaction
 * setup, mergeLog payload write, and the raw SQL daily_summaries
 * collision-collapse that uses Postgres-specific LEAST() / GREATEST().
 *
 * The undo path additionally exercises the explicit-id reinsert with
 * `generatedByDefaultAsIdentity` and the sequence resync via
 * `setval(pg_get_serial_sequence(...))` — both Postgres-specific gotchas
 * that don't show up in pure-applier unit tests.
 */

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/metric-types/merge + /api/merges/[id]/undo (round-trip)", () => {
  const ctx = setupRouteTest();

  it("M1: merge returns mergeLogId, deletes merged row, inserts alias", async () => {
    const db = ctx.getDb();
    const [a] = await db
      .insert(metricTypes)
      .values({ name: "canonical", unit: "kg" })
      .returning({ id: metricTypes.id });
    const [b] = await db
      .insert(metricTypes)
      .values({ name: "to_be_merged", unit: "kg" })
      .returning({ id: metricTypes.id });
    await db.insert(metrics).values({
      metricTypeId: b.id,
      value: 75,
      recordedAt: "2026-05-08T12:00:00.000Z",
      source: "test",
    });

    const res = await mergePost(
      jsonReq({ canonicalId: a.id, mergeIds: [b.id] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      canonical: { id: number };
      merged: Array<{ mergeId: number; metricsMoved: number }>;
      mergeLogId: number;
    };
    expect(body.canonical.id).toBe(a.id);
    expect(body.merged[0].metricsMoved).toBe(1);
    expect(typeof body.mergeLogId).toBe("number");

    // Merged metric_type row deleted.
    expect(await db.select().from(metricTypes).where(eq(metricTypes.id, b.id))).toHaveLength(0);
    // Alias inserted so future ingests of "to_be_merged" route to canonical.
    const aliasRow = await db
      .select()
      .from(metricTypeAliases)
      .where(eq(metricTypeAliases.alias, "to_be_merged"));
    expect(aliasRow).toHaveLength(1);
    expect(aliasRow[0].canonicalMetricTypeId).toBe(a.id);
    // Metric re-pointed to canonical.
    const movedMetrics = await db
      .select()
      .from(metrics)
      .where(eq(metrics.metricTypeId, a.id));
    expect(movedMetrics).toHaveLength(1);
    expect(movedMetrics[0].value).toBe(75);
    // mergeLog row written with the right shape.
    const log = await db.select().from(mergeLog).where(eq(mergeLog.id, body.mergeLogId));
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe("metric_type");
    expect(log[0].canonicalId).toBe(a.id);
    expect(log[0].undoneAt).toBeNull();
  });

  it("M2: daily_summaries collision uses LEAST/GREATEST + weighted-avg ON CONFLICT", async () => {
    const db = ctx.getDb();
    const [a] = await db
      .insert(metricTypes)
      .values({ name: "weighted_canonical", unit: "kg" })
      .returning({ id: metricTypes.id });
    const [b] = await db
      .insert(metricTypes)
      .values({ name: "weighted_merged", unit: "kg" })
      .returning({ id: metricTypes.id });

    // Same date in both metric_types — the merge SQL must collapse them
    // via the ON CONFLICT(date, metric_type_id) DO UPDATE branch with
    // LEAST/GREATEST and a weighted average across counts.
    //
    //   canonical: avg=80 min=70 max=90 count=2  →  weight 2 * 80 = 160
    //   merged:    avg=100 min=95 max=120 count=3 →  weight 3 * 100 = 300
    //   collapsed: avg=(160+300)/(2+3)=92, min=LEAST(70,95)=70, max=GREATEST(90,120)=120
    //              count=2+3=5
    await db.insert(dailySummaries).values({
      metricTypeId: a.id,
      date: "2026-05-08",
      avgValue: 80,
      minValue: 70,
      maxValue: 90,
      count: 2,
      lastIngestAt: "2026-05-08T12:00:00.000Z",
    });
    await db.insert(dailySummaries).values({
      metricTypeId: b.id,
      date: "2026-05-08",
      avgValue: 100,
      minValue: 95,
      maxValue: 120,
      count: 3,
      lastIngestAt: "2026-05-08T18:00:00.000Z",
    });

    const res = await mergePost(jsonReq({ canonicalId: a.id, mergeIds: [b.id] }));
    expect(res.status).toBe(200);

    const collapsed = await db
      .select()
      .from(dailySummaries)
      .where(
        and(
          eq(dailySummaries.metricTypeId, a.id),
          eq(dailySummaries.date, "2026-05-08"),
        ),
      );
    expect(collapsed).toHaveLength(1);
    const r = collapsed[0];
    expect(r.count).toBe(5);
    expect(r.minValue).toBe(70); // LEAST(70, 95)
    expect(r.maxValue).toBe(120); // GREATEST(90, 120)
    expect(r.avgValue).toBeCloseTo(92, 5); // (2*80 + 3*100) / 5
    // The orphan summary on b.id should be gone (deleted post-collapse).
    expect(
      await db.select().from(dailySummaries).where(eq(dailySummaries.metricTypeId, b.id)),
    ).toHaveLength(0);
  });

  it("M3: undo restores merged row at original id; sequence advances past it", async () => {
    const db = ctx.getDb();
    const [a] = await db
      .insert(metricTypes)
      .values({ name: "undo_canonical", unit: "kg" })
      .returning({ id: metricTypes.id });
    const [b] = await db
      .insert(metricTypes)
      .values({ name: "undo_merged", unit: "kg" })
      .returning({ id: metricTypes.id });
    await db.insert(metrics).values({
      metricTypeId: b.id,
      value: 88,
      recordedAt: "2026-05-08T12:00:00.000Z",
      source: "test",
    });

    const mergeRes = await mergePost(
      jsonReq({ canonicalId: a.id, mergeIds: [b.id] }),
    );
    const { mergeLogId } = (await mergeRes.json()) as { mergeLogId: number };

    // Pre-undo: b.id no longer exists.
    expect(
      await db.select().from(metricTypes).where(eq(metricTypes.id, b.id)),
    ).toHaveLength(0);

    // Undo via the actual route handler.
    const undoRes = await undoPost(
      new NextRequest(`http://test/api/merges/${mergeLogId}/undo`, { method: "POST" }),
      { params: Promise.resolve({ id: String(mergeLogId) }) },
    );
    expect(undoRes.status).toBe(200);

    // Merged row reinserted AT THE SAME ORIGINAL ID.
    const restored = await db
      .select()
      .from(metricTypes)
      .where(eq(metricTypes.id, b.id));
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("undo_merged");
    // Metric moved back to b.id.
    const movedBack = await db
      .select()
      .from(metrics)
      .where(eq(metrics.metricTypeId, b.id));
    expect(movedBack).toHaveLength(1);
    expect(movedBack[0].value).toBe(88);

    // Sequence reset works: insert a new metric_type and verify it gets
    // an id strictly greater than the restored one. Without the
    // setval(pg_get_serial_sequence(...)) bump in applier.ts, Postgres'
    // identity sequence stays at its pre-merge value and the next
    // INSERT collides on b.id.
    const [fresh] = await db
      .insert(metricTypes)
      .values({ name: "post_undo_fresh", unit: "kg" })
      .returning({ id: metricTypes.id });
    expect(fresh.id).toBeGreaterThan(b.id);

    // mergeLog.undoneAt is set.
    const log = await db.select().from(mergeLog).where(eq(mergeLog.id, mergeLogId));
    expect(log[0].undoneAt).not.toBeNull();
  });

  it("M4: second undo of the same merge returns 409 (TOCTOU-safe)", async () => {
    const db = ctx.getDb();
    const [a] = await db
      .insert(metricTypes)
      .values({ name: "double_undo_canon", unit: "kg" })
      .returning({ id: metricTypes.id });
    const [b] = await db
      .insert(metricTypes)
      .values({ name: "double_undo_merged", unit: "kg" })
      .returning({ id: metricTypes.id });

    const mergeRes = await mergePost(
      jsonReq({ canonicalId: a.id, mergeIds: [b.id] }),
    );
    const { mergeLogId } = (await mergeRes.json()) as { mergeLogId: number };

    // First undo OK.
    const undo1 = await undoPost(
      new NextRequest(`http://test/api/merges/${mergeLogId}/undo`, { method: "POST" }),
      { params: Promise.resolve({ id: String(mergeLogId) }) },
    );
    expect(undo1.status).toBe(200);

    // Second undo: 409, no DB mutation.
    const undo2 = await undoPost(
      new NextRequest(`http://test/api/merges/${mergeLogId}/undo`, { method: "POST" }),
      { params: Promise.resolve({ id: String(mergeLogId) }) },
    );
    expect(undo2.status).toBe(409);
    const body = (await undo2.json()) as { error: string };
    expect(body.error).toMatch(/already undone/);
  });

  it("M5: merge with mismatched units rejected unless unitPolicy:rescale", async () => {
    const db = ctx.getDb();
    const [a] = await db
      .insert(metricTypes)
      .values({ name: "kg_canonical", unit: "kg" })
      .returning({ id: metricTypes.id });
    const [b] = await db
      .insert(metricTypes)
      .values({ name: "lb_merged", unit: "lb" })
      .returning({ id: metricTypes.id });

    const blocked = await mergePost(
      jsonReq({ canonicalId: a.id, mergeIds: [b.id] }),
    );
    expect(blocked.status).toBe(400);
    const blockBody = (await blocked.json()) as { error: string };
    expect(blockBody.error).toMatch(/unit mismatch/i);

    // Merged row still exists (transaction never started).
    expect(
      await db.select().from(metricTypes).where(eq(metricTypes.id, b.id)),
    ).toHaveLength(1);

    // With rescale + scale, the merge proceeds.
    const ok = await mergePost(
      jsonReq({
        canonicalId: a.id,
        mergeIds: [b.id],
        unitPolicy: "rescale",
        scales: { [b.id]: 0.453592 }, // lb → kg
      }),
    );
    expect(ok.status).toBe(200);
    expect(
      await db.select().from(metricTypes).where(eq(metricTypes.id, b.id)),
    ).toHaveLength(0);
  });
});
