import { describe, expect, it } from "vitest";
import {
  createDashboardInput,
  updateDashboardInput,
  addWidgetInput,
  updateWidgetInput,
  batchLayoutInput,
  serializeConfig,
  CONFIG_MAX_BYTES,
} from "./validation";

describe("createDashboardInput", () => {
  it("accepts a name + auto-derived slug", () => {
    const r = createDashboardInput.parse({ name: "Powerlifting" });
    expect(r.name).toBe("Powerlifting");
    expect(r.slug).toBeUndefined();
  });

  it("trims the name", () => {
    expect(createDashboardInput.parse({ name: "  bjj  " }).name).toBe("bjj");
  });

  it("rejects empty name", () => {
    expect(() => createDashboardInput.parse({ name: "" })).toThrow();
    expect(() => createDashboardInput.parse({ name: "   " })).toThrow();
  });

  it("rejects oversized name", () => {
    expect(() => createDashboardInput.parse({ name: "x".repeat(256) })).toThrow();
  });

  it("rejects invalid sportId", () => {
    expect(() => createDashboardInput.parse({ name: "x", sportId: 0 })).toThrow();
    expect(() => createDashboardInput.parse({ name: "x", sportId: -1 })).toThrow();
  });

  it("accepts null sportId", () => {
    expect(createDashboardInput.parse({ name: "x", sportId: null }).sportId).toBeNull();
  });
});

describe("updateDashboardInput", () => {
  it("requires at least one field", () => {
    expect(() => updateDashboardInput.parse({})).toThrow();
  });

  it("accepts a single field", () => {
    expect(updateDashboardInput.parse({ name: "new" }).name).toBe("new");
  });

  it("rejects an invalid slug shape", () => {
    expect(() => updateDashboardInput.parse({ slug: "API" })).toThrow();
    expect(() => updateDashboardInput.parse({ slug: "with space" })).toThrow();
  });
});

describe("addWidgetInput", () => {
  it("requires widgetType", () => {
    expect(() => addWidgetInput.parse({})).toThrow();
  });

  it("defaults config to empty object", () => {
    const r = addWidgetInput.parse({ widgetType: "metric_block" });
    expect(r.config).toEqual({});
  });

  it.each([
    ["gridX", -1, true],
    ["gridX", 0, false],
    ["gridX", 11, false],
    ["gridX", 12, true],
    ["gridY", -1, true],
    ["gridY", 0, false],
    ["gridW", 0, true],
    ["gridW", 1, false],
    ["gridW", 12, false],
    ["gridW", 13, true],
    ["gridH", 0, true],
    ["gridH", 1, false],
    ["gridH", 50, false],
    ["gridH", 51, true],
  ])("%s = %d → throws=%s", (key, value, shouldThrow) => {
    const fn = () =>
      addWidgetInput.parse({ widgetType: "metric_block", [key]: value });
    if (shouldThrow) expect(fn).toThrow();
    else expect(fn).not.toThrow();
  });
});

describe("updateWidgetInput", () => {
  it("requires at least one field", () => {
    expect(() => updateWidgetInput.parse({})).toThrow();
  });

  it("accepts a single field update", () => {
    expect(updateWidgetInput.parse({ gridX: 3 }).gridX).toBe(3);
  });
});

describe("batchLayoutInput", () => {
  it("requires at least one widget", () => {
    expect(() => batchLayoutInput.parse({ widgets: [] })).toThrow();
  });

  it("accepts a valid layout", () => {
    const r = batchLayoutInput.parse({
      widgets: [{ id: 1, gridX: 0, gridY: 0, gridW: 6, gridH: 3 }],
    });
    expect(r.widgets).toHaveLength(1);
  });

  it("rejects negative widget id", () => {
    expect(() =>
      batchLayoutInput.parse({
        widgets: [{ id: -1, gridX: 0, gridY: 0, gridW: 6, gridH: 3 }],
      }),
    ).toThrow();
  });

  it("rejects more than 64 widgets per batch", () => {
    const widgets = Array.from({ length: 65 }, (_, i) => ({
      id: i + 1,
      gridX: 0,
      gridY: 0,
      gridW: 1,
      gridH: 1,
    }));
    expect(() => batchLayoutInput.parse({ widgets })).toThrow();
  });
});

describe("serializeConfig", () => {
  it("serializes valid config", () => {
    const r = serializeConfig({ a: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.json).toBe('{"a":1}');
  });

  it("treats undefined as empty object", () => {
    const r = serializeConfig(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.json).toBe("{}");
  });

  it("rejects non-serializable input", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const r = serializeConfig(cyclic);
    expect(r.ok).toBe(false);
  });

  it(`rejects payloads over ${CONFIG_MAX_BYTES} bytes`, () => {
    const big = { x: "x".repeat(CONFIG_MAX_BYTES) };
    const r = serializeConfig(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("byte limit");
  });
});
