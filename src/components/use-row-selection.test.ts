// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRowSelection } from "./use-row-selection";

/**
 * Direct tests for the shared selection state machine (#37). This is now
 * the single implementation behind all three checkbox tables, so the
 * behavior contract is pinned here once; the per-surface component tests
 * just confirm the wiring.
 */

const KEYS = ["a", "b", "c", "d", "e"];

function setup(keys: string[] = KEYS) {
  return renderHook(({ k }) => useRowSelection(k), {
    initialProps: { k: keys },
  });
}

const sel = (r: ReturnType<typeof setup>["result"]) => r.current;

describe("useRowSelection (#37)", () => {
  it("toggle selects, sets the anchor, and toggles back off", () => {
    const { result } = setup();
    act(() => sel(result).toggle("b"));
    expect(sel(result).isSelected("b")).toBe(true);
    act(() => sel(result).toggle("b"));
    expect(sel(result).isSelected("b")).toBe(false);
  });

  it("shift-click fills the inclusive range (Behavior B: select)", () => {
    const { result } = setup();
    act(() => sel(result).toggle("b")); // anchor b
    act(() => sel(result).toggleRange("d", true)); // b..d
    expect(["b", "c", "d"].every((k) => sel(result).isSelected(k))).toBe(true);
    expect(sel(result).isSelected("a")).toBe(false);
    expect(sel(result).isSelected("e")).toBe(false);
  });

  it("shift-click on a checked key clears the range (Behavior B: deselect)", () => {
    const { result } = setup();
    act(() => sel(result).toggle("b")); // anchor b
    act(() => sel(result).toggleRange("e", true)); // b..e on
    expect(["b", "c", "d", "e"].every((k) => sel(result).isSelected(k))).toBe(
      true,
    );
    act(() => sel(result).toggleRange("e", true)); // anchor still b → off
    expect(["b", "c", "d", "e"].some((k) => sel(result).isSelected(k))).toBe(
      false,
    );
  });

  it("range accretes: selections outside the span survive", () => {
    const { result } = setup();
    act(() => sel(result).toggle("e")); // sel {e}, anchor e
    act(() => sel(result).toggle("a")); // sel {e,a}, anchor a
    act(() => sel(result).toggleRange("c", true)); // a..c added
    expect(["a", "b", "c", "e"].every((k) => sel(result).isSelected(k))).toBe(
      true,
    );
    expect(sel(result).isSelected("d")).toBe(false);
  });

  it("first shift-click with no anchor is a single toggle", () => {
    const { result } = setup();
    act(() => sel(result).toggleRange("c", true));
    expect(sel(result).isSelected("c")).toBe(true);
    expect(sel(result).isSelected("a")).toBe(false);
  });

  it("anchor scrolled out of the visible set falls back to single toggle", () => {
    const { result, rerender } = setup();
    act(() => sel(result).toggle("b")); // anchor b
    rerender({ k: ["a", "c", "d", "e"] }); // b leaves the visible set
    act(() => sel(result).toggleRange("d", true)); // anchor b gone → single toggle
    expect(sel(result).isSelected("d")).toBe(true);
    expect(sel(result).isSelected("c")).toBe(false);
  });

  it("selectAll selects every visible key; tri-state reads all", () => {
    const { result } = setup();
    act(() => sel(result).selectAll());
    expect(KEYS.every((k) => sel(result).isSelected(k))).toBe(true);
    expect(sel(result).allSelected).toBe(true);
    expect(sel(result).someSelected).toBe(false);
  });

  it("partial selection reads as indeterminate (some, not all)", () => {
    const { result } = setup();
    act(() => sel(result).toggle("b"));
    expect(sel(result).allSelected).toBe(false);
    expect(sel(result).someSelected).toBe(true);
  });

  it("clearVisible removes visible keys and resets the anchor", () => {
    const { result } = setup();
    act(() => sel(result).toggle("a")); // anchor a
    act(() => sel(result).toggle("c")); // anchor c
    act(() => sel(result).clearVisible()); // empty + anchor reset
    expect(KEYS.some((k) => sel(result).isSelected(k))).toBe(false);
    // anchor was reset → next shift-click is a single toggle, not a range
    act(() => sel(result).toggleRange("e", true));
    expect(sel(result).isSelected("e")).toBe(true);
    expect(sel(result).isSelected("d")).toBe(false);
  });

  it("selectAll preserves selections hidden by the current filter", () => {
    const { result, rerender } = setup();
    act(() => sel(result).toggle("e")); // select e
    rerender({ k: ["a", "b"] }); // e now hidden by filter
    act(() => sel(result).selectAll()); // selects a,b — keeps hidden e
    expect(sel(result).isSelected("a")).toBe(true);
    expect(sel(result).isSelected("b")).toBe(true);
    expect(sel(result).isSelected("e")).toBe(true);
  });

  it("empty key list is never 'all selected' (guards [].every)", () => {
    const { result } = setup([]);
    expect(sel(result).allSelected).toBe(false);
    expect(sel(result).someSelected).toBe(false);
  });
});
