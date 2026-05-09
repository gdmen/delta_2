import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import {
  metricTypes,
  metrics,
  metricTypeAliases,
} from "@/db/schema";
import { applyMetricTypeUndo } from "./applier";
import { buildMetricTypeMergedEntry } from "./builder";
import {
  MERGE_LOG_PAYLOAD_VERSION,
  type MetricTypeMergedEntry,
  type MetricTypeMergePayloadV1,
} from "./types";

/**
 * Chain-undo composition tests. These exercise the full sequence
 * (merge → ingest → merge → ingest → undo → undo) against an in-memory
 * DB to prove that Plan A's `alias IN aliasesRepointed OR
 * alias = merged.row.name` rule chains correctly through layered merges.
 *
 * The test helpers below mimic just enough of the merge route's
 * per-mergeId mutation block to drive the scenarios without spinning
 * up an HTTP handler. Production parity for these mutations lives in
 * the merge route itself, exercised by the applier unit tests.
 */

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

/**
 * Helper that runs the merge mutations for a single (canonicalId, mergedId)
 * pair inside the supplied tx, mirroring the route's logic for the
 * fields that matter to chain-undo (metrics + aliases). Returns the
 * captured merged entry so the test can assemble a payload.
 */
async function mergeIntoTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  canonicalId: number,
  mergedId: number,
): Promise<MetricTypeMergedEntry> {
  const captured = await buildMetricTypeMergedEntry(tx, canonicalId, mergedId, 1);
  // Re-point aliases pointing at merged → canonical (chain merge fix).
  await tx.update(metricTypeAliases)
    .set({ canonicalMetricTypeId: canonicalId })
    .where(eq(metricTypeAliases.canonicalMetricTypeId, mergedId));
  // Move metrics from merged to canonical.
  await tx.update(metrics)
    .set({ metricTypeId: canonicalId })
    .where(eq(metrics.metricTypeId, mergedId));
  // Insert the merged-name alias pointing at canonical.
  const mergedRow = (await tx
    .select({ name: metricTypes.name })
    .from(metricTypes)
    .where(eq(metricTypes.id, mergedId)))[0];
  await tx.insert(metricTypeAliases)
    .values({ alias: mergedRow.name, canonicalMetricTypeId: canonicalId })
    .onConflictDoNothing();
  // Delete the merged metric_type.
  await tx.delete(metricTypes).where(eq(metricTypes.id, mergedId));
  return captured;
}

function payloadFor(
  canonicalId: number,
  merged: MetricTypeMergedEntry[],
): MetricTypeMergePayloadV1 {
  return {
    v: MERGE_LOG_PAYLOAD_VERSION,
    kind: "metric_type",
    canonicalId,
    merged,
  };
}

/**
 * Helper that simulates an ingest: looks up the alias in the cache and
 * inserts a metrics row tagged with the resolution alias. If the raw
 * name has no alias hit, falls through to source-prefixed orphan
 * (matches resolver path R4 behavior).
 */
async function ingestVia(args: {
  rawName: string;
  source: string;
  metricRowId: number;
}): Promise<{ typeId: number; alias: string }> {
  const direct = await db
    .select()
    .from(metricTypeAliases)
    .where(eq(metricTypeAliases.alias, args.rawName));
  const prefixed = await db
    .select()
    .from(metricTypeAliases)
    .where(eq(metricTypeAliases.alias, `${args.source}:${args.rawName}`));
  let typeId: number;
  let alias: string;
  if (direct.length > 0) {
    typeId = direct[0].canonicalMetricTypeId;
    alias = args.rawName;
  } else if (prefixed.length > 0) {
    typeId = prefixed[0].canonicalMetricTypeId;
    alias = `${args.source}:${args.rawName}`;
  } else {
    // Auto-create orphan.
    alias = `${args.source}:${args.rawName}`;
    const inserted = await db
      .insert(metricTypes)
      .values({ name: alias, unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id });
    typeId = inserted[0].id;
  }
  await db.insert(metrics)
    .values({
      id: args.metricRowId,
      metricTypeId: typeId,
      value: 70 + args.metricRowId,
      recordedAt: `2026-02-${String(args.metricRowId).padStart(2, "0")}T12:00:00Z`,
      source: args.source,
      sourceId: `${args.source}-${args.rawName}-${args.metricRowId}`,
      alias,
    });
  return { typeId, alias };
}

