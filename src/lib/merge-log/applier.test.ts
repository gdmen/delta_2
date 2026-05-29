import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import {
  metricTypes,
  metrics,
  metricTypeAliases,
  activities,
} from "@/db/schema";
import { applyMetricTypeUndo, applyActivityUndo } from "./applier";
import {
  MERGE_LOG_PAYLOAD_VERSION,
  type MetricTypeMergePayloadV1,
  type MetricTypeMergedEntry,
  type ActivityMergePayloadV1,
} from "./types";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  await testDb.clearSeedData();
  db = testDb.db;
});

afterEach(async () => {
  await testDb.pg.close();
});

/** Helper: build a metric_type merge payload entry with sane defaults. */
function entry(
  partial: Partial<MetricTypeMergedEntry> & {
    row: MetricTypeMergedEntry["row"];
  },
): MetricTypeMergedEntry {
  return {
    row: partial.row,
    scale: partial.scale ?? 1,
    metricsMovedIds: partial.metricsMovedIds ?? [],
    eventMetricsMovedIds: partial.eventMetricsMovedIds ?? [],
    eventMetricsDeleted: partial.eventMetricsDeleted ?? [],
    goalsMovedIds: partial.goalsMovedIds ?? [],
    journalEntriesMovedIds: partial.journalEntriesMovedIds ?? [],
    workoutSetsMovedIds: partial.workoutSetsMovedIds ?? [],
    aliasesRepointed: partial.aliasesRepointed ?? [],
  };
}

function payload(canonicalId: number, merged: MetricTypeMergedEntry[]): MetricTypeMergePayloadV1 {
  return {
    v: MERGE_LOG_PAYLOAD_VERSION,
    kind: "metric_type",
    canonicalId,
    merged,
  };
}

/** Setup helper: insert a metric_type with a specific id. */
async function insertType(id: number, name: string) {
  await db.insert(metricTypes)
    .values({ id, name, unit: "lb", frequencyHint: "daily" });
}

/** Setup helper: insert a metric with a specific id, type, and alias. */
async function insertMetric(args: {
  id: number;
  metricTypeId: number;
  alias: string | null;
  value?: number;
  source?: string;
}) {
  await db.insert(metrics)
    .values({
      id: args.id,
      metricTypeId: args.metricTypeId,
      value: args.value ?? 70,
      recordedAt: `2026-01-${String(args.id).padStart(2, "0")}T12:00:00Z`,
      source: args.source ?? "test",
      sourceId: `test-${args.id}`,
      alias: args.alias,
    });
}

/** Read a metric's metricTypeId by id. */
async function metricTypeOf(id: number): Promise<number> {
  return (await db.select().from(metrics).where(eq(metrics.id, id)))[0].metricTypeId;
}

/** Test: A1 — undo of a simple merge with no aliasesRepointed and no
 * post-merge ingests. Should match today's behavior: metricsMovedIds get
 * re-pointed to merged_id; nothing else moves. */
