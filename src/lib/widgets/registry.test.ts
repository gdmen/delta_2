import { describe, expect, it } from "vitest";
import { WIDGETS, lookupWidget, WIDGET_TYPES } from "./registry";

describe("widget registry", () => {
  it("ships exactly the PR1 widget set", () => {
    expect(WIDGET_TYPES.sort()).toEqual([
      "focus_list",
      "goal_list",
      "metric_block",
      "metric_strip",
    ]);
  });

  it("lookupWidget returns the def for a known type", () => {
    const def = lookupWidget("metric_strip");
    expect(def).not.toBeNull();
    expect(def?.type).toBe("metric_strip");
    expect(def?.name).toBe("Metric strip");
  });

  it("lookupWidget returns null for an unknown type", () => {
    expect(lookupWidget("nonexistent")).toBeNull();
  });

  it("every widget has the required def shape", () => {
    for (const def of Object.values(WIDGETS)) {
      expect(def.type).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.category).toBeTruthy();
      expect(def.defaultSize.w).toBeGreaterThan(0);
      expect(def.defaultSize.h).toBeGreaterThan(0);
      expect(def.schema).toBeTruthy();
      expect(def.Component).toBeTruthy();
    }
  });

  it("every widget's type matches its registry key", () => {
    for (const [key, def] of Object.entries(WIDGETS)) {
      expect(def.type).toBe(key);
    }
  });
});
