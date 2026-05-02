import { describe, expect, it, vi } from "vitest";
import { collectDataDeps, runDataDeps } from "./data-deps";
import { isDataDepError } from "./types";

describe("collectDataDeps", () => {
  it("returns an empty map for empty input", () => {
    expect(collectDataDeps([]).size).toBe(0);
  });

  it("collects deps from one widget", () => {
    const fetchA = vi.fn();
    const map = collectDataDeps([[{ key: "a", fetch: fetchA }]]);
    expect(map.size).toBe(1);
    expect(map.get("a")).toBe(fetchA);
  });

  it("dedupes identical keys across widgets — first fetcher wins", () => {
    const fetchA1 = vi.fn();
    const fetchA2 = vi.fn();
    const map = collectDataDeps([
      [{ key: "a", fetch: fetchA1 }],
      [{ key: "a", fetch: fetchA2 }],
    ]);
    expect(map.size).toBe(1);
    expect(map.get("a")).toBe(fetchA1);
  });

  it("first-wins is benign when fetchers are equivalent (the actual usage shape)", async () => {
    // Two metric_strip widgets each include a Sleep cell with the same
    // metric+mode. They produce the same dep key and equivalent fetchers.
    // Dedupe runs the fetcher once, both widgets read the same value.
    let calls = 0;
    const sharedFetch = () => {
      calls++;
      return Promise.resolve("8h");
    };
    const map = collectDataDeps([
      [{ key: "strip:sleep:avg7", fetch: sharedFetch }],
      [{ key: "strip:sleep:avg7", fetch: sharedFetch }],
    ]);
    const data = await runDataDeps(map);
    expect(calls).toBe(1);
    expect(data.get("strip:sleep:avg7")).toBe("8h");
  });

  it("preserves distinct keys", () => {
    const map = collectDataDeps([
      [{ key: "a", fetch: vi.fn() }],
      [{ key: "b", fetch: vi.fn() }],
      [{ key: "c", fetch: vi.fn() }],
    ]);
    expect([...map.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("handles widgets with no deps gracefully", () => {
    const map = collectDataDeps([[], [{ key: "a", fetch: vi.fn() }], []]);
    expect(map.size).toBe(1);
  });
});

describe("runDataDeps", () => {
  it("returns an empty map when no deps", async () => {
    const data = await runDataDeps(new Map());
    expect(data.size).toBe(0);
  });

  it("resolves all fulfilled fetchers into the data map", async () => {
    const map = new Map<string, () => Promise<unknown>>([
      ["a", () => Promise.resolve("alpha")],
      ["b", () => Promise.resolve(42)],
    ]);
    const data = await runDataDeps(map);
    expect(data.get("a")).toBe("alpha");
    expect(data.get("b")).toBe(42);
  });

  it("stores a sentinel for rejected fetchers and resolves the rest", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const map = new Map<string, () => Promise<unknown>>([
      ["good", () => Promise.resolve("ok")],
      ["bad", () => Promise.reject(new Error("boom"))],
    ]);
    const data = await runDataDeps(map);
    expect(data.get("good")).toBe("ok");
    // Sentinel makes "fetcher errored" distinguishable from "key not requested"
    // (without it, both look like undefined to consumers).
    const badEntry = data.get("bad");
    expect(isDataDepError(badEntry)).toBe(true);
    expect(badEntry).toMatchObject({ message: "boom" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("runs fetchers in parallel, not sequentially", async () => {
    const order: string[] = [];
    const slow = (label: string, ms: number) => () =>
      new Promise<string>((resolve) =>
        setTimeout(() => {
          order.push(label);
          resolve(label);
        }, ms),
      );
    const map = new Map([
      ["a", slow("a", 30)],
      ["b", slow("b", 10)],
      ["c", slow("c", 20)],
    ]);
    const data = await runDataDeps(map);
    expect(data.get("a")).toBe("a");
    expect(data.get("b")).toBe("b");
    expect(data.get("c")).toBe("c");
    // If sequential, order would be a,b,c. Parallel = b,c,a (by ms).
    expect(order).toEqual(["b", "c", "a"]);
  });
});
