import { describe, it, expect } from "vitest";
import { computeRange, headerNextState } from "./selection";

describe("computeRange (#37)", () => {
  const keys = ["a", "b", "c", "d", "e"];

  it("forward range: anchor before clicked", () => {
    expect(computeRange(keys, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("backward range: anchor after clicked", () => {
    expect(computeRange(keys, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("single-element range: anchor === clicked", () => {
    expect(computeRange(keys, "c", "c")).toEqual(["c"]);
  });

  it("full span", () => {
    expect(computeRange(keys, "a", "e")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("anchor not present → [] (caller falls back to single toggle)", () => {
    expect(computeRange(keys, "z", "c")).toEqual([]);
  });

  it("clicked not present → []", () => {
    expect(computeRange(keys, "c", "z")).toEqual([]);
  });

  it("respects the given order, not sorted order", () => {
    const reordered = ["e", "d", "c", "b", "a"];
    expect(computeRange(reordered, "e", "c")).toEqual(["e", "d", "c"]);
  });

  it("works with numeric keys", () => {
    expect(computeRange([10, 20, 30, 40], 20, 40)).toEqual([20, 30, 40]);
  });
});

describe("headerNextState (#37)", () => {
  it("none selected → selectAll", () => {
    expect(headerNextState(false, false)).toBe("selectAll");
  });

  it("some selected (indeterminate) → clear (the bug fix)", () => {
    expect(headerNextState(false, true)).toBe("clear");
  });

  it("all selected → clear", () => {
    expect(headerNextState(true, false)).toBe("clear");
  });
});
