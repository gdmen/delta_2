import { describe, expect, it } from "vitest";
import {
  buildMetricTypeMergePayload,
  buildActivityMergePayload,
} from "./builder";
import { MERGE_LOG_PAYLOAD_VERSION } from "./types";

/**
 * Pure-shape tests for the payload constructors. The DB-bound builder
 * helpers (`buildMetricTypeMergedEntry`, `buildActivityMergedEntry`) read
 * live tx state and are exercised end-to-end via the merge endpoints'
 * runtime smoke tests; building a fixture DB to unit-test them would be
 * heavy and the surface we'd be covering is straight `tx.select(...).all()`
 * queries that drizzle already validates at the type level.
 *
 * What we DO unit-test here: the payload constructor wraps the
 * accumulated merged entries with the correct envelope (`v`, `kind`,
 * `canonicalId`). Cheap, catches regressions on the version field if it
 * ever changes.
 */

describe("buildMetricTypeMergePayload", () => {
  it("wraps entries in a v=1 envelope", () => {
    const payload = buildMetricTypeMergePayload(42, []);
    expect(payload.v).toBe(MERGE_LOG_PAYLOAD_VERSION);
    expect(payload.kind).toBe("metric_type");
    expect(payload.canonicalId).toBe(42);
    expect(payload.merged).toEqual([]);
  });

  it("preserves merged entry ordering", () => {
    const merged = [
      {
        row: {
          id: 1,
          name: "a",
          unit: "lb",
          activityId: null,
          frequencyHint: "daily" as const,
          target: null,
          higherIsBetter: true,
        },
        scale: 1,
        metricsMovedIds: [10, 11],
        eventMetricsMovedIds: [],
        eventMetricsDeleted: [],
        goalsMovedIds: [],
        journalEntriesMovedIds: [],
        workoutSetsMovedIds: [],
      },
      {
        row: {
          id: 2,
          name: "b",
          unit: "lb",
          activityId: null,
          frequencyHint: "occasional" as const,
          target: 100,
          higherIsBetter: false,
        },
        scale: 2.5,
        metricsMovedIds: [20],
        eventMetricsMovedIds: [],
        eventMetricsDeleted: [],
        goalsMovedIds: [99],
        journalEntriesMovedIds: [],
        workoutSetsMovedIds: [],
      },
    ];
    const payload = buildMetricTypeMergePayload(7, merged);
    expect(payload.merged).toHaveLength(2);
    expect(payload.merged[0].row.id).toBe(1);
    expect(payload.merged[1].scale).toBe(2.5);
    expect(payload.merged[1].goalsMovedIds).toEqual([99]);
  });

  it("serializes to JSON cleanly", () => {
    const payload = buildMetricTypeMergePayload(1, []);
    const round = JSON.parse(JSON.stringify(payload));
    expect(round).toEqual(payload);
  });

  it("round-trips aliasesRepointed (chain-merge regression)", () => {
    // The merge route re-points existing aliases from merged → canonical
    // (instead of letting the FK CASCADE DELETE them). The undo path
    // needs to point them back at the (re-inserted) merged row, so the
    // captured list MUST survive the JSON round-trip into payload.
    const payload = buildMetricTypeMergePayload(3, [
      {
        row: {
          id: 1,
          name: "fitnotes_bodyweight:weight",
          unit: "lb",
          activityId: null,
          frequencyHint: "daily" as const,
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
        aliasesRepointed: ["fitnotes_bodytracker:weight"],
      },
    ]);
    const round = JSON.parse(JSON.stringify(payload));
    expect(round.merged[0].aliasesRepointed).toEqual([
      "fitnotes_bodytracker:weight",
    ]);
  });
});

describe("buildActivityMergePayload", () => {
  it("wraps entries in a v=1 envelope", () => {
    const payload = buildActivityMergePayload(99, []);
    expect(payload.v).toBe(MERGE_LOG_PAYLOAD_VERSION);
    expect(payload.kind).toBe("activity");
    expect(payload.canonicalId).toBe(99);
    expect(payload.merged).toEqual([]);
  });

  it("captures dashboards-nulled ids in the entry", () => {
    const payload = buildActivityMergePayload(1, [
      {
        row: { id: 5, name: "old_sport", color: "#abcdef" },
        eventsMovedIds: [],
        goalsMovedIds: [],
        metricTypesMovedIds: [],
        dashboardsNulledIds: [10, 20, 30],
      },
    ]);
    expect(payload.merged[0].dashboardsNulledIds).toEqual([10, 20, 30]);
  });
});
