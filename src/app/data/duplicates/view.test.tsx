// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DuplicatesView } from "./view";
import type { CandidateGroup, CandidatePair } from "@/lib/duplicates/detector";

/**
 * Renderer-level smoke for the duplicates group multi-select (#37, PR3).
 *
 * Same shiftKey-via-onClick contract as the other two surfaces, applied
 * to the source/activity-pair groups (keyed by group key, not row id).
 * Re-checks the indeterminate-header bug fix.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const g = (i: number): CandidateGroup => ({
  sourceA: `srcA${i}`,
  activityNameA: `ActivityA${i}`,
  activityIdA: i,
  sourceB: `srcB${i}`,
  activityNameB: `ActivityB${i}`,
  activityIdB: i + 100,
  count: 2,
  sampleIds: [],
});

const groups = [g(1), g(2), g(3)];

// One pair so the empty-state short-circuit doesn't fire.
const pairs: CandidatePair[] = [
  {
    aId: 1,
    aSource: "srcA1",
    aActivityId: 1,
    aActivityName: "ActivityA1",
    aType: "x",
    aStartedAt: "2026-01-01T10:00:00Z",
    aDurationMinutes: 30,
    bId: 2,
    bSource: "srcB1",
    bActivityId: 101,
    bActivityName: "ActivityB1",
    bType: "y",
    bStartedAt: "2026-01-01T10:10:00Z",
    bDurationMinutes: 30,
    minutesApart: 10,
  },
];

function renderView() {
  render(<DuplicatesView pairs={pairs} groups={groups} activityOptions={[]} />);
}

const groupCb = (i: number) =>
  screen.getByLabelText(
    `Select srcA${i} ActivityA${i} plus srcB${i} ActivityB${i}`,
  ) as HTMLInputElement;
const header = () =>
  screen.getByLabelText(
    /^(Select all source\/activity groups|Clear selection of all source\/activity groups)$/,
  ) as HTMLInputElement;

afterEach(cleanup);

describe("DuplicatesView group selection (#37)", () => {
  it("shift-click fills the inclusive range of groups", () => {
    renderView();
    fireEvent.click(groupCb(1)); // anchor at group 1
    fireEvent.click(groupCb(3), { shiftKey: true }); // span 1..3
    expect(groupCb(1).checked).toBe(true);
    expect(groupCb(2).checked).toBe(true);
    expect(groupCb(3).checked).toBe(true);
  });

  it("shift-click on a checked group clears the range (Behavior B: deselect)", () => {
    renderView();
    fireEvent.click(groupCb(1));
    fireEvent.click(groupCb(3), { shiftKey: true }); // all on
    expect([1, 2, 3].every((i) => groupCb(i).checked)).toBe(true);
    fireEvent.click(groupCb(3), { shiftKey: true }); // anchor still 1 → off
    expect([1, 2, 3].some((i) => groupCb(i).checked)).toBe(false);
  });

  it("first shift-click with no anchor falls back to a single toggle", () => {
    renderView();
    fireEvent.click(groupCb(2), { shiftKey: true });
    expect(groupCb(2).checked).toBe(true);
    expect(groupCb(1).checked).toBe(false);
    expect(groupCb(3).checked).toBe(false);
  });

  it("header dash CLEARS, it does not select-all (the bug fix)", () => {
    renderView();
    fireEvent.click(groupCb(1)); // some-but-not-all
    expect(header().indeterminate).toBe(true);
    fireEvent.click(header());
    expect([1, 2, 3].some((i) => groupCb(i).checked)).toBe(false);
    expect(header().indeterminate).toBe(false);
  });

  it("header selects all groups when none are selected", () => {
    renderView();
    fireEvent.click(header());
    expect([1, 2, 3].every((i) => groupCb(i).checked)).toBe(true);
    expect(header().checked).toBe(true);
  });
});
