// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EventsTable, type EventRow } from "./events-table";

/**
 * Renderer-level smoke for the events list selection wiring (#37, PR2).
 *
 * Same shiftKey-via-onClick contract as the catalogs, plus the
 * events-only twist: only `visible` rows are selectable, so a shift
 * range computed over the selectable ids must skip an interleaved
 * disabled row. Also re-checks the indeterminate-header bug fix.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const base = {
  startedAt: "2026-01-01T10:00:00Z",
  activityId: 1,
  activityName: "Run",
  type: "easy",
  durationMinutes: 30,
  source: "strava",
} as const;

// id 3 is hidden_by_composite → not selectable, sits between selectable rows.
const rows: EventRow[] = [
  { ...base, id: 1, status: "visible" },
  { ...base, id: 2, status: "visible" },
  { ...base, id: 3, status: "hidden_by_composite" },
  { ...base, id: 4, status: "visible" },
];

function renderTable() {
  render(<EventsTable rows={rows} activityOptions={[]} />);
}

const cb = (id: number) =>
  screen.getByLabelText(`Select event ${id}`) as HTMLInputElement;
const disabledCb = (id: number) =>
  screen.getByLabelText(
    new RegExp(`^Event ${id} cannot be selected`),
  ) as HTMLInputElement;
const header = () =>
  screen.getByLabelText(
    /^(Select all visible events on this page|Clear selection of all visible events)$/,
  ) as HTMLInputElement;

afterEach(cleanup);

describe("EventsTable selection (#37)", () => {
  it("shift-click fills the range over selectable ids, skipping disabled rows", () => {
    renderTable();
    fireEvent.click(cb(1)); // anchor at 1
    fireEvent.click(cb(4), { shiftKey: true }); // span 1..4 over [1,2,4]
    expect(cb(1).checked).toBe(true);
    expect(cb(2).checked).toBe(true);
    expect(cb(4).checked).toBe(true);
    // id 3 is disabled and was never a candidate.
    expect(disabledCb(3).checked).toBe(false);
    expect(disabledCb(3).disabled).toBe(true);
  });

  it("shift-click on a checked box clears the range (Behavior B: deselect)", () => {
    renderTable();
    fireEvent.click(cb(1));
    fireEvent.click(cb(4), { shiftKey: true }); // all selectable on
    expect([1, 2, 4].every((id) => cb(id).checked)).toBe(true);
    fireEvent.click(cb(4), { shiftKey: true }); // anchor still 1 → flip span off
    expect([1, 2, 4].some((id) => cb(id).checked)).toBe(false);
  });

  it("first shift-click with no anchor falls back to a single toggle", () => {
    renderTable();
    fireEvent.click(cb(2), { shiftKey: true });
    expect(cb(2).checked).toBe(true);
    expect(cb(1).checked).toBe(false);
    expect(cb(4).checked).toBe(false);
  });

  it("header dash CLEARS, it does not select-all (the bug fix)", () => {
    renderTable();
    fireEvent.click(cb(1)); // some-but-not-all
    expect(header().indeterminate).toBe(true);
    fireEvent.click(header());
    expect([1, 2, 4].some((id) => cb(id).checked)).toBe(false);
    expect(header().indeterminate).toBe(false);
  });

  it("header selects all selectable rows when none are selected", () => {
    renderTable();
    fireEvent.click(header());
    expect([1, 2, 4].every((id) => cb(id).checked)).toBe(true);
    expect(disabledCb(3).checked).toBe(false);
    expect(header().checked).toBe(true);
  });
});
