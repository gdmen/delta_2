// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SelectableDataTable } from "./selectable-data-table";

/**
 * Renderer-level smoke for the catalog table's selection wiring (#37).
 *
 * The unit tests in selection.test.ts cover the pure helpers
 * (computeRange / headerNextState). This file covers the part the
 * helpers can't: that the checkbox actually feeds shiftKey into
 * toggleRange. That wiring had a real bug — reading shiftKey off the
 * checkbox's `onChange` event (its nativeEvent is a `change`, no
 * shiftKey) silently dropped the range. The fix moved the read to
 * `onClick` (a true MouseEvent). fireEvent.click(cb, { shiftKey: true })
 * is exactly that event, so this test would fail against the old code.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

type Row = { id: number; name: string };
const rows: Row[] = [
  { id: 1, name: "alpha" },
  { id: 2, name: "bravo" },
  { id: 3, name: "charlie" },
  { id: 4, name: "delta" },
];

function renderTable() {
  render(
    <SelectableDataTable<Row, number>
      rows={rows}
      columns={[{ header: "Name", render: (r) => r.name }]}
      getKey={(r) => r.id}
      emptyState="none"
      itemLabel={{ one: "row", many: "rows" }}
      // Presence of a bulk action is what makes the toolbar render; the
      // selection logic under test doesn't depend on it.
      onBulkDelete={async () => ({ deleted: [], errors: [] })}
    />,
  );
}

const cb = (id: number) =>
  screen.getByLabelText(`Select ${id}`) as HTMLInputElement;
const header = () =>
  screen.getByLabelText(
    /^(Select all visible rows|Clear selection of all visible rows)$/,
  ) as HTMLInputElement;

afterEach(cleanup);

describe("SelectableDataTable selection (#37)", () => {
  it("shift-click selects the inclusive range (Behavior B: select)", () => {
    renderTable();
    fireEvent.click(cb(1)); // anchor at 1
    fireEvent.click(cb(3), { shiftKey: true }); // fill 1..3
    expect(cb(1).checked).toBe(true);
    expect(cb(2).checked).toBe(true);
    expect(cb(3).checked).toBe(true);
    expect(cb(4).checked).toBe(false);
  });

  it("shift-click on a checked box clears the range (Behavior B: deselect)", () => {
    renderTable();
    fireEvent.click(cb(1)); // anchor at 1, select 1
    fireEvent.click(cb(4), { shiftKey: true }); // fill 1..4 (all on)
    expect([1, 2, 3, 4].every((id) => cb(id).checked)).toBe(true);
    // Anchor is unchanged by a shift-click, so it's still 1. Shift-clicking
    // the now-checked box 4 flips the whole 1..4 span back off.
    fireEvent.click(cb(4), { shiftKey: true });
    expect([1, 2, 3, 4].some((id) => cb(id).checked)).toBe(false);
  });

  it("range accretes: selections outside the span survive", () => {
    renderTable();
    fireEvent.click(cb(4)); // select 4 (anchor 4)
    fireEvent.click(cb(1)); // select 1, anchor moves to 1
    fireEvent.click(cb(2), { shiftKey: true }); // fill 1..2, leave 4 alone
    expect(cb(1).checked).toBe(true);
    expect(cb(2).checked).toBe(true);
    expect(cb(3).checked).toBe(false);
    expect(cb(4).checked).toBe(true);
  });

  it("first click with shift and no anchor falls back to a single toggle", () => {
    renderTable();
    fireEvent.click(cb(3), { shiftKey: true });
    expect(cb(3).checked).toBe(true);
    expect(cb(1).checked).toBe(false);
    expect(cb(2).checked).toBe(false);
    expect(cb(4).checked).toBe(false);
  });

  it("header shows the dash and clicking it CLEARS, not selects-all (the bug fix)", () => {
    renderTable();
    fireEvent.click(cb(1)); // some-but-not-all selected
    expect(header().indeterminate).toBe(true); // the "-" glyph
    fireEvent.click(header()); // headerNextState(some) === "clear"
    expect([1, 2, 3, 4].some((id) => cb(id).checked)).toBe(false);
    expect(header().indeterminate).toBe(false);
  });

  it("header selects all when nothing is selected", () => {
    renderTable();
    fireEvent.click(header());
    expect([1, 2, 3, 4].every((id) => cb(id).checked)).toBe(true);
    expect(header().checked).toBe(true);
  });

  it("after a header clear, a shift-click starts a fresh range (anchor reset)", () => {
    renderTable();
    fireEvent.click(cb(1)); // anchor at 1
    fireEvent.click(header()); // dash → clear, which resets the anchor
    fireEvent.click(cb(3), { shiftKey: true }); // no anchor → single toggle
    expect(cb(3).checked).toBe(true);
    expect(cb(1).checked).toBe(false);
    expect(cb(2).checked).toBe(false);
    expect(cb(4).checked).toBe(false);
  });
});