async function metricTypeName(id: number): Promise<string | undefined> {
  const rows = await db
    .select()
    .from(metricTypes)
    .where(eq(metricTypes.id, id));
  return rows[0]?.name;
}

async function metricTypeOf(metricRowId: number): Promise<number> {
  return (await db
    .select()
    .from(metrics)
    .where(eq(metrics.id, metricRowId)))[0].metricTypeId;
}

describe("chain undo", () => {
  it("C1: the user's exact bug — merge, merge, ingest via both aliases, undo all", async () => {
    // Setup: 3 metric_types simulating the user's flow.
    await db.insert(metricTypes).values({ id: 1, name: "fitnotes_bw:weight", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 2, name: "fitnotes_bt:weight", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 3, name: "bodyweight", unit: "lb", frequencyHint: "daily" });

    // Original ingests at id=1 and id=2.
    await db.insert(metrics).values({
      id: 1, metricTypeId: 1, value: 70, recordedAt: "2026-01-01T00:00:00Z",
      source: "fitnotes_bw", sourceId: "bw-1", alias: "fitnotes_bw:weight",
    });
    await db.insert(metrics).values({
      id: 2, metricTypeId: 2, value: 71, recordedAt: "2026-01-02T00:00:00Z",
      source: "fitnotes_bt", sourceId: "bt-1", alias: "fitnotes_bt:weight",
    });

    // Merge1: id=2 → id=1
    const m1 = await db.transaction(async (tx) => mergeIntoTx(tx, 1, 2));

    // Merge2: id=1 → id=3
    const m2 = await db.transaction(async (tx) => mergeIntoTx(tx, 3, 1));

    // Post-merge ingest via fitnotes_bt:weight → routes to id=3
    const ingest1 = await ingestVia({ rawName: "weight", source: "fitnotes_bt", metricRowId: 10 });
    expect(ingest1.typeId).toBe(3);
    // Post-merge ingest via fitnotes_bw:weight → routes to id=3
    const ingest2 = await ingestVia({ rawName: "weight", source: "fitnotes_bw", metricRowId: 11 });
    expect(ingest2.typeId).toBe(3);

    // Undo Merge2 (id=3 ← id=1)
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(3, [m2])));
    // Undo Merge1 (id=1 ← id=2)
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(1, [m1])));

    // The fitnotes_bt:weight metric (row 10) should land back on id=2.
    expect(await metricTypeOf(10)).toBe(2);
    expect(await metricTypeName(2)).toBe("fitnotes_bt:weight");
    // The fitnotes_bw:weight metric (row 11) should land on id=1.
    expect(await metricTypeOf(11)).toBe(1);
    expect(await metricTypeName(1)).toBe("fitnotes_bw:weight");
    // Originals also restored.
    expect(await metricTypeOf(1)).toBe(1);
    expect(await metricTypeOf(2)).toBe(2);
  });

  it("C2: re-import between undos — chain still composes", async () => {
    await db.insert(metricTypes).values({ id: 1, name: "src1:weight", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 2, name: "src2:weight", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 3, name: "canonical_v2", unit: "lb", frequencyHint: "daily" });
    await db.insert(metrics).values({
      id: 1, metricTypeId: 1, value: 70, recordedAt: "2026-01-01T00:00:00Z",
      source: "src1", sourceId: "src1-w-1", alias: "src1:weight",
    });
    await db.insert(metrics).values({
      id: 2, metricTypeId: 2, value: 71, recordedAt: "2026-01-02T00:00:00Z",
      source: "src2", sourceId: "src2-w-1", alias: "src2:weight",
    });

    const m1 = await db.transaction(async (tx) => mergeIntoTx(tx, 1, 2));
    const m2 = await db.transaction(async (tx) => mergeIntoTx(tx, 3, 1));

    // Pre-undo ingest via src2:weight → id=3
    await ingestVia({ rawName: "weight", source: "src2", metricRowId: 10 });

    // Undo Merge2
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(3, [m2])));

    // Re-ingest via src2:weight after Merge2 undone, before Merge1 undone.
    // Alias src2:weight now points to id=1 (re-pointed by the undo).
    const reIngest = await ingestVia({ rawName: "weight", source: "src2", metricRowId: 11 });
    expect(reIngest.typeId).toBe(1);

    // Undo Merge1
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(1, [m1])));

    // Both src2-routed metrics land on id=2.
    expect(await metricTypeOf(10)).toBe(2);
    expect(await metricTypeOf(11)).toBe(2);
  });

  it("C3: partial undo (only undo M2) leaves M1 intact", async () => {
    await db.insert(metricTypes).values({ id: 1, name: "src1:weight", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 2, name: "src2:weight", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 3, name: "canonical_v2", unit: "lb", frequencyHint: "daily" });

    const m1 = await db.transaction(async (tx) => mergeIntoTx(tx, 1, 2));
    const m2 = await db.transaction(async (tx) => mergeIntoTx(tx, 3, 1));

    // Post-merge ingests via src2:weight and src1:weight → id=3
    await ingestVia({ rawName: "weight", source: "src2", metricRowId: 10 });
    await ingestVia({ rawName: "weight", source: "src1", metricRowId: 11 });

    // Undo only Merge2.
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(3, [m2])));

    // src2:weight metric → id=1 (chain-moved by alias rule)
    expect(await metricTypeOf(10)).toBe(1);
    // src1:weight metric → id=1 (also moved, alias = merged.row.name)
    expect(await metricTypeOf(11)).toBe(1);
    // src2:weight alias still on id=1 (NOT collapsed back to id=2 because M1 not undone)
    const aliases = await db.select().from(metricTypeAliases);
    expect(
      aliases.find((a) => a.alias === "src2:weight")?.canonicalMetricTypeId,
    ).toBe(1);
    // m1 intentionally unused; suppress lint by referencing.
    void m1;
  });

  it("C4: chain of 3 merges, then undo all", async () => {
    await db.insert(metricTypes).values({ id: 1, name: "A", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 2, name: "B", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 3, name: "C", unit: "lb", frequencyHint: "daily" });
    await db.insert(metricTypes).values({ id: 4, name: "D", unit: "lb", frequencyHint: "daily" });

    const mAB = await db.transaction(async (tx) => mergeIntoTx(tx, 2, 1)); // A → B
    // ingest via "A" → routes to B(2)
    await ingestVia({ rawName: "A", source: "src", metricRowId: 10 });

    const mBC = await db.transaction(async (tx) => mergeIntoTx(tx, 3, 2)); // B → C
    await ingestVia({ rawName: "A", source: "src", metricRowId: 11 });
    await ingestVia({ rawName: "B", source: "src", metricRowId: 12 });

    const mCD = await db.transaction(async (tx) => mergeIntoTx(tx, 4, 3)); // C → D
    await ingestVia({ rawName: "A", source: "src", metricRowId: 13 });
    await ingestVia({ rawName: "B", source: "src", metricRowId: 14 });
    await ingestVia({ rawName: "C", source: "src", metricRowId: 15 });

    // Undo in reverse order.
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(4, [mCD])));
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(3, [mBC])));
    await db.transaction(async (tx) => applyMetricTypeUndo(tx, payloadFor(2, [mAB])));

    // Each ingest should land on its source-name's home.
    expect(await metricTypeOf(10)).toBe(1); // alias=A → home A(1)
    expect(await metricTypeOf(11)).toBe(1);
    expect(await metricTypeOf(13)).toBe(1);
    expect(await metricTypeOf(12)).toBe(2); // alias=B → home B(2)
    expect(await metricTypeOf(14)).toBe(2);
    expect(await metricTypeOf(15)).toBe(3); // alias=C → home C(3)
  });
});