describe("applyMetricTypeUndo", () => {
  it("A1: simple undo with empty aliasesRepointed and no extra metrics", async () => {
    await insertType(100, "canonical");
    // Pretend the merge already ran: original metric_type id=50 is gone,
    // its metric (id=1) lives on canonical. No alias was repointed.
    await insertMetric({ id: 1, metricTypeId: 100, alias: "old_name" });
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });

    await db.transaction(async (tx) => {
      await applyMetricTypeUndo(
        tx,
        payload(100, [
          entry({
            row: {
              id: 50,
              name: "old_name",
              unit: "lb",
              activityId: null,
              frequencyHint: "daily",
              target: null,
              higherIsBetter: true,
            },
            metricsMovedIds: [1],
          }),
        ]),
      );
    });

    expect(await metricTypeOf(1)).toBe(50);
    // Alias deleted (it was inserted by the merge with name = old_name).
    expect(
      (await db.select().from(metricTypeAliases)).filter((a) => a.alias === "old_name"),
    ).toHaveLength(0);
  });

  it("A2: post-merge ingest with alias = merged.row.name moves back too", async () => {
    await insertType(100, "canonical");
    await insertMetric({ id: 1, metricTypeId: 100, alias: "old_name" }); // pre-merge, captured
    await insertMetric({ id: 2, metricTypeId: 100, alias: "old_name" }); // POST-merge, NOT captured
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });

    await db.transaction(async (tx) => {
      await applyMetricTypeUndo(
        tx,
        payload(100, [
          entry({
            row: {
              id: 50,
              name: "old_name",
              unit: "lb",
              activityId: null,
              frequencyHint: "daily",
              target: null,
              higherIsBetter: true,
            },
            metricsMovedIds: [1],
          }),
        ]),
      );
    });

    expect(await metricTypeOf(1)).toBe(50); // captured pre-merge
    expect(await metricTypeOf(2)).toBe(50); // NEW: matched by alias = merged.row.name
  });

  it("A3: post-merge ingest with alias in aliasesRepointed moves back too", async () => {
    await insertType(100, "canonical");
    // The merged row had id=50; an OLDER merge had inserted alias "ext_alias"
    // pointing to id=50. When we merged 50→100, that alias was re-pointed.
    await insertMetric({ id: 1, metricTypeId: 100, alias: "ext_alias" }); // post-merge ingest via re-pointed alias
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });
    await db.insert(metricTypeAliases)
      .values({ alias: "ext_alias", canonicalMetricTypeId: 100 });

    await db.transaction(async (tx) => {
      await applyMetricTypeUndo(
        tx,
        payload(100, [
          entry({
            row: {
              id: 50,
              name: "old_name",
              unit: "lb",
              activityId: null,
              frequencyHint: "daily",
              target: null,
              higherIsBetter: true,
            },
            metricsMovedIds: [],
            aliasesRepointed: ["ext_alias"],
          }),
        ]),
      );
    });

    expect(await metricTypeOf(1)).toBe(50);
  });

  it("A4: only matching-alias rows move; non-matching rows stay", async () => {
    await insertType(100, "canonical");
    await insertMetric({ id: 1, metricTypeId: 100, alias: "ext_alias" }); // matches aliasesRepointed
    await insertMetric({ id: 2, metricTypeId: 100, alias: "different_alias" }); // does NOT match
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });
    await db.insert(metricTypeAliases)
      .values({ alias: "ext_alias", canonicalMetricTypeId: 100 });
    await db.insert(metricTypeAliases)
      .values({ alias: "different_alias", canonicalMetricTypeId: 100 });

    await db.transaction(async (tx) => {
      await applyMetricTypeUndo(
        tx,
        payload(100, [
          entry({
            row: {
              id: 50,
              name: "old_name",
              unit: "lb",
              activityId: null,
              frequencyHint: "daily",
              target: null,
              higherIsBetter: true,
            },
            aliasesRepointed: ["ext_alias"],
          }),
        ]),
      );
    });

    expect(await metricTypeOf(1)).toBe(50); // moved
    expect(await metricTypeOf(2)).toBe(100); // stayed
  });

  it("A5: rows with alias=NULL are not moved by the alias rule", async () => {
    await insertType(100, "canonical");
    await insertMetric({ id: 1, metricTypeId: 100, alias: null }); // pre-PR ingest, no alias
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });

    await db.transaction(async (tx) => {
      await applyMetricTypeUndo(
        tx,
        payload(100, [
          entry({
            row: {
              id: 50,
              name: "old_name",
              unit: "lb",
              activityId: null,
              frequencyHint: "daily",
              target: null,
              higherIsBetter: true,
            },
            metricsMovedIds: [],
          }),
        ]),
      );
    });

    expect(await metricTypeOf(1)).toBe(100); // NULL alias means not chain-moved
  });

  it("A6: row in BOTH metricsMovedIds AND alias-rule path ends up correctly (idempotent)", async () => {
    await insertType(100, "canonical");
    await insertMetric({ id: 1, metricTypeId: 100, alias: "old_name" });
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });

    await db.transaction(async (tx) => {
      await applyMetricTypeUndo(
        tx,
        payload(100, [
          entry({
            row: {
              id: 50,
              name: "old_name",
              unit: "lb",
              activityId: null,
              frequencyHint: "daily",
              target: null,
              higherIsBetter: true,
            },
            metricsMovedIds: [1], // captured at merge
            // Also matches alias = merged.row.name = "old_name" so the
            // alias rule would also pick it. Result must be metric on id=50.
          }),
        ]),
      );
    });

    expect(await metricTypeOf(1)).toBe(50);
  });

  it("A7: payload missing aliasesRepointed (undefined) treated as empty list", async () => {
    await insertType(100, "canonical");
    await insertMetric({ id: 1, metricTypeId: 100, alias: "anything" });
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });

    // Build payload literally without aliasesRepointed (simulates an
    // old log row written before the field existed).
    const oldPayload: MetricTypeMergePayloadV1 = {
      v: MERGE_LOG_PAYLOAD_VERSION,
      kind: "metric_type",
      canonicalId: 100,
      merged: [
        {
          row: {
            id: 50,
            name: "old_name",
            unit: "lb",
            activityId: null,
            frequencyHint: "daily",
            target: null,
            higherIsBetter: true,
          },
          scale: 1,
          metricsMovedIds: [],
          eventMetricsMovedIds: [],
          eventMetricsDeleted: [],
          goalsMovedIds: [],
          journalEntriesMovedIds: [],
          workoutSetsMovedIds: [],
          // aliasesRepointed deliberately omitted
        },
      ],
    };

    await expect(
      db.transaction(async (tx) => applyMetricTypeUndo(tx, oldPayload))
    ).resolves.not.toThrow();
    // metric stays on canonical (alias != merged.row.name, no aliasesRepointed)
    expect(await metricTypeOf(1)).toBe(100);
  });

  it("A8: merged.row.name ALSO present in aliasesRepointed — alias survives undo", async () => {
    await insertType(100, "canonical");
    await db.insert(metricTypeAliases)
      .values({ alias: "old_name", canonicalMetricTypeId: 100 });

    await db.transaction(async (tx) => {
      await applyMetricTypeUndo(
        tx,
        payload(100, [
          entry({
            row: {
              id: 50,
              name: "old_name",
              unit: "lb",
              activityId: null,
              frequencyHint: "daily",
              target: null,
              higherIsBetter: true,
            },
            // The alias was both pre-existing AND inserted by the merge
            // (because merged.row.name == an existing alias). On undo,
            // the alias should be re-pointed to merged_id, not deleted.
            aliasesRepointed: ["old_name"],
          }),
        ]),
      );
    });

    const aliases = await db.select().from(metricTypeAliases);
    const oldName = aliases.find((a) => a.alias === "old_name");
    expect(oldName).toBeDefined();
    expect(oldName!.canonicalMetricTypeId).toBe(50);
  });

  it("A9: applyActivityUndo unaffected by metric alias logic", async () => {
    await db.insert(activities)
      .values({ id: 200, name: "canonical_sport", color: "#abcdef" });

    const activityPayload: ActivityMergePayloadV1 = {
      v: MERGE_LOG_PAYLOAD_VERSION,
      kind: "activity",
      canonicalId: 200,
      merged: [
        {
          row: { id: 100, name: "old_sport", color: "#123456" },
          eventsMovedIds: [],
          goalsMovedIds: [],
          metricTypesMovedIds: [],
          dashboardsNulledIds: [],
        },
      ],
    };

    await db.transaction(async (tx) => applyActivityUndo(tx, activityPayload));

    const restored = await db.select().from(activities).where(eq(activities.id, 100));
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("old_sport");
  });
});
